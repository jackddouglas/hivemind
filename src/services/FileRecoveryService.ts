import { TFile, App, Modal, ButtonComponent, Notice } from 'obsidian';
import { LocalDocumentMapping } from '../types';
import { DocumentMappingManager } from './DocumentMappingManager';
import { createHash } from 'crypto';

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
      console.log(
        `Found ${orphanedMappings.length} orphaned mappings, attempting recovery...`
      );
      await this.attemptRecovery(orphanedMappings);
    }
  }

  private async attemptRecovery(
    orphanedMappings: LocalDocumentMapping[]
  ): Promise<void> {
    for (const mapping of orphanedMappings) {
      let recovered = false;

      // Strategy 1: Search by filename
      const basename = this.getBasename(mapping.lastKnownPath);
      const candidates = this.app.vault
        .getFiles()
        .filter(f => f.basename === basename && f.extension === 'md');

      if (candidates.length === 1) {
        // Single match - likely the moved file
        await this.relinkMapping(mapping, candidates[0]);
        recovered = true;
        continue;
      }

      // Strategy 2: Content matching (for multiple candidates or renamed files)
      if (candidates.length > 0 || mapping.lastSyncedHash) {
        const matchedFile = await this.findByContent(mapping);
        if (matchedFile) {
          await this.relinkMapping(mapping, matchedFile);
          recovered = true;
          continue;
        }
      }

      // Strategy 3: Frontmatter matching
      const frontmatterMatch = await this.findByFrontmatter(mapping.documentId);
      if (frontmatterMatch) {
        await this.relinkMapping(mapping, frontmatterMatch);
        recovered = true;
        continue;
      }

      // Strategy 4: Ask user
      if (!recovered) {
        await this.promptUserForRecovery(mapping);
      }
    }
  }

  private async findByContent(
    mapping: LocalDocumentMapping
  ): Promise<TFile | null> {
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const hash = this.hashContent(content);

        // Check if content matches exactly
        if (hash === mapping.lastSyncedHash) {
          return file;
        }

        // Check for high similarity (in case of minor edits)
        const similarity = this.calculateSimilarity(content, mapping);
        if (similarity > 0.9) {
          return file;
        }
      } catch (error) {
        console.warn(
          `Error reading file ${file.path} for content matching:`,
          error
        );
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
    console.log(
      `Relinking mapping ${mapping.documentId} from ${mapping.localPath} to ${file.path}`
    );

    // Update the mapping with new path and current content hash
    const content = await this.app.vault.read(file);
    mapping.lastSyncedHash = this.hashContent(content);

    await this.mappingManager.updateMapping(mapping.documentId, file.path);

    new Notice(`Recovered shared note: ${file.basename}`);
  }

  private getBasename(path: string): string {
    const parts = path.split('/');
    const filename = parts[parts.length - 1];
    return filename.replace(/\.[^/.]+$/, '');
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private calculateSimilarity(
    content: string,
    mapping: LocalDocumentMapping
  ): number {
    // Simple similarity calculation based on content length and document ID presence
    if (!mapping.lastSyncedHash) return 0;

    const contentHash = this.hashContent(content);
    if (contentHash === mapping.lastSyncedHash) return 1.0;

    // Check if the document ID is mentioned in frontmatter or content
    if (content.includes(mapping.documentId)) return 0.95;

    // Basic heuristic: if content has similar structure (rough estimate)
    const lines = content.split('\n');
    const hasHeaders = lines.some(line => line.startsWith('#'));
    const hasContent = lines.length > 5;

    if (hasHeaders && hasContent) return 0.7;
    if (hasContent) return 0.5;

    return 0.3;
  }

  private async promptUserForRecovery(
    mapping: LocalDocumentMapping
  ): Promise<void> {
    return new Promise(resolve => {
      new RecoveryModal(this.app, mapping, async choice => {
        switch (choice) {
          case 'relink':
            await this.promptForFileSelection(mapping);
            break;
          case 'recreate':
            await this.recreateFromRemote(mapping);
            break;
          case 'ignore':
            await this.mappingManager.removeMapping(mapping.documentId);
            new Notice(`Removed mapping for: ${mapping.lastKnownPath}`);
            break;
        }
        resolve();
      }).open();
    });
  }

  private async promptForFileSelection(
    mapping: LocalDocumentMapping
  ): Promise<void> {
    // This would ideally use a file picker modal, but for now we'll use a simple approach
    const files = this.app.vault.getMarkdownFiles();
    const basename = this.getBasename(mapping.lastKnownPath);

    // Find potential matches
    const potentialMatches = files.filter(
      f =>
        f.basename.toLowerCase().includes(basename.toLowerCase()) ||
        basename.toLowerCase().includes(f.basename.toLowerCase())
    );

    if (potentialMatches.length > 0) {
      // For now, just take the first match and ask for confirmation
      const candidate = potentialMatches[0];
      const confirmed = confirm(`Link shared note to "${candidate.path}"?`);

      if (confirmed) {
        await this.relinkMapping(mapping, candidate);
      } else {
        await this.mappingManager.removeMapping(mapping.documentId);
        new Notice(`Removed mapping for: ${mapping.lastKnownPath}`);
      }
    } else {
      new Notice(`No potential matches found for: ${mapping.lastKnownPath}`);
      await this.mappingManager.removeMapping(mapping.documentId);
    }
  }

  private async recreateFromRemote(
    mapping: LocalDocumentMapping
  ): Promise<void> {
    try {
      // This would fetch from keepsync - for now just create a placeholder
      const suggestedPath = mapping.lastKnownPath;
      const dir = suggestedPath.substring(0, suggestedPath.lastIndexOf('/'));

      // Ensure directory exists
      if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
        await this.app.vault.createFolder(dir);
      }

      // Create file with placeholder content
      const content = `# Recovered Shared Note\n\nThis note was recovered from team sharing.\nDocument ID: ${mapping.documentId}\n\n<!-- Content will be synced from team -->\n`;

      const file = await this.app.vault.create(suggestedPath, content);
      await this.relinkMapping(mapping, file);

      new Notice(`Recreated shared note: ${file.basename}`);
    } catch (error) {
      console.error('Error recreating file from remote:', error);
      new Notice(`Failed to recreate: ${mapping.lastKnownPath}`);
      await this.mappingManager.removeMapping(mapping.documentId);
    }
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
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Shared Note Not Found' });
    contentEl.createEl('p', {
      text: `Cannot find shared note: ${this.mapping.lastKnownPath}`,
    });
    contentEl.createEl('p', {
      text: `Document ID: ${this.mapping.documentId}`,
    });
    contentEl.createEl('p', {
      text: 'What would you like to do?',
    });

    const buttonContainer = contentEl.createEl('div', {
      cls: 'modal-button-container',
    });
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '10px';
    buttonContainer.style.justifyContent = 'center';
    buttonContainer.style.marginTop = '20px';

    new ButtonComponent(buttonContainer)
      .setButtonText('Find existing file')
      .setTooltip('Link to an existing file in your vault')
      .onClick(() => {
        this.close();
        this.onChoice('relink');
      });

    new ButtonComponent(buttonContainer)
      .setButtonText('Recreate from team')
      .setTooltip('Create a new file and sync content from team')
      .onClick(() => {
        this.close();
        this.onChoice('recreate');
      });

    new ButtonComponent(buttonContainer)
      .setButtonText('Remove mapping')
      .setTooltip('Stop tracking this shared note')
      .onClick(() => {
        this.close();
        this.onChoice('ignore');
      });
  }
}
