import { TFile, App, Notice } from 'obsidian';
import { DocumentMappingManager } from './DocumentMappingManager';
import { SyncOrchestrator } from './SyncOrchestrator';
import { HivemindSettings, SharedDocumentMetadata } from '../types';
import { listenToDoc, writeDoc, readDoc } from '@tonk/keepsync';
import { LinkedFilesShareModal, LinkedFile } from '../ui/LinkedFilesShareModal';

export class SharedNoteManager {
  private app: App;
  private mappingManager: DocumentMappingManager;
  private syncOrchestrator: SyncOrchestrator;
  private settings: HivemindSettings;
  private listeners: Map<string, () => void> = new Map();

  constructor(
    app: App,
    mappingManager: DocumentMappingManager,
    syncOrchestrator: SyncOrchestrator,
    settings: HivemindSettings
  ) {
    this.app = app;
    this.mappingManager = mappingManager;
    this.syncOrchestrator = syncOrchestrator;
    this.settings = settings;
  }

  async shareNote(file: TFile, teamId?: string): Promise<void> {
    const currentTeamId = teamId || this.settings.teams[0];
    if (!currentTeamId) {
      new Notice('No team configured. Please set up a team first.');
      return;
    }

    try {
      // Check for linked files first
      const linkedFiles = await this.detectLinkedFiles(file);

      if (linkedFiles.length > 0) {
        // Show modal to let user choose which linked files to share
        return new Promise<void>((resolve, reject) => {
          new LinkedFilesShareModal(
            this.app,
            linkedFiles,
            async (selectedFiles: TFile[]) => {
              try {
                await this.shareNoteWithLinkedFiles(
                  file,
                  selectedFiles,
                  currentTeamId
                );
                resolve();
              } catch (error) {
                reject(error);
              }
            },
            () => {
              // User cancelled, still share the main document
              this.shareMainDocument(file, currentTeamId)
                .then(resolve)
                .catch(reject);
            }
          ).open();
        });
      } else {
        // No linked files, proceed with normal sharing
        await this.shareMainDocument(file, currentTeamId);
      }
    } catch (error) {
      console.error('Failed to share note:', error);
      new Notice(`Failed to share note: ${error.message}`);
    }
  }

  private async shareMainDocument(file: TFile, teamId: string): Promise<void> {
    // 1. Generate document ID and create mapping
    const documentId = await this.mappingManager.shareNewDocument(file, teamId);

    // 2. Add frontmatter metadata
    await this.addFrontmatterMetadata(file, documentId);

    // 3. Create shared document metadata
    await this.createSharedDocumentMetadata(file, documentId, teamId);

    // 4. Set up bidirectional sync
    await this.setupBidirectionalSync(file, documentId);

    // 5. Update team index
    await this.updateTeamIndex('add', documentId, teamId);

    new Notice(`Shared: ${file.basename}`);
  }

  private async shareNoteWithLinkedFiles(
    file: TFile,
    linkedFiles: TFile[],
    teamId: string
  ): Promise<void> {
    // First share the main document
    await this.shareMainDocument(file, teamId);

    // Then share each selected linked file
    let sharedCount = 0;
    for (const linkedFile of linkedFiles) {
      try {
        await this.shareMainDocument(linkedFile, teamId);
        sharedCount++;
      } catch (error) {
        console.error(`Failed to share linked file ${linkedFile.path}:`, error);
        new Notice(`Warning: Failed to share ${linkedFile.name}`);
      }
    }

    if (sharedCount > 0) {
      new Notice(
        `Shared: ${file.basename} + ${sharedCount} linked file${sharedCount !== 1 ? 's' : ''}`
      );
    }
  }

