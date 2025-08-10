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
import { SharedNoteManager } from './src/services/SharedNoteManager';

export default class HivemindPlugin extends Plugin {
  settings: HivemindSettings;
  keepsyncService: KeepsyncService;
  mappingManager: DocumentMappingManager;
  fileRecoveryService: FileRecoveryService;
  syncOrchestrator: SyncOrchestrator;
  sharedNoteManager: SharedNoteManager;

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
    this.sharedNoteManager = new SharedNoteManager(
      this.app,
      this.mappingManager,
      this.syncOrchestrator,
      this.settings
    );

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

    // Restore sync listeners for all shared notes
    await this.sharedNoteManager.restoreAllSyncListeners();

    // Register event listeners for file operations
    this.registerEvent(
      this.app.workspace.on('editor-change', (editor, info) => {
        this.syncOrchestrator.handleEditorChange(editor, info);
      })
    );

    this.registerEvent(
      this.app.vault.on('modify', file => {
        if (file instanceof TFile) {
          this.syncOrchestrator.handleFileModify(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile) {
          this.syncOrchestrator.handleFileRename(file, oldPath);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', file => {
        if (file instanceof TFile) {
          this.syncOrchestrator.handleFileDelete(file);
        }
      })
    );

    this.addCommand({
      id: 'share-current-note',
      name: 'Share current note with team',
      editorCheckCallback: (checking, _editor, ctx) => {
        const file = ctx.file;
        if (!file) return false;

        const isShared = !!this.mappingManager.findMappingByPath(file.path);
        if (checking) return !isShared;

        this.sharedNoteManager.shareNote(file);
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

        this.sharedNoteManager.unshareNote(file);
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
                  await this.sharedNoteManager.unshareNote(file);
                } else {
                  await this.sharedNoteManager.shareNote(file);
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
    this.sharedNoteManager?.cleanup();
    this.syncOrchestrator?.cleanup();
    this.keepsyncService?.shutdown();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
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
