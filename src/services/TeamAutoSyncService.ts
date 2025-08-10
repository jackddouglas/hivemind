import { App, Notice, TFile } from 'obsidian';
import { readDoc, listenToDoc } from '@tonk/keepsync';
import type HivemindPlugin from '../../main';
import { DocumentMappingManager } from './DocumentMappingManager';
import { TeamManager } from './TeamManager';
import type { SharedDocumentMetadata } from '../types';

export class TeamAutoSyncService {
  private app: App;
  private plugin: HivemindPlugin;
  private mappingManager: DocumentMappingManager;
  private teamManager: TeamManager;
  private activeListeners: Map<string, () => void> = new Map();

  constructor(
    plugin: HivemindPlugin,
    mappingManager: DocumentMappingManager,
    teamManager: TeamManager
  ) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.mappingManager = mappingManager;
    this.teamManager = teamManager;
  }

  /**
   * Start auto-sync for all enabled teams
   */
  async startAutoSync(): Promise<void> {
    const autoSyncTeams = Object.entries(this.plugin.settings.teamAutoSync)
      .filter(([_, enabled]) => enabled)
      .map(([teamId]) => teamId);

    for (const teamId of autoSyncTeams) {
      await this.startTeamAutoSync(teamId);
    }
  }

  /**
   * Start auto-sync for a specific team
   */
  async startTeamAutoSync(teamId: string): Promise<void> {
    if (this.activeListeners.has(teamId)) {
      return; // Already listening
    }

    try {
      const indexPath = `/teams/${teamId}/index`;

      // Set up listener for team index changes
      const unsubscribe = await listenToDoc(indexPath, async docObject => {
        await this.handleTeamIndexChange(teamId, docObject);
      });

      this.activeListeners.set(teamId, unsubscribe);
      console.log(`Started auto-sync for team: ${teamId}`);
    } catch (error) {
      console.error(`Failed to start auto-sync for team ${teamId}:`, error);
    }
  }

  /**
   * Stop auto-sync for a specific team
   */
  stopTeamAutoSync(teamId: string): void {
    const unsubscribe = this.activeListeners.get(teamId);
    if (unsubscribe) {
      unsubscribe();
      this.activeListeners.delete(teamId);
      console.log(`Stopped auto-sync for team: ${teamId}`);
    }
  }

  /**
   * Stop all auto-sync listeners
   */
  stopAllAutoSync(): void {
    for (const [teamId] of this.activeListeners) {
      this.stopTeamAutoSync(teamId);
    }
  }

  /**
   * Enable auto-sync for a team
   */
  async enableTeamAutoSync(teamId: string): Promise<void> {
    this.plugin.settings.teamAutoSync[teamId] = true;
    await this.plugin.saveSettings();
    await this.startTeamAutoSync(teamId);
  }

  /**
   * Disable auto-sync for a team
   */
  async disableTeamAutoSync(teamId: string): Promise<void> {
    this.plugin.settings.teamAutoSync[teamId] = false;
    await this.plugin.saveSettings();
    this.stopTeamAutoSync(teamId);
  }

  /**
   * Check if auto-sync is enabled for a team
   */
  isTeamAutoSyncEnabled(teamId: string): boolean {
    return this.plugin.settings.teamAutoSync[teamId] === true;
  }

  /**
   * Sync all existing documents in a team
   */
  async syncAllTeamDocuments(teamId: string): Promise<void> {
    try {
      const documents = await this.teamManager.getTeamDocuments(teamId);
      let syncedCount = 0;

      for (const doc of documents) {
        const existingMapping = this.mappingManager.findMappingById(
          doc.documentId
        );
        if (!existingMapping) {
          await this.autoSyncDocument(teamId, doc.documentId, doc);
          syncedCount++;
        }
      }

      if (syncedCount > 0) {
        new Notice(
          `Auto-synced ${syncedCount} document(s) from team: ${teamId}`
        );
      } else {
        new Notice(`All documents from team ${teamId} are already synced`);
      }
    } catch (error) {
      console.error(`Failed to sync all documents for team ${teamId}:`, error);
      new Notice(`Failed to sync documents from team: ${teamId}`);
    }
  }

  /**
   * Handle changes to a team's document index
   */
  private async handleTeamIndexChange(
    teamId: string,
    docObject: any
  ): Promise<void> {
    try {
      const teamIndex = docObject?.teamIndex || [];
      const currentMappings = Object.values(
        this.plugin.settings.documentMappings
      )
        .filter(m => m.teamId === teamId)
        .map(m => m.documentId);

      // Find new documents that aren't already synced
      const newDocuments = teamIndex.filter(
        (docId: string) => !currentMappings.includes(docId)
      );

      for (const documentId of newDocuments) {
        await this.autoSyncDocument(teamId, documentId);
      }

      if (newDocuments.length > 0) {
        new Notice(
          `Auto-synced ${newDocuments.length} new document(s) from team: ${teamId}`
        );
      }
    } catch (error) {
      console.error(`Error handling team index change for ${teamId}:`, error);
    }
  }

  /**
   * Automatically sync a single document
   */
  private async autoSyncDocument(
    teamId: string,
    documentId: string,
    metadata?: SharedDocumentMetadata
  ): Promise<void> {
    try {
      // Fetch metadata if not provided
      if (!metadata) {
        const metadataPath = `/teams/${teamId}/documents/${documentId}/metadata`;
        const metadataDoc = await readDoc<{ metadata: SharedDocumentMetadata }>(
          metadataPath
        );
        metadata = metadataDoc?.metadata;
      }

      if (!metadata) {
        console.error(`Could not fetch metadata for document ${documentId}`);
        return;
      }

      // Generate auto-sync path
      const localPath = this.generateAutoSyncPath(
        teamId,
        metadata.originalName || 'untitled.md'
      );

      // Fetch document content
      const contentPath = `/teams/${teamId}/documents/${documentId}/content`;
      const contentDoc = await readDoc<{ content: string }>(contentPath);
      const content = contentDoc?.content || '';

      // Create the file locally
      const file = await this.createLocalFile(localPath, content);

      if (file) {
        // Create mapping
        await this.mappingManager.joinSharedDocument(
          documentId,
          teamId,
          localPath
        );
        console.log(`Auto-synced document: ${localPath}`);
      }
    } catch (error) {
      console.error(`Failed to auto-sync document ${documentId}:`, error);
    }
  }

  /**
   * Generate the local path for an auto-synced document
   */
  private generateAutoSyncPath(teamId: string, originalName: string): string {
    const { teamSyncFolder, organizeSyncByTeam } = this.plugin.settings;

    let basePath = teamSyncFolder;
    if (organizeSyncByTeam) {
      basePath = `${teamSyncFolder}/${teamId}`;
    }

    // Ensure the filename has .md extension
    let filename = originalName;
    if (!filename.endsWith('.md')) {
      filename += '.md';
    }

    // Handle potential filename conflicts
    let finalPath = `${basePath}/${filename}`;
    let counter = 1;

    while (this.app.vault.getAbstractFileByPath(finalPath)) {
      const nameWithoutExt = filename.replace(/\.md$/, '');
      finalPath = `${basePath}/${nameWithoutExt} (${counter}).md`;
      counter++;
    }

    return finalPath;
  }

  /**
   * Create a local file with the given content
   */
  private async createLocalFile(
    path: string,
    content: string
  ): Promise<TFile | null> {
    try {
      // Ensure directory exists
      const dir = path.substring(0, path.lastIndexOf('/'));
      if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
        await this.app.vault.createFolder(dir);
      }

      // Create the file
      const file = await this.app.vault.create(path, content);
      return file;
    } catch (error) {
      console.error('Error creating local file:', error);
      return null;
    }
  }
}