  private async detectLinkedFiles(file: TFile): Promise<LinkedFile[]> {
    const linkedFiles: LinkedFile[] = [];
    const processedPaths = new Set<string>();

    const processFile = async (
      currentFile: TFile,
      depth: number = 0
    ): Promise<void> => {
      // Prevent infinite recursion and cycles
      if (depth > 3 || processedPaths.has(currentFile.path)) {
        return;
      }
      processedPaths.add(currentFile.path);

      const cache = this.app.metadataCache.getFileCache(currentFile);
      if (!cache) return;

      // Process regular links [[...]] - only markdown documents
      if (cache.links) {
        for (const link of cache.links) {
          const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
            link.link,
            currentFile.path
          );

          if (
            linkedFile &&
            linkedFile.extension === 'md' &&
            !processedPaths.has(linkedFile.path)
          ) {
            const isShared = !!this.mappingManager.findMappingByPath(
              linkedFile.path
            );
            linkedFiles.push({
              file: linkedFile,
              linkType: 'link',
              isShared,
            });

            // Recursively process markdown files for nested links
            await processFile(linkedFile, depth + 1);
          }
        }
      }

      // Process embeds ![[...]] - only markdown documents
      if (cache.embeds) {
        for (const embed of cache.embeds) {
          const embeddedFile = this.app.metadataCache.getFirstLinkpathDest(
            embed.link,
            currentFile.path
          );

          if (
            embeddedFile &&
            embeddedFile.extension === 'md' &&
            !processedPaths.has(embeddedFile.path)
          ) {
            const isShared = !!this.mappingManager.findMappingByPath(
              embeddedFile.path
            );
            linkedFiles.push({
              file: embeddedFile,
              linkType: 'embed',
              isShared,
            });

            // Recursively process markdown files for nested links
            await processFile(embeddedFile, depth + 1);
          }
        }
      }
    };

    await processFile(file);

    // Remove duplicates and return only files that exist and aren't already shared
    const uniqueFiles = new Map<string, LinkedFile>();
    linkedFiles.forEach(item => {
      if (!uniqueFiles.has(item.file.path)) {
        uniqueFiles.set(item.file.path, item);
      }
    });

