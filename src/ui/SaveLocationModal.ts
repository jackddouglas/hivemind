import {
  App,
  Modal,
  Setting,
  ButtonComponent,
  normalizePath,
  Notice,
} from 'obsidian';

export class SaveLocationModal extends Modal {
  private onSubmit: (path: string | null) => void;
  private pathInput: string;
  private folderInput: string = '';

  constructor(
    app: App,
    suggestedName: string,
    onSubmit: (path: string | null) => void
  ) {
    super(app);
    this.onSubmit = onSubmit;
    this.pathInput = suggestedName;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // Header
    contentEl.createEl('h2', { text: 'Choose Save Location' });
    contentEl.createEl('p', {
      text: 'Where would you like to save this shared document?',
      cls: 'hivemind-modal-description',
    });

    // Folder input
    new Setting(contentEl)
      .setName('Folder')
      .setDesc('Optional: Specify a folder path (e.g., "Shared/Team")')
      .addText(text => {
        text
          .setPlaceholder('Leave empty for root folder')
          .setValue(this.folderInput)
          .onChange(value => {
            this.folderInput = value;
            this.updatePreview();
          });
      });

    // File name input
    new Setting(contentEl)
      .setName('File name')
      .setDesc('The name for the file in your vault')
      .addText(text => {
        text
          .setPlaceholder('document.md')
          .setValue(this.pathInput)
          .onChange(value => {
            this.pathInput = value;
            this.updatePreview();
          });
      });

    // Preview
    const previewContainer = contentEl.createDiv({
      cls: 'hivemind-path-preview',
    });
    this.updatePreview(previewContainer);

    // Suggestions
    const suggestionsContainer = contentEl.createDiv({
      cls: 'hivemind-suggestions',
    });
    suggestionsContainer.createEl('p', {
      text: 'Quick locations:',
      cls: 'hivemind-suggestions-title',
    });

    const suggestions = [
      { folder: 'Shared', desc: 'Shared notes folder' },
      { folder: 'Team', desc: 'Team collaboration' },
      { folder: '', desc: 'Vault root' },
    ];

    suggestions.forEach(suggestion => {
      const suggestionEl = suggestionsContainer.createDiv({
        cls: 'hivemind-suggestion-item',
      });

      new ButtonComponent(suggestionEl)
        .setButtonText(suggestion.folder || 'Root')
        .setTooltip(suggestion.desc)
        .onClick(() => {
          this.folderInput = suggestion.folder;
          this.onOpen(); // Refresh the modal
        });
    });

    // Footer buttons
    const footerContainer = contentEl.createDiv({
      cls: 'hivemind-modal-footer',
    });

    new ButtonComponent(footerContainer).setButtonText('Cancel').onClick(() => {
      this.onSubmit(null);
      this.close();
    });

    new ButtonComponent(footerContainer)
      .setButtonText('Save Here')
      .setCta()
      .onClick(() => {
        const finalPath = this.getFinalPath();
        if (this.validatePath(finalPath)) {
          this.onSubmit(finalPath);
          this.close();
        }
      });
  }

  private updatePreview(container?: HTMLElement) {
    const previewEl =
      container || this.containerEl.querySelector('.hivemind-path-preview');
    if (!previewEl) return;

    previewEl.empty();

    const finalPath = this.getFinalPath();

    previewEl.createEl('strong', { text: 'Full path: ' });
    previewEl.createEl('code', { text: finalPath });

    // Check if file already exists
    const existingFile = this.app.vault.getAbstractFileByPath(finalPath);
    if (existingFile) {
      previewEl.createEl('p', {
        text: '⚠️ A file already exists at this location. It will be overwritten.',
        cls: 'hivemind-warning',
      });
    }
  }

  private getFinalPath(): string {
    let filename = this.pathInput.trim();

    // Ensure .md extension
    if (!filename.endsWith('.md')) {
      filename += '.md';
    }

    // Combine folder and filename
    if (this.folderInput.trim()) {
      return normalizePath(`${this.folderInput.trim()}/${filename}`);
    }

    return normalizePath(filename);
  }

  private validatePath(path: string): boolean {
    if (!path || path.trim() === '') {
      new Notice('Please enter a valid file name');
      return false;
    }

    // Check for invalid characters
    const invalidChars = ['\\', ':', '*', '?', '"', '<', '>', '|'];
    for (const char of invalidChars) {
      if (path.includes(char)) {
        new Notice(`Invalid character in path: ${char}`);
        return false;
      }
    }

    return true;
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
