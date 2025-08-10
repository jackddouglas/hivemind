import { App, Notice, TFile } from 'obsidian';
import { readDoc, writeDoc } from '@tonk/keepsync';
import type HivemindPlugin from '../../main';
import { DocumentMappingManager } from './DocumentMappingManager';
import { TeamDocumentsModal } from '../ui/TeamDocumentsModal';
import { SaveLocationModal } from '../ui/SaveLocationModal';
import type { SharedDocumentMetadata } from '../types';

export class TeamManager {
  private app: App;
  private plugin: HivemindPlugin;
  private mappingManager: DocumentMappingManager;

  constructor(plugin: HivemindPlugin, mappingManager: DocumentMappingManager) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.mappingManager = mappingManager;
  }

  /**
   * Join a team and discover available shared documents
   */
  async joinTeam(teamId: string): Promise<void> {
    try {
      // Get list of shared documents in team
      const teamIndexPath = `/teams/${teamId}/index`;
      const teamIndexDoc = await readDoc<{ teamIndex: string[] }>(
        teamIndexPath
      );
      const teamIndex = teamIndexDoc?.teamIndex || [];

      if (!teamIndex || teamIndex.length === 0) {
        new Notice(`No shared documents found in team: ${teamId}`);
        return;
      }

      // Fetch metadata for all documents
      const documentsWithMetadata = await this.fetchDocumentsMetadata(
        teamId,
        teamIndex
      );

      // Show user available documents to sync
      new TeamDocumentsModal(
        this.app,
        teamId,
        documentsWithMetadata,
        async selectedDocs => {
          for (const docId of selectedDocs) {
            await this.joinDocument(docId, teamId);
          }
          new Notice(`Joined ${selectedDocs.length} shared document(s)`);
        }
      ).open();

      // Add team to user's team list
      if (!this.plugin.settings.teams.includes(teamId)) {
        this.plugin.settings.teams.push(teamId);
        await this.plugin.saveSettings();
      }
    } catch (error) {
      console.error('Error joining team:', error);
      new Notice(`Failed to join team: ${error.message}`);
    }
  }

  /**
   * Leave a team and optionally remove all shared documents
   */
  async leaveTeam(
    teamId: string,
    removeDocuments: boolean = false
  ): Promise<void> {
    try {
      if (removeDocuments) {
        // Remove all documents from this team
        const mappings = Object.values(
          this.plugin.settings.documentMappings
        ).filter(m => m.teamId === teamId);

        for (const mapping of mappings) {
          await this.mappingManager.removeMapping(mapping.documentId);
        }
      }

      // Remove team from user's team list
      const index = this.plugin.settings.teams.indexOf(teamId);
      if (index > -1) {
        this.plugin.settings.teams.splice(index, 1);
        await this.plugin.saveSettings();
      }

      new Notice(`Left team: ${teamId}`);
    } catch (error) {
      console.error('Error leaving team:', error);
      new Notice(`Failed to leave team: ${error.message}`);
    }
  }

  /**
   * Create a new team
   */
  async createTeam(teamId: string, teamName?: string): Promise<void> {
    try {
      // Initialize team structure in keepsync
      const teamMetadata = {
        id: teamId,
        name: teamName || teamId,
        createdAt: Date.now(),
        createdBy: this.plugin.settings.userId,
        members: [this.plugin.settings.userId],
      };

      await writeDoc(`/teams/${teamId}/metadata`, teamMetadata);
      await writeDoc(`/teams/${teamId}/index`, []);

      // Add to user's teams
      if (!this.plugin.settings.teams.includes(teamId)) {
        this.plugin.settings.teams.push(teamId);
        await this.plugin.saveSettings();
      }

      new Notice(`Created team: ${teamName || teamId}`);
    } catch (error) {
      console.error('Error creating team:', error);
      new Notice(`Failed to create team: ${error.message}`);
    }
  }

  /**
   * Get list of all teams the user belongs to
   */
  getTeams(): string[] {
    return this.plugin.settings.teams || [];
  }

  /**
   * Get documents shared in a specific team
   */
  async getTeamDocuments(teamId: string): Promise<SharedDocumentMetadata[]> {
    try {
      const teamIndexDoc = await readDoc<{ teamIndex: string[] }>(
        `/teams/${teamId}/index`
      );
      const teamIndex = teamIndexDoc?.teamIndex || [];
      if (!teamIndex) return [];

      return await this.fetchDocumentsMetadata(teamId, teamIndex);
    } catch (error) {
      console.error('Error fetching team documents:', error);
      return [];
    }
  }

  /**
   * Update the team index when documents are added/removed
   */
  async updateTeamIndex(
    teamId: string,
    action: 'add' | 'remove',
    documentId: string
  ): Promise<void> {
    try {
      const indexPath = `/teams/${teamId}/index`;
      const indexDoc = await readDoc<{ teamIndex: string[] }>(indexPath);
      let index = indexDoc?.teamIndex || [];

      if (action === 'add' && !index.includes(documentId)) {
        index.push(documentId);
      } else if (action === 'remove') {
        index = index.filter(id => id !== documentId);
      }

      await writeDoc(indexPath, { teamIndex: index });
    } catch (error) {
      console.error('Error updating team index:', error);
    }
  }

  /**
   * Join a specific document from a team
   */
  private async joinDocument(
    documentId: string,
    teamId: string
  ): Promise<void> {
    try {
      // Check if already joined
      const existingMapping = this.mappingManager.findMappingById(documentId);
      if (existingMapping) {
        new Notice(`Document already synced at: ${existingMapping.localPath}`);
        return;
      }

      // Fetch document metadata
      const metadataPath = `/teams/${teamId}/documents/${documentId}/metadata`;
      const metadataDoc = await readDoc<{ metadata: SharedDocumentMetadata }>(
        metadataPath
      );
      const metadata = metadataDoc?.metadata;

      if (!metadata) {
        new Notice('Could not fetch document metadata');
        return;
      }

      // Prompt user for local save location
      const suggestedName = metadata.originalName || 'shared-document.md';

      new SaveLocationModal(this.app, suggestedName, async localPath => {
        if (localPath) {
          // Fetch the document content
          const contentPath = `/teams/${teamId}/documents/${documentId}/content`;
          const contentDoc = await readDoc<{ content: string }>(contentPath);
          const content = contentDoc?.content || '';

          // Create the file locally
          const file = await this.createLocalFile(localPath, content || '');

          if (file) {
            // Create mapping
            await this.mappingManager.joinSharedDocument(
              documentId,
              teamId,
              localPath
            );

            new Notice(`Synced document to: ${localPath}`);
          }
        }
      }).open();
    } catch (error) {
      console.error('Error joining document:', error);
      new Notice(`Failed to join document: ${error.message}`);
    }
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
      new Notice(`Failed to create file: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch metadata for multiple documents
   */
  private async fetchDocumentsMetadata(
    teamId: string,
    documentIds: string[]
  ): Promise<Array<SharedDocumentMetadata & { documentId: string }>> {
    const documentsWithMetadata = [];

    for (const docId of documentIds) {
      try {
        const metadataPath = `/teams/${teamId}/documents/${docId}/metadata`;
        const metadataDoc = await readDoc<{ metadata: SharedDocumentMetadata }>(
          metadataPath
        );
        const metadata = metadataDoc?.metadata;

        if (metadata) {
          documentsWithMetadata.push({
            ...metadata,
            documentId: docId,
          });
        }
      } catch (error) {
        console.error(`Error fetching metadata for document ${docId}:`, error);
      }
    }

    return documentsWithMetadata;
  }

  /**
   * Generate a share link for a document
   */
  generateShareLink(teamId: string, documentId: string): string {
    return `hivemind://${teamId}/${documentId}`;
  }

  /**
   * Parse a share link
   */
  parseShareLink(link: string): { teamId: string; documentId: string } | null {
    const match = link.match(/^hivemind:\/\/([^\/]+)\/([^\/]+)$/);
    if (match) {
      return {
        teamId: match[1],
        documentId: match[2],
      };
    }
    return null;
  }

  /**
   * Join a team using a share link
   */
  async joinFromShareLink(link: string): Promise<void> {
    const parsed = this.parseShareLink(link);
    if (!parsed) {
      new Notice('Invalid share link');
      return;
    }

    const { teamId, documentId } = parsed;

    // First join the team if not already a member
    if (!this.plugin.settings.teams.includes(teamId)) {
      await this.joinTeam(teamId);
    }

    // Then join the specific document
    await this.joinDocument(documentId, teamId);
  }
}
