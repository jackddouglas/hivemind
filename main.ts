import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  Notice,
} from 'obsidian';

import { HivemindSettings, DEFAULT_SETTINGS } from './src/types';
import { KeepsyncService } from './src/services/KeepsyncService';
import { DocumentMappingManager } from './src/services/DocumentMappingManager';
import { FileRecoveryService } from './src/services/FileRecoveryService';
import { SyncOrchestrator } from './src/services/SyncOrchestrator';

export default class HivemindPlugin extends Plugin {
  settings: HivemindSettings;
  keepsyncService: KeepsyncService;
  mappingManager: DocumentMappingManager;
  fileRecoveryService: FileRecoveryService;
  syncOrchestrator: SyncOrchestrator;

  async onload() {
    await this.loadSettings();

    this.keepsyncService = new KeepsyncService();
    this.mappingManager = new DocumentMappingManager(
      this.app,
      this.settings,
      () => this.saveSettings()
    );
    this.fileRecoveryService = new FileRecoveryService(
      this.app,
      this.mappingManager
    );
    this.syncOrchestrator = new SyncOrchestrator(this.app, this.mappingManager);

    try {
      if (this.settings.syncServerUrl && this.settings.userId) {
        await this.keepsyncService.initialize(this.settings.syncServerUrl);
        new Notice('Hivemind: Connected to sync server');
      } else {
        new Notice(
          'Hivemind: Please configure server URL and user ID in settings'
        );
      }
    } catch (error) {
      console.error('Failed to initialize Keepsync:', error);
      new Notice(
        'Hivemind: Failed to connect to sync server. Check console for details.'
      );
    }

    await this.fileRecoveryService.reconcileMappings();

    this.syncOrchestrator.setupEventListeners();

    this.addCommand({
      id: 'share-current-note',
      name: 'Share current note with team',
      editorCheckCallback: (checking, _editor, ctx) => {
        const file = ctx.file;
        if (!file) return false;

        const isShared = !!this.mappingManager.findMappingByPath(file.path);
        if (checking) return !isShared;

        this.shareNote(file);
        return true;
      },
    });

    this.addCommand({
      id: 'unshare-current-note',
      name: 'Unshare current note',
      editorCheckCallback: (checking, _editor, ctx) => {
        const file = ctx.file;
        if (!file) return false;

        const isShared = !!this.mappingManager.findMappingByPath(file.path);
        if (checking) return isShared;

        this.unshareNote(file);
        return true;
      },
    });

    this.addCommand({
      id: 'reconnect-sync-server',
      name: 'Reconnect to sync server',
      callback: async () => {
        try {
          await this.keepsyncService.shutdown();
          if (this.settings.syncServerUrl && this.settings.userId) {
            await this.keepsyncService.initialize(this.settings.syncServerUrl);
            new Notice('Hivemind: Reconnected to sync server');
          } else {
            new Notice(
              'Hivemind: Please configure server URL and user ID in settings'
            );
          }
        } catch (error) {
          console.error('Failed to reconnect to Keepsync:', error);
          new Notice('Hivemind: Failed to reconnect to sync server');
        }
      },
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && file.extension === 'md') {
          const mapping = this.mappingManager.findMappingByPath(file.path);
          const isShared = !!mapping;

          menu.addItem(item => {
            item
              .setTitle(isShared ? '🔗 Unshare note' : '🔗 Share with team')
              .onClick(async () => {
                if (isShared) {
                  await this.unshareNote(file);
                  new Notice(`Unshared: ${file.basename}`);
                } else {
                  await this.shareNote(file);
                  new Notice(`Shared: ${file.basename}`);
                }
              });
          });

          if (isShared && mapping) {
            menu.addItem(item => {
              item.setTitle('📋 Copy share link').onClick(() => {
                const link = `hivemind://${mapping.teamId}/${mapping.documentId}`;
                navigator.clipboard.writeText(link);
                new Notice('Share link copied!');
              });
            });
          }
        }
      })
    );

    this.addSettingTab(new HivemindSettingTab(this.app, this));
  }

  onunload() {
    this.syncOrchestrator?.cleanup();
    this.keepsyncService?.shutdown();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async shareNote(file: TFile): Promise<void> {
    try {
      if (!this.settings.teams.length) {
        new Notice('Please configure a team in settings first');
        return;
      }

      const teamId = this.settings.teams[0];
      const documentId = await this.mappingManager.shareNewDocument(
        file,
        teamId
      );

      await this.addFrontmatterMetadata(file, documentId);

      new Notice(`Note shared: ${file.basename}`);
    } catch (error) {
      console.error('Failed to share note:', error);
      new Notice('Failed to share note');
    }
  }

  async unshareNote(file: TFile): Promise<void> {
    try {
      const mapping = this.mappingManager.findMappingByPath(file.path);
      if (!mapping) return;

      await this.mappingManager.removeMapping(mapping.documentId);
      await this.removeFrontmatterMetadata(file);

      new Notice(`Note unshared: ${file.basename}`);
    } catch (error) {
      console.error('Failed to unshare note:', error);
      new Notice('Failed to unshare note');
    }
  }

  private async addFrontmatterMetadata(
    file: TFile,
    documentId: string
  ): Promise<void> {
    const content = await this.app.vault.read(file);
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
    const match = content.match(frontmatterRegex);

    if (match) {
      const frontmatter = match[1];
      const newFrontmatter = `${frontmatter}\nhivemind-id: ${documentId}`;
      const newContent = content.replace(
        frontmatterRegex,
        `---\n${newFrontmatter}\n---\n`
      );
      await this.app.vault.modify(file, newContent);
    } else {
      const newContent = `---\nhivemind-id: ${documentId}\n---\n\n${content}`;
      await this.app.vault.modify(file, newContent);
    }
  }

  private async removeFrontmatterMetadata(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
    const match = content.match(frontmatterRegex);

    if (match) {
      const frontmatter = match[1];
      const lines = frontmatter
        .split('\n')
        .filter(line => !line.startsWith('hivemind-id:'));

      if (lines.length === 0) {
        const newContent = content.replace(frontmatterRegex, '');
        await this.app.vault.modify(file, newContent);
      } else {
        const newFrontmatter = lines.join('\n');
        const newContent = content.replace(
          frontmatterRegex,
          `---\n${newFrontmatter}\n---\n`
        );
        await this.app.vault.modify(file, newContent);
      }
    }
  }
}

