import { TFile, App, Editor, MarkdownView } from 'obsidian';
import { DocumentMappingManager } from './DocumentMappingManager';

export class SyncOrchestrator {
  private app: App;
  private mappingManager: DocumentMappingManager;
  private debounceTimers: Map<string, NodeJS.Timeout>;
  private ignoreNextChange: Set<string>;

  constructor(app: App, mappingManager: DocumentMappingManager) {
    this.app = app;
    this.mappingManager = mappingManager;
    this.debounceTimers = new Map();
    this.ignoreNextChange = new Set();
  }

  setupEventListeners(): void {
    this.app.workspace.on('editor-change', (editor, info) => {
      this.handleEditorChange(editor, info);
    });

    this.app.vault.on('modify', file => {
      if (file instanceof TFile) {
        this.handleFileModify(file);
      }
    });

    this.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile) {
        this.handleFileRename(file, oldPath);
      }
    });

    this.app.vault.on('delete', file => {
      if (file instanceof TFile) {
        this.handleFileDelete(file);
      }
    });
  }

  private handleEditorChange(editor: Editor, info: MarkdownView | any): void {
    const file = info.file;
    if (!file) return;

    const mapping = this.mappingManager.findMappingByPath(file.path);
    if (!mapping) return;

    if (this.ignoreNextChange.has(file.path)) {
      this.ignoreNextChange.delete(file.path);
      return;
    }

    this.debounceSync(file, () => {
      const content = editor.getValue();
      this.syncToKeepsync(file, content);
    });
  }

  private async handleFileModify(file: TFile): Promise<void> {
    const mapping = this.mappingManager.findMappingByPath(file.path);
    if (!mapping) return;

    if (this.ignoreNextChange.has(file.path)) {
      this.ignoreNextChange.delete(file.path);
      return;
    }

    this.debounceSync(file, async () => {
      const content = await this.app.vault.read(file);
      await this.syncToKeepsync(file, content);
    });
  }

  private async handleFileRename(file: TFile, oldPath: string): Promise<void> {
    const mapping = this.mappingManager.findMappingByPath(oldPath);
    if (mapping) {
      await this.mappingManager.updateMapping(mapping.documentId, file.path);
    }
  }

  private async handleFileDelete(file: TFile): Promise<void> {
    const mapping = this.mappingManager.findMappingByPath(file.path);
    if (mapping) {
      console.log(
        `Shared file deleted: ${file.path}. Mapping preserved for recovery.`
      );
    }
  }

  async syncToKeepsync(file: TFile, content: string): Promise<void> {
    const mapping = this.mappingManager.findMappingByPath(file.path);
    if (!mapping) return;

    try {
      console.log(`Syncing to keepsync: ${mapping.documentId}`);

      const hash = this.mappingManager.hashContent(content);
      await this.mappingManager.updateLastSyncedHash(mapping.documentId, hash);
    } catch (error) {
      console.error('Failed to sync to keepsync:', error);
    }
  }

  async syncFromKeepsync(documentId: string, content: any): Promise<void> {
    const mapping = this.mappingManager.findMappingById(documentId);
    if (!mapping) return;

    try {
      const file = this.app.vault.getAbstractFileByPath(mapping.localPath);
      if (!(file instanceof TFile)) return;

      const currentContent = await this.app.vault.read(file);
      if (content !== currentContent) {
        this.ignoreNextChange.add(file.path);
        await this.app.vault.modify(file, content);

        const hash = this.mappingManager.hashContent(content);
        await this.mappingManager.updateLastSyncedHash(documentId, hash);
      }
    } catch (error) {
      console.error('Failed to sync from keepsync:', error);
    }
  }

  private debounceSync(file: TFile, callback: () => void): void {
    const existingTimer = this.debounceTimers.get(file.path);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      callback();
      this.debounceTimers.delete(file.path);
    }, 500);

    this.debounceTimers.set(file.path, timer);
  }

  cleanup(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.ignoreNextChange.clear();
  }
}
