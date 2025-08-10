import { App, Modal, Setting, ButtonComponent } from 'obsidian';

export class TeamJoinModal extends Modal {
  private teamId: string;
  private teamName: string;
  private onSubmit: (enableAutoSync: boolean) => void;
  private autoSyncEnabled: boolean = false;

  constructor(
    app: App,
    teamId: string,
    teamName: string,
    onSubmit: (enableAutoSync: boolean) => void
  ) {
    super(app);
    this.teamId = teamId;
    this.teamName = teamName;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // Header
    contentEl.createEl('h2', { text: `Join Team: ${this.teamName}` });
    contentEl.createEl('p', {
      text: 'Choose how you want to sync documents from this team:',
      cls: 'hivemind-modal-description',
    });

    // Auto-sync option
    new Setting(contentEl)
      .setName('Auto-sync new documents')
      .setDesc(
        'Automatically download and sync all new documents shared in this team'
      )
      .addToggle(toggle =>
        toggle.setValue(this.autoSyncEnabled).onChange(value => {
          this.autoSyncEnabled = value;
        })
      );

    // Info about auto-sync
    const infoEl = contentEl.createEl('div', { cls: 'hivemind-info-box' });
    infoEl.createEl('p', {
      text: 'With auto-sync enabled:',
      cls: 'hivemind-info-title',
    });
    const infoList = infoEl.createEl('ul');
    infoList.createEl('li', {
      text: 'New team documents appear automatically in your vault',
    });
    infoList.createEl('li', {
      text: 'Documents are saved to your configured team sync folder',
    });
    infoList.createEl('li', {
      text: 'You can disable auto-sync anytime in settings',
    });

    infoEl.createEl('p', {
      text: 'Without auto-sync, you can manually select which documents to sync.',
      cls: 'hivemind-info-note',
    });

    // Footer buttons
    const footerContainer = contentEl.createEl('div', {
      cls: 'hivemind-modal-footer',
    });

    new ButtonComponent(footerContainer)
      .setButtonText('Cancel')
      .onClick(() => this.close());

    new ButtonComponent(footerContainer)
      .setButtonText('Join Team')
      .setCta()
      .onClick(() => {
        this.onSubmit(this.autoSyncEnabled);
        this.close();
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
