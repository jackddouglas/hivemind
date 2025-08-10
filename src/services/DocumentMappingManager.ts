import { TFile, App } from 'obsidian';
import { LocalDocumentMapping, HivemindSettings } from '../types';

export class DocumentMappingManager {
  private mappings: Map<string, LocalDocumentMapping>;
  private settings: HivemindSettings;
  private saveCallback: () => Promise<void>;
  private app: App;

  constructor(
    app: App,
    settings: HivemindSettings,
    saveCallback: () => Promise<void>
  ) {
    this.app = app;
    this.settings = settings;
    this.saveCallback = saveCallback;
    this.mappings = new Map();
    this.loadMappings();
  }

  private loadMappings(): void {
    for (const [docId, mapping] of Object.entries(
      this.settings.documentMappings
    )) {
      this.mappings.set(docId, mapping);
    }
  }

  async shareNewDocument(file: TFile, teamId: string): Promise<string> {
    const documentId = this.generateDocumentId();
    const content = await this.app.vault.read(file);
    const hash = this.hashContent(content);

    const mapping: LocalDocumentMapping = {
      documentId,
      localPath: file.path,
      teamId,
      lastSyncedHash: hash,
      lastKnownPath: file.path,
      sharedAt: Date.now(),
      sharedBy: this.settings.userId,
    };

    this.mappings.set(documentId, mapping);
    this.settings.documentMappings[documentId] = mapping;
    await this.saveCallback();

    return documentId;
  }

  async joinSharedDocument(
    documentId: string,
    teamId: string,
    localPath?: string
  ): Promise<void> {
    if (this.mappings.has(documentId)) {
      throw new Error(`Document ${documentId} is already mapped`);
    }

    if (!localPath) {
      throw new Error('Local path is required when joining a shared document');
    }

    const mapping: LocalDocumentMapping = {
      documentId,
      localPath,
      teamId,
      lastSyncedHash: '',
      lastKnownPath: localPath,
      sharedAt: Date.now(),
    };

    this.mappings.set(documentId, mapping);
    this.settings.documentMappings[documentId] = mapping;
    await this.saveCallback();
  }

  findMappingByPath(path: string): LocalDocumentMapping | null {
    for (const mapping of this.mappings.values()) {
      if (mapping.localPath === path) {
        return mapping;
      }
    }
    return null;
  }

  findMappingById(documentId: string): LocalDocumentMapping | null {
    return this.mappings.get(documentId) || null;
  }

  async updateMapping(documentId: string, newPath: string): Promise<void> {
    const mapping = this.mappings.get(documentId);
    if (!mapping) {
      throw new Error(`No mapping found for document ${documentId}`);
    }

    mapping.lastKnownPath = mapping.localPath;
    mapping.localPath = newPath;

    this.settings.documentMappings[documentId] = mapping;
    await this.saveCallback();
  }

  async removeMapping(documentId: string): Promise<void> {
    this.mappings.delete(documentId);
    delete this.settings.documentMappings[documentId];
    await this.saveCallback();
  }

  async updateLastSyncedHash(documentId: string, hash: string): Promise<void> {
    const mapping = this.mappings.get(documentId);
    if (mapping) {
      mapping.lastSyncedHash = hash;
      this.settings.documentMappings[documentId] = mapping;
      await this.saveCallback();
    }
  }

  getAllMappings(): LocalDocumentMapping[] {
    return Array.from(this.mappings.values());
  }

  private generateDocumentId(): string {
    return `doc_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  hashContent(content: string): string {
    let hash = 0;
    if (content.length === 0) return hash.toString();
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString();
  }
}