    return Array.from(uniqueFiles.values());
  }

  async unshareNote(file: TFile): Promise<void> {
    const mapping = this.mappingManager.findMappingByPath(file.path);
    if (!mapping) {
      new Notice('Note is not shared');
      return;
    }

    try {
      // 1. Remove listener
      const unsubscribe = this.listeners.get(mapping.documentId);
      if (unsubscribe) {
        unsubscribe();
        this.listeners.delete(mapping.documentId);
      }

      // 2. Remove from team index
      await this.updateTeamIndex('remove', mapping.documentId, mapping.teamId);

      // 3. Remove frontmatter metadata
      await this.removeFrontmatterMetadata(file);

      // 4. Remove mapping
      await this.mappingManager.removeMapping(mapping.documentId);

      new Notice(`Unshared: ${file.basename}`);
    } catch (error) {
      console.error('Failed to unshare note:', error);
      new Notice(`Failed to unshare note: ${error.message}`);
    }
  }

  async setupBidirectionalSync(file: TFile, documentId: string): Promise<void> {
    const mapping = this.mappingManager.findMappingById(documentId);
    if (!mapping) {
      throw new Error(`No mapping found for document ${documentId}`);
    }

    const keepsyncPath = `/teams/${mapping.teamId}/documents/${documentId}/content`;

    try {
      // Initial sync to keepsync - create the document first
      const content = await this.app.vault.read(file);
      await writeDoc(keepsyncPath, { content });

      // Listen to remote changes
      const unsubscribe = await listenToDoc(keepsyncPath, async payload => {
        const { doc } = payload;
        if (!doc) return;

        const currentFile = this.app.vault.getAbstractFileByPath(
          mapping.localPath
        );
        if (!(currentFile instanceof TFile)) return;

        const currentContent = await this.app.vault.read(currentFile);
        const docContent = (doc as any)?.content || '';
        if (docContent !== currentContent) {
          // Mark to ignore the next change event to prevent sync loop
          this.syncOrchestrator.ignoreNextChange.add(currentFile.path);
          await this.app.vault.modify(currentFile, docContent);

          // Update mapping hash
          const updatedMapping =
            this.mappingManager.findMappingById(documentId);
          if (updatedMapping) {
            const hash = this.mappingManager.hashContent(docContent);
            await this.mappingManager.updateLastSyncedHash(documentId, hash);
          }
        }
      });

      this.listeners.set(documentId, unsubscribe);
    } catch (error) {
      console.error('Failed to setup bidirectional sync:', error);
      throw error;
    }
  }

  async restoreAllSyncListeners(): Promise<void> {
    for (const [docId, mapping] of Object.entries(
      this.settings.documentMappings
    )) {
      const file = this.app.vault.getAbstractFileByPath(mapping.localPath);
      if (file instanceof TFile) {
        try {
          await this.setupBidirectionalSync(file, docId);
        } catch (error) {
          console.error(
            `Failed to restore sync for ${mapping.localPath}:`,
            error
          );
        }
      }
    }
  }

  private async addFrontmatterMetadata(
    file: TFile,
    documentId: string
  ): Promise<void> {
    const content = await this.app.vault.read(file);
    const lines = content.split('\n');

    // Check if frontmatter already exists
    if (lines[0] === '---') {
      // Find the end of existing frontmatter
      let endIndex = -1;
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] === '---') {
          endIndex = i;
          break;
        }
      }

      if (endIndex !== -1) {
        // Insert hivemind-id before the closing ---
        lines.splice(endIndex, 0, `hivemind-id: ${documentId}`);
      }
    } else {
      // Add new frontmatter
      lines.unshift('---', `hivemind-id: ${documentId}`, '---', '');
    }

    const newContent = lines.join('\n');
    await this.app.vault.modify(file, newContent);
  }

  private async removeFrontmatterMetadata(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const lines = content.split('\n');

    if (lines[0] === '---') {
      let endIndex = -1;
      let hivemindLineIndex = -1;

      for (let i = 1; i < lines.length; i++) {
        if (lines[i] === '---') {
          endIndex = i;
          break;
        }
        if (lines[i].startsWith('hivemind-id:')) {
          hivemindLineIndex = i;
        }
      }

      if (hivemindLineIndex !== -1) {
        lines.splice(hivemindLineIndex, 1);

        // If frontmatter is now empty, remove it entirely
        if (endIndex - 1 === 1) {
          // Only --- lines left
          lines.splice(0, 3); // Remove ---, ---, and empty line
        }

        const newContent = lines.join('\n');
        await this.app.vault.modify(file, newContent);
      }
    }
  }

  private async createSharedDocumentMetadata(
    file: TFile,
    documentId: string,
    teamId: string
  ): Promise<void> {
    const metadata: SharedDocumentMetadata = {
      documentId,
      originalName: file.basename,
      createdBy: this.settings.userId,
      createdAt: Date.now(),
    };

    const metadataPath = `/teams/${teamId}/documents/${documentId}/metadata`;
    await writeDoc(metadataPath, { metadata });
  }

  private async updateTeamIndex(
    action: 'add' | 'remove',
    documentId: string,
    teamId: string
  ): Promise<void> {
    const indexPath = `/teams/${teamId}/index`;

    try {
      const indexDoc = await readDoc<{ teamIndex: string[] }>(indexPath);
      let teamIndex = indexDoc?.teamIndex || [];

      if (action === 'add') {
        if (!teamIndex.includes(documentId)) {
          teamIndex = [...teamIndex, documentId];
        }
      } else if (action === 'remove') {
        teamIndex = teamIndex.filter((id: string) => id !== documentId);
      }

      await writeDoc(indexPath, { teamIndex });
    } catch (error) {
      console.error('Failed to update team index:', error);
    }
  }

  cleanup(): void {
    // Unsubscribe from all listeners
    for (const unsubscribe of this.listeners.values()) {
      unsubscribe();
    }
    this.listeners.clear();
  }
}
