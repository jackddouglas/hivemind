import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  Notice,
  Modal,
  TextComponent,
} from 'obsidian';

import { HivemindSettings, DEFAULT_SETTINGS } from './src/types';
import { KeepsyncService } from './src/services/KeepsyncService';
import { DocumentMappingManager } from './src/services/DocumentMappingManager';
import { FileRecoveryService } from './src/services/FileRecoveryService';
import { SyncOrchestrator } from './src/services/SyncOrchestrator';
import { SharedNoteManager } from './src/services/SharedNoteManager';
import { TeamManager } from './src/services/TeamManager';
import { SyncStatusBar } from './src/ui/SyncStatusBar';

export default class HivemindPlugin extends Plugin {
  settings: HivemindSettings;
  keepsyncService: KeepsyncService;
  mappingManager: DocumentMappingManager;
  fileRecoveryService: FileRecoveryService;
  syncOrchestrator: SyncOrchestrator;
  sharedNoteManager: SharedNoteManager;
  teamManager: TeamManager;
  statusBar: SyncStatusBar;

  async onload() {
    await this.loadSettings();

    // Defer initialization until workspace is ready
    this.app.workspace.onLayoutReady(async () => {
      await this.initializePlugin();
    });
  }

  private async initializePlugin() {
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
    this.teamManager = new TeamManager(this, this.mappingManager);
    this.statusBar = new SyncStatusBar(this);
    this.syncOrchestrator.setStatusBar(this.statusBar);

    // Only attempt to connect if both settings are configured
    if (this.settings.syncServerUrl && this.settings.userId) {
      await this.initializeServices();
    } else {
      this.statusBar.setConnected(false);
      // Only show notice on first run, not every startup
      if (!this.settings.syncServerUrl && !this.settings.userId) {
        new Notice('Hivemind: Open settings to configure your sync server and user ID');
      }
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

    // Note sharing commands
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

    // Team management commands
    this.addCommand({
      id: 'create-team',
      name: 'Create a new team',
      callback: () => {
        new CreateTeamModal(this.app, async (teamId, teamName) => {
          await this.teamManager.createTeam(teamId, teamName);
        }).open();
      },
    });

    this.addCommand({
      id: 'join-team',
      name: 'Join a team',
      callback: () => {
        new JoinTeamModal(this.app, async (teamId) => {
          await this.teamManager.joinTeam(teamId);
        }).open();
      },
    });

    this.addCommand({
      id: 'join-from-share-link',
      name: 'Join document from share link',
      callback: () => {
        new ShareLinkModal(this.app, async (link) => {
          await this.teamManager.joinFromShareLink(link);
        }).open();
      },
    });

    this.addCommand({
      id: 'leave-team',
      name: 'Leave a team',
      callback: async () => {
        const teams = this.teamManager.getTeams();
        if (teams.length === 0) {
          new Notice('You are not a member of any teams');
          return;
        }
        
        // For simplicity, if only one team, leave it directly
        if (teams.length === 1) {
          await this.teamManager.leaveTeam(teams[0], false);
        } else {
          // TODO: Show modal to select which team to leave
          new Notice('Use the settings tab to leave specific teams');
        }
      },
    });

    // System commands
    this.addCommand({
      id: 'reconnect-sync-server',
      name: 'Reconnect to sync server',
      callback: async () => {
        try {
          await this.keepsyncService.shutdown();
          if (this.settings.syncServerUrl && this.settings.userId) {
            await this.keepsyncService.initialize(this.settings.syncServerUrl);
            this.statusBar.setConnected(true);
            new Notice('Hivemind: Reconnected to sync server');
          } else {
            this.statusBar.setConnected(false);
            new Notice(
              'Hivemind: Please configure server URL and user ID in settings'
            );
          }
        } catch (error) {
          console.error('Failed to reconnect to Keepsync:', error);
          this.statusBar.setConnected(false);
          new Notice('Hivemind: Failed to reconnect to sync server');
        }
      },
    });

    this.addCommand({
      id: 'recover-shared-notes',
      name: 'Recover missing shared notes',
      callback: async () => {
        new Notice('Hivemind: Checking for missing shared notes...');
        await this.fileRecoveryService.reconcileMappings();
        new Notice('Hivemind: Recovery check completed');
      },
    });

    // File menu integration
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
                const link = this.teamManager.generateShareLink(
                  mapping.teamId,
                  mapping.documentId
                );
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

  async initializeServices(): Promise<boolean> {
    try {
      if (!this.settings.syncServerUrl || !this.settings.userId) {
        throw new Error('Server URL and User ID are required');
      }

      await this.keepsyncService.initialize(this.settings.syncServerUrl);
      this.statusBar.setConnected(true);
      return true;
    } catch (error) {
      console.error('Failed to initialize Keepsync:', error);
      this.statusBar.setConnected(false);
      throw error;
    }
  }

  onunload() {
    this.statusBar?.destroy();
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

// Modal for creating a new team
class CreateTeamModal extends Modal {
  private onSubmit: (teamId: string, teamName: string) => void;

  constructor(app: App, onSubmit: (teamId: string, teamName: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Create New Team' });

    const teamIdSetting = new Setting(contentEl)
      .setName('Team ID')
      .setDesc('Unique identifier for the team (e.g., "my-team")')
      .addText(text => text.setPlaceholder('team-id'));

    const teamNameSetting = new Setting(contentEl)
      .setName('Team Name')
      .setDesc('Display name for the team')
      .addText(text => text.setPlaceholder('My Team'));

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => this.close()))
      .addButton(btn => btn
        .setButtonText('Create')
        .setCta()
        .onClick(() => {
          const teamId = (teamIdSetting.components[0] as TextComponent).getValue();
          const teamName = (teamNameSetting.components[0] as TextComponent).getValue();
          
          if (teamId) {
            this.onSubmit(teamId, teamName || teamId);
            this.close();
          } else {
            new Notice('Please enter a team ID');
          }
        }));
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// Modal for joining a team
class JoinTeamModal extends Modal {
  private onSubmit: (teamId: string) => void;

  constructor(app: App, onSubmit: (teamId: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Join Team' });

    const teamIdSetting = new Setting(contentEl)
      .setName('Team ID')
      .setDesc('Enter the ID of the team you want to join')
      .addText(text => text.setPlaceholder('team-id'));

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => this.close()))
      .addButton(btn => btn
        .setButtonText('Join')
        .setCta()
        .onClick(() => {
          const teamId = (teamIdSetting.components[0] as TextComponent).getValue();
          
          if (teamId) {
            this.onSubmit(teamId);
            this.close();
          } else {
            new Notice('Please enter a team ID');
          }
        }));
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// Modal for joining via share link
class ShareLinkModal extends Modal {
  private onSubmit: (link: string) => void;

  constructor(app: App, onSubmit: (link: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Join from Share Link' });

    const linkSetting = new Setting(contentEl)
      .setName('Share Link')
      .setDesc('Paste the hivemind:// share link')
      .addText(text => text.setPlaceholder('hivemind://team-id/document-id'));

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => this.close()))
      .addButton(btn => btn
        .setButtonText('Join')
        .setCta()
        .onClick(() => {
          const link = (linkSetting.components[0] as TextComponent).getValue();
          
          if (link) {
            this.onSubmit(link);
            this.close();
          } else {
            new Notice('Please enter a share link');
          }
        }));
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class HivemindSettingTab extends PluginSettingTab {
  plugin: HivemindPlugin;
  private statusEl: HTMLElement;
  private userIdInput: TextComponent;
  private serverUrlInput: TextComponent;

  constructor(app: App, plugin: HivemindPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Hivemind Settings' });

    // Connection status indicator
    this.statusEl = containerEl.createEl('div', {
      cls: 'hivemind-connection-status',
    });
    this.updateConnectionStatus();

    new Setting(containerEl)
      .setName('User ID')
      .setDesc('Your unique identifier for team collaboration')
      .addText(text => {
        this.userIdInput = text;
        text
          .setPlaceholder('your-username')
          .setValue(this.plugin.settings.userId)
          .onChange(async value => {
            this.plugin.settings.userId = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Sync Server URL')
      .setDesc('WebSocket server for real-time sync')
      .addText(text => {
        this.serverUrlInput = text;
        text
          .setPlaceholder('ws://localhost:7777')
          .setValue(this.plugin.settings.syncServerUrl)
          .onChange(async value => {
            this.plugin.settings.syncServerUrl = value;
            await this.plugin.saveSettings();
          });
      });

    // Save & Connect button
    new Setting(containerEl)
      .setName('Connection')
      .setDesc('Save settings and connect to sync server')
      .addButton(button =>
        button
          .setButtonText('Save & Connect')
          .setCta()
          .onClick(async () => {
            await this.handleSaveAndConnect();
          })
      );

    containerEl.createEl('h3', { text: 'Shared Notes' });

    const sharedList = containerEl.createEl('div', {
      cls: 'hivemind-shared-list',
    });

    const mappings = Object.entries(this.plugin.settings.documentMappings);

    if (mappings.length === 0) {
      sharedList.createEl('p', {
        text: 'No shared notes yet. Right-click on a note to share it with your team.',
        cls: 'hivemind-empty-state',
      });
    } else {
      for (const [docId, mapping] of mappings) {
        const item = sharedList.createEl('div', {
          cls: 'hivemind-shared-item',
        });

        const info = item.createEl('div', { cls: 'hivemind-shared-info' });
        info.createEl('span', {
          text: mapping.localPath,
          cls: 'hivemind-shared-path',
        });
        info.createEl('small', {
          text: `Team: ${mapping.teamId} • Shared: ${new Date(mapping.sharedAt).toLocaleDateString()}`,
          cls: 'hivemind-shared-meta',
        });

        const actions = item.createEl('div', {
          cls: 'hivemind-shared-actions',
        });

        const copyBtn = actions.createEl('button', {
          text: 'Copy Link',
          cls: 'mod-cta',
        });
        copyBtn.onclick = async () => {
          const link = this.plugin.teamManager.generateShareLink(
            mapping.teamId,
            docId
          );
          await navigator.clipboard.writeText(link);
          new Notice('Share link copied!');
        };

        const unshareBtn = actions.createEl('button', {
          text: 'Unshare',
          cls: 'mod-warning',
        });
        unshareBtn.onclick = async () => {
          await this.plugin.mappingManager.removeMapping(docId);
          this.display();
          new Notice(`Unshared: ${mapping.localPath}`);
        };
      }
    }

    containerEl.createEl('h3', { text: 'Teams' });

    const teamsList = containerEl.createEl('div', {
      cls: 'hivemind-teams-list',
    });

    if (this.plugin.settings.teams.length === 0) {
      teamsList.createEl('p', {
        text: 'Not a member of any teams yet. Use the command palette to create or join a team.',
        cls: 'hivemind-empty-state',
      });
    } else {
      for (const teamId of this.plugin.settings.teams) {
        const teamItem = teamsList.createEl('div', {
          cls: 'hivemind-team-item',
        });
        teamItem.createEl('span', { text: teamId });

        const leaveBtn = teamItem.createEl('button', {
          text: 'Leave',
          cls: 'mod-warning',
        });
        leaveBtn.onclick = async () => {
          await this.plugin.teamManager.leaveTeam(teamId, false);
          this.display();
        };
      }
    }

    new Setting(containerEl)
      .setName('Quick Join Team')
      .setDesc('Enter a team ID to join')
      .addText(text => text.setPlaceholder('team-id'))
      .addButton(button =>
        button.setButtonText('Join').onClick(async () => {
          const input = containerEl.querySelector(
            'input[placeholder="team-id"]'
          ) as HTMLInputElement;
          const teamId = input?.value?.trim();
          if (teamId) {
            await this.plugin.teamManager.joinTeam(teamId);
            input.value = '';
            this.display();
          }
        })
      );
  }

  private updateConnectionStatus(): void {
    if (!this.statusEl) return;

    this.statusEl.empty();
    
    const isConnected = this.plugin.keepsyncService?.isInitialized();
    const hasSettings = this.plugin.settings.userId && this.plugin.settings.syncServerUrl;
    
    if (isConnected) {
      this.statusEl.createEl('div', {
        text: '🟢 Connected to sync server',
        cls: 'hivemind-status-connected',
      });
    } else if (hasSettings) {
      this.statusEl.createEl('div', {
        text: '🟡 Settings configured, not connected',
        cls: 'hivemind-status-configured',
      });
    } else {
      this.statusEl.createEl('div', {
        text: '🔴 Not configured',
        cls: 'hivemind-status-not-configured',
      });
    }
  }

  private async handleSaveAndConnect(): Promise<void> {
    const userId = this.userIdInput.getValue().trim();
    const serverUrl = this.serverUrlInput.getValue().trim();

    // Validation
    if (!userId) {
      new Notice('Please enter a User ID');
      return;
    }

    if (!serverUrl) {
      new Notice('Please enter a Sync Server URL');
      return;
    }

    // Update settings
    this.plugin.settings.userId = userId;
    this.plugin.settings.syncServerUrl = serverUrl;
    await this.plugin.saveSettings();

    // Show loading state
    const button = this.containerEl.querySelector('.mod-cta') as HTMLButtonElement;
    if (button) {
      button.textContent = 'Connecting...';
      button.disabled = true;
    }

    try {
      await this.plugin.initializeServices();
      new Notice('Hivemind: Successfully connected to sync server!');
      this.updateConnectionStatus();
    } catch (error) {
      console.error('Connection failed:', error);
      new Notice(`Hivemind: Failed to connect - ${error.message}`);
    } finally {
      // Reset button state
      if (button) {
        button.textContent = 'Save & Connect';
        button.disabled = false;
      }
    }
  }
}
