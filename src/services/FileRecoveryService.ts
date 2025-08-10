import { TFile, App, Modal, ButtonComponent } from 'obsidian';
import { LocalDocumentMapping } from '../types';
import { DocumentMappingManager } from './DocumentMappingManager';

export class FileRecoveryService {
  private app: App;
  private mappingManager: DocumentMappingManager;

  constructor(app: App, mappingManager: DocumentMappingManager) {
    this.app = app;
    this.mappingManager = mappingManager;
  }

  async reconcileMappings(): Promise<void> {
    const orphanedMappings: LocalDocumentMapping[] = [];
    const allMappings = this.mappingManager.getAllMappings();

    for (const mapping of allMappings) {
      const file = this.app.vault.getAbstractFileByPath(mapping.localPath);

      if (!file || !(file instanceof TFile)) {
        orphanedMappings.push(mapping);
      }
    }

    if (orphanedMappings.length > 0) {
      await this.attemptRecovery(orphanedMappings);
    }
  }

  private async attemptRecovery(
    orphanedMappings: LocalDocumentMapping[]
  ): Promise<void> {
    for (const mapping of orphanedMappings) {
      const basename = this.getBasename(mapping.lastKnownPath);
      const candidates = this.app.vault
        .getFiles()
        .filter(f => f.basename === basename);

      if (candidates.length === 1) {
        await this.relinkMapping(mapping, candidates[0]);
        continue;
      }

      if (candidates.length > 0 || mapping.lastSyncedHash) {
        const matchedFile = await this.findByContent(mapping);
        if (matchedFile) {
          await this.relinkMapping(mapping, matchedFile);
          continue;
        }
      }

      const frontmatterMatch = await this.findByFrontmatter(mapping.documentId);
      if (frontmatterMatch) {
        await this.relinkMapping(mapping, frontmatterMatch);
        continue;
      }

      await this.promptUserForRecovery(mapping);
    }
  }

  private async findByContent(
    mapping: LocalDocumentMapping
  ): Promise<TFile | null> {
    const files = this.app.vault.getFiles();

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const hash = this.mappingManager.hashContent(content);

      if (
        hash === mapping.lastSyncedHash ||
        this.calculateSimilarity(content, mapping) > 0.9
      ) {
        return file;
      }
    }

    return null;
  }

  private async findByFrontmatter(documentId: string): Promise<TFile | null> {
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter?.['hivemind-id'] === documentId) {
        return file;
      }
    }

    return null;
  }

  private async relinkMapping(
    mapping: LocalDocumentMapping,
    file: TFile
  ): Promise<void> {
    await this.mappingManager.updateMapping(mapping.documentId, file.path);
  }

  private getBasename(path: string): string {
    const parts = path.split('/');
    const filename = parts[parts.length - 1];
    return filename.replace(/\.[^/.]+$/, '');
  }

  private calculateSimilarity(
    content: string,
    mapping: LocalDocumentMapping
  ): number {
    return 0.5;
  }

  private async promptUserForRecovery(
    mapping: LocalDocumentMapping
  ): Promise<void> {
    return new Promise(resolve => {
      new RecoveryModal(this.app, mapping, async choice => {
        switch (choice) {
          case 'relink':
            break;
          case 'recreate':
            await this.recreateFromRemote(mapping);
            break;
          case 'ignore':
            await this.mappingManager.removeMapping(mapping.documentId);
            break;
        }
        resolve();
      }).open();
    });
  }

  private async recreateFromRemote(
    mapping: LocalDocumentMapping
  ): Promise<void> {
    console.log(
      `Would recreate file from remote for mapping: ${mapping.documentId}`
    );
  }
}

class RecoveryModal extends Modal {
  constructor(
    app: App,
    private mapping: LocalDocumentMapping,
    private onChoice: (choice: 'relink' | 'recreate' | 'ignore') => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Shared Note Not Found' });
    contentEl.createEl('p', {
      text: `Cannot find shared note: ${this.mapping.lastKnownPath}`,
    });

    new ButtonComponent(contentEl)
      .setButtonText('Find existing file')
      .onClick(() => {
        this.close();
        this.onChoice('relink');
      });

    new ButtonComponent(contentEl)
      .setButtonText('Recreate from team')
      .onClick(() => {
        this.close();
        this.onChoice('recreate');
      });

    new ButtonComponent(contentEl).setButtonText('Ignore').onClick(() => {
      this.close();
      this.onChoice('ignore');
    });
  }
}