class HivemindSettingTab extends PluginSettingTab {
  plugin: HivemindPlugin;

  constructor(app: App, plugin: HivemindPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Hivemind Settings' });

    new Setting(containerEl)
      .setName('User ID')
      .setDesc('Your unique identifier')
      .addText(text =>
        text
          .setPlaceholder('your-username')
          .setValue(this.plugin.settings.userId)
          .onChange(async value => {
            this.plugin.settings.userId = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Sync Server URL')
      .setDesc('WebSocket server for real-time sync')
      .addText(text =>
        text
          .setPlaceholder('ws://localhost:7777')
          .setValue(this.plugin.settings.syncServerUrl)
          .onChange(async value => {
            this.plugin.settings.syncServerUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Add Team')
      .setDesc('Enter a team ID to share notes with')
      .addText(text => {
        text.setPlaceholder('team-id');
        return text;
      })
      .addButton(button => {
        button
          .setButtonText('Add Team')
          .setCta()
          .onClick(async () => {
            const input = containerEl.querySelector(
              'input[placeholder="team-id"]'
            ) as HTMLInputElement;
            const value = input?.value?.trim();

            if (!value) {
              new Notice('Please enter a team ID');
              return;
            }

            if (this.plugin.settings.teams.includes(value)) {
              new Notice('Team already exists');
              return;
            }

            this.plugin.settings.teams.push(value);
            await this.plugin.saveSettings();
            input.value = '';
            this.display();
            new Notice(`Added team: ${value}`);
          });
      });

    containerEl.createEl('h3', { text: 'Teams' });
    const teamsList = containerEl.createEl('div', {
      cls: 'hivemind-teams-list',
    });

    for (const teamId of this.plugin.settings.teams) {
      const item = teamsList.createEl('div', { cls: 'hivemind-team-item' });
      item.createEl('span', { text: teamId });
      item.createEl('button', { text: 'Remove' }).onclick = async () => {
        this.plugin.settings.teams = this.plugin.settings.teams.filter(
          t => t !== teamId
        );
        await this.plugin.saveSettings();
        this.display();
      };
    }

    containerEl.createEl('h3', { text: 'Shared Notes' });
    const sharedList = containerEl.createEl('div', {
      cls: 'hivemind-shared-list',
    });

    for (const [docId, mapping] of Object.entries(
      this.plugin.settings.documentMappings
    )) {
      const item = sharedList.createEl('div', { cls: 'hivemind-shared-item' });
      item.createEl('span', { text: mapping.localPath });
      item.createEl('button', { text: 'Unshare' }).onclick = async () => {
        await this.plugin.mappingManager.removeMapping(docId);
        this.display();
      };
    }
  }
}
