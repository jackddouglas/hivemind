import { App, Modal, Setting, ButtonComponent } from 'obsidian';
import type { SharedDocumentMetadata } from '../types';

interface DocumentWithId extends SharedDocumentMetadata {
  documentId: string;
}

export class TeamDocumentsModal extends Modal {
  private selectedDocuments: Set<string> = new Set();
  private onSubmit: (selectedDocs: string[]) => void;
  private documents: DocumentWithId[];
  private teamId: string;

  constructor(
    app: App,
    teamId: string,
    documents: DocumentWithId[],
    onSubmit: (selectedDocs: string[]) => void
  ) {
    super(app);
    this.teamId = teamId;
    this.documents = documents;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // Header
    contentEl.createEl('h2', { text: `Join Team: ${this.teamId}` });
    contentEl.createEl('p', {
      text: 'Select documents to sync to your vault:',
      cls: 'hivemind-modal-description',
    });

    // Document list
    const listContainer = contentEl.createDiv({
      cls: 'hivemind-document-list',
    });

    if (this.documents.length === 0) {
      listContainer.createEl('p', {
        text: 'No documents available in this team.',
        cls: 'hivemind-empty-message',
      });
    } else {
      // Select all/none buttons
      const buttonContainer = contentEl.createDiv({
        cls: 'hivemind-button-row',
      });

      new ButtonComponent(buttonContainer)
        .setButtonText('Select All')
        .onClick(() => {
          this.documents.forEach(doc =>
            this.selectedDocuments.add(doc.documentId)
          );
          this.refreshList();
        });

      new ButtonComponent(buttonContainer)
        .setButtonText('Select None')
        .onClick(() => {
          this.selectedDocuments.clear();
          this.refreshList();
        });

      // Document items
      this.documents.forEach(doc => {
        const itemContainer = listContainer.createDiv({
          cls: 'hivemind-document-item',
        });

        new Setting(itemContainer)
          .setName(doc.originalName || 'Untitled')
          .setDesc(this.getDocumentDescription(doc))
          .addToggle(toggle => {
            toggle
              .setValue(this.selectedDocuments.has(doc.documentId))
              .onChange(value => {
                if (value) {
                  this.selectedDocuments.add(doc.documentId);
                } else {
                  this.selectedDocuments.delete(doc.documentId);
                }
              });
          });
      });
    }

    // Footer buttons
    const footerContainer = contentEl.createDiv({
      cls: 'hivemind-modal-footer',
    });

    new ButtonComponent(footerContainer)
      .setButtonText('Cancel')
      .onClick(() => this.close());

    new ButtonComponent(footerContainer)
      .setButtonText(`Join ${this.selectedDocuments.size} Document(s)`)
      .setCta()
      .onClick(() => {
        this.onSubmit(Array.from(this.selectedDocuments));
        this.close();
      });
  }

  private getDocumentDescription(doc: DocumentWithId): string {
    const parts = [];

    if (doc.createdBy) {
      parts.push(`Shared by: ${doc.createdBy}`);
    }

    if (doc.createdAt) {
      const date = new Date(doc.createdAt);
      parts.push(`Created: ${date.toLocaleDateString()}`);
    }

    if (doc.description) {
      parts.push(doc.description);
    }

    return parts.join(' • ') || 'No description available';
  }

  private refreshList() {
    this.onOpen();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
