import { App, Modal, ButtonComponent, TFile } from 'obsidian';

export interface LinkedFile {
  file: TFile;
  linkType: 'link' | 'embed';
  isShared: boolean;
}

export class LinkedFilesShareModal extends Modal {
  private linkedFiles: LinkedFile[];
  private selectedFiles: Set<TFile> = new Set();
  private onSubmit: (selectedFiles: TFile[]) => void;
  private onCancel: () => void;

  constructor(
    app: App,
    linkedFiles: LinkedFile[],
    onSubmit: (selectedFiles: TFile[]) => void,
    onCancel: () => void
  ) {
    super(app);
    this.linkedFiles = linkedFiles;
    this.onSubmit = onSubmit;
    this.onCancel = onCancel;

    // Pre-select all non-shared files
    this.linkedFiles.forEach(item => {
      if (!item.isShared) {
        this.selectedFiles.add(item.file);
      }
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // Header
    contentEl.createEl('h2', { text: 'Share Linked Documents' });
    contentEl.createEl('p', {
      text: "This document contains links to other Obsidian documents. Select which documents you'd like to share with the team:",
      cls: 'hivemind-modal-description',
    });

    // Quick actions
    const quickActionsEl = contentEl.createEl('div', {
      cls: 'hivemind-quick-actions',
    });

    new ButtonComponent(quickActionsEl)
      .setButtonText('Select All')
      .onClick(() => {
        this.linkedFiles.forEach(item => {
          if (!item.isShared) {
            this.selectedFiles.add(item.file);
          }
        });
        this.refreshFileList();
      });

    new ButtonComponent(quickActionsEl)
      .setButtonText('Select None')
      .onClick(() => {
        this.selectedFiles.clear();
        this.refreshFileList();
      });

    // File list container
    this.fileListContainer = contentEl.createEl('div', {
      cls: 'hivemind-files-list',
    });
    this.renderFileList();

    // Info box
    const infoEl = contentEl.createEl('div', { cls: 'hivemind-info-box' });
    infoEl.createEl('p', {
      text: 'Note:',
      cls: 'hivemind-info-title',
    });
    const infoList = infoEl.createEl('ul');
    infoList.createEl('li', {
      text: 'Only Obsidian documents (.md files) can be shared',
    });
    infoList.createEl('li', {
      text: 'Images and attachments are not yet supported for sharing',
    });
    infoList.createEl('li', {
      text: 'Already shared documents are shown but cannot be selected',
    });
    infoList.createEl('li', {
      text: 'You can always share additional documents later',
    });

    // Footer buttons
    const footerContainer = contentEl.createEl('div', {
      cls: 'hivemind-modal-footer',
    });

    new ButtonComponent(footerContainer).setButtonText('Cancel').onClick(() => {
      this.onCancel();
      this.close();
    });

    new ButtonComponent(footerContainer)
      .setButtonText('Share Selected')
      .setCta()
      .onClick(() => {
        this.onSubmit(Array.from(this.selectedFiles));
        this.close();
      });
  }

  private fileListContainer: HTMLElement;

  private renderFileList() {
    this.fileListContainer.empty();

    if (this.linkedFiles.length === 0) {
      this.fileListContainer.createEl('p', {
        text: 'No linked documents found in this document.',
        cls: 'hivemind-empty-state',
      });
      return;
    }

    // Since we only handle markdown documents now, no need to group by type
    const documentsContainer = this.fileListContainer.createEl('div', {
      cls: 'hivemind-documents-list',
    });

    if (this.linkedFiles.length > 1) {
      documentsContainer.createEl('h4', {
        text: `Linked Documents (${this.linkedFiles.length})`,
        cls: 'hivemind-documents-header',
      });
    }

    this.linkedFiles.forEach(item => {
      const fileItem = documentsContainer.createEl('div', {
        cls: `hivemind-file-item ${item.isShared ? 'is-shared' : ''}`,
      });

      // Checkbox (disabled for already shared files)
      const checkbox = fileItem.createEl('input', {
        type: 'checkbox',
        cls: 'hivemind-file-checkbox',
      });
      checkbox.checked = this.selectedFiles.has(item.file);
      checkbox.disabled = item.isShared;

      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selectedFiles.add(item.file);
        } else {
          this.selectedFiles.delete(item.file);
        }
      });

      // File info
      const fileInfo = fileItem.createEl('div', { cls: 'hivemind-file-info' });

      fileInfo.createEl('span', {
        text: item.file.name,
        cls: 'hivemind-file-name',
      });

      const fileDetails = fileInfo.createEl('div', {
        cls: 'hivemind-file-details',
      });
      fileDetails.createEl('small', {
        text: item.file.path,
        cls: 'hivemind-file-path',
      });

      const badges = fileDetails.createEl('div', {
        cls: 'hivemind-file-badges',
      });
      badges.createEl('span', {
        text: item.linkType === 'embed' ? 'Embedded' : 'Linked',
        cls: `hivemind-badge hivemind-badge-${item.linkType}`,
      });

      if (item.isShared) {
        badges.createEl('span', {
          text: 'Already Shared',
          cls: 'hivemind-badge hivemind-badge-shared',
        });
      }
    });
  }

  private refreshFileList() {
    this.renderFileList();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

