# Hivemind Plugin Implementation Plan

## Overview
Real-time collaborative note-sharing plugin for Obsidian using keepsync. Allows team members to mark notes as shared and sync them in real-time across all connected devices, with each user maintaining their own file structure.

## Core Architecture

### Key Principle: User-Specific Path Mapping
Each shared document gets a unique ID, and each user maintains their own local mapping of where that document lives in their vault.

```typescript
// In keepsync, documents are identified by unique IDs:
/teams/{teamId}/documents/{documentId}/content     // The actual document content
/teams/{teamId}/documents/{documentId}/metadata    // Shared metadata (original name, creator, etc.)

// Each user maintains their own local mapping:
// User A: documentId "doc_123" -> "Projects/Meeting Notes/standup.md"
// User B: documentId "doc_123" -> "Work/Daily/2024-01-15.md"
// User C: documentId "doc_123" -> "team-notes/standup-notes.md"
```

## Phase 1: Foundation & Mapping System

### 1.1 Data Models

```typescript
// Local mapping stored in plugin data
interface LocalDocumentMapping {
  documentId: string;          // Unique ID shared across team
  localPath: string;           // Where THIS user stores the file
  teamId: string;
  lastSyncedHash: string;      // For detecting changes
  lastKnownPath: string;       // For recovery if moved
  sharedAt: number;
  sharedBy?: string;           // Who originally shared it
}

interface HivemindSettings {
  userId: string;
  syncServerUrl: string;
  
  // User's personal document mappings
  documentMappings: Record<string, LocalDocumentMapping>;
  
  // Teams this user belongs to
  teams: string[];
}

// Shared document metadata (stored in keepsync)
interface SharedDocumentMetadata {
  documentId: string;
  originalName: string;        // Suggested name (not enforced)
  createdBy: string;
  createdAt: number;
  description?: string;        // Optional description of the document
}
```

### 1.2 Core Services

```typescript
// src/services/KeepsyncService.ts
class KeepsyncService {
  private initialized = false;
  
  async initialize(serverUrl: string) {
    const wsAdapter = new BrowserWebSocketClientAdapter(`${serverUrl}/sync`);
    const storage = new IndexedDBStorageAdapter();
    
    configureSyncEngine({
      url: serverUrl,
      network: [wsAdapter as any],
      storage,
    });
    
    this.initialized = true;
  }
}

// src/services/DocumentMappingManager.ts
class DocumentMappingManager {
  private mappings: Map<string, LocalDocumentMapping>;
  
  // Share a local file - creates new document ID
  async shareNewDocument(file: TFile, teamId: string): Promise<string>
  
  // Join an existing shared document - user chooses where to save it
  async joinSharedDocument(documentId: string, teamId: string, localPath?: string): Promise<void>
  
  // Find mapping by local file path
  findMappingByPath(path: string): LocalDocumentMapping | null
  
  // Find mapping by document ID
  findMappingById(documentId: string): LocalDocumentMapping | null
  
  // Update mapping when file is moved/renamed
  async updateMapping(documentId: string, newPath: string): Promise<void>
  
  private generateDocumentId(): string
  private hashContent(content: string): string
}

// src/services/FileRecoveryService.ts
class FileRecoveryService {
  async reconcileMappings(): Promise<void>
  private async attemptRecovery(orphaned: LocalDocumentMapping[]): Promise<void>
  private async findByContent(mapping: LocalDocumentMapping): Promise<TFile | null>
  private async findByFrontmatter(documentId: string): Promise<TFile | null>
  private async recreateFromRemote(mapping: LocalDocumentMapping): Promise<void>
}

// src/services/SyncOrchestrator.ts
class SyncOrchestrator {
  private debounceTimers: Map<string, NodeJS.Timeout>;
  private ignoreNextChange: Set<string>;
  
  setupEventListeners(): void
  async syncToKeepsync(file: TFile, content: string): Promise<void>
  async syncFromKeepsync(documentId: string, content: any): Promise<void>
  private debounceSync(file: TFile, callback: () => void): void
}
```

## Phase 2: Sync Implementation

### 2.1 Bidirectional Sync

```typescript
class SharedNoteManager {
  private listeners: Map<string, () => void> = new Map();
  
  async shareNote(file: TFile) {
    // 1. Generate document ID and create mapping
    const documentId = await this.mappingManager.shareNewDocument(file, this.settings.teamId);
    
    // 2. Add frontmatter metadata
    await this.addFrontmatterMetadata(file, documentId);
    
    // 3. Set up bidirectional sync
    await this.setupBidirectionalSync(file, documentId);
    
    // 4. Update team index
    await this.updateTeamIndex('add', documentId);
  }
  
  private async setupBidirectionalSync(file: TFile, documentId: string) {
    const keepsyncPath = `/teams/${this.settings.teamId}/documents/${documentId}/content`;
    
    // Listen to remote changes
    const unsubscribe = await listenToDoc(keepsyncPath, async (payload) => {
      const { doc } = payload;
      if (!doc) return;
      
      const currentContent = await this.app.vault.read(file);
      if (doc !== currentContent) {
        this.syncOrchestrator.ignoreNextChange.add(file.path);
        await this.app.vault.modify(file, doc);
        
        // Update mapping hash
        const mapping = this.mappingManager.findMappingById(documentId);
        if (mapping) {
          mapping.lastSyncedHash = this.hashContent(doc);
          await this.mappingManager.persistMappings();
        }
      }
    });
    
    this.listeners.set(documentId, unsubscribe);
  }
}
```

### 2.2 Event Handlers

```typescript
// In HivemindPlugin.onload()
// Editor changes (real-time)
this.registerEvent(
  this.app.workspace.on('editor-change', (editor, info) => {
    this.syncOrchestrator.handleEditorChange(editor, info);
  })
);

// File operations
this.registerEvent(
  this.app.vault.on('modify', (file) => {
    this.syncOrchestrator.handleFileModify(file);
  })
);

this.registerEvent(
  this.app.vault.on('rename', (file, oldPath) => {
    this.syncOrchestrator.handleFileRename(file, oldPath);
  })
);

this.registerEvent(
  this.app.vault.on('delete', (file) => {
    this.syncOrchestrator.handleFileDelete(file);
  })
);
```

## Phase 3: UI Implementation

### 3.1 Status Bar

```typescript
class SyncStatusBar {
  private statusEl: HTMLElement;
  private syncQueue: number = 0;
  
  constructor(plugin: HivemindPlugin) {
    this.statusEl = plugin.addStatusBarItem();
    this.updateDisplay();
  }
  
  incrementQueue() {
    this.syncQueue++;
    this.updateDisplay();
  }
  
  decrementQueue() {
    this.syncQueue = Math.max(0, this.syncQueue - 1);
    this.updateDisplay();
  }
  
  private updateDisplay() {
    const icon = this.syncQueue > 0 ? '↻' : '✓';
    const text = this.syncQueue > 0 
      ? `Hivemind: ${icon} Syncing ${this.syncQueue} changes`
      : `Hivemind: ${icon} Synced`;
    this.statusEl.setText(text);
  }
}
```

### 3.2 Context Menu & Commands

```typescript
// File context menu
this.registerEvent(
  this.app.workspace.on('file-menu', (menu, file) => {
    if (file instanceof TFile && file.extension === 'md') {
      const mapping = this.mappingManager.findMappingByPath(file.path);
      const isShared = !!mapping;
      
      menu.addItem((item) => {
        item
          .setTitle(isShared ? '🔗 Unshare note' : '🔗 Share with team')
          .onClick(async () => {
            if (isShared) {
              await this.unshareNote(file);
              new Notice(`Unshared: ${file.basename}`);
            } else {
              await this.shareNote(file);
              new Notice(`Shared: ${file.basename}`);
            }
          });
      });
      
      if (isShared) {
        menu.addItem((item) => {
          item
            .setTitle('📋 Copy share link')
            .onClick(() => {
              const link = `hivemind://${mapping.teamId}/${mapping.documentId}`;
              navigator.clipboard.writeText(link);
              new Notice('Share link copied!');
            });
        });
      }
    }
  })
);

// Commands
this.addCommand({
  id: 'share-current-note',
  name: 'Share current note with team',
  editorCheckCallback: (checking, editor, ctx) => {
    const file = ctx.file;
    if (!file) return false;
    
    const isShared = !!this.mappingManager.findMappingByPath(file.path);
    if (checking) return !isShared;
    
    this.shareNote(file);
    return true;
  }
});
```

### 3.3 Settings Tab

```typescript
class HivemindSettingTab extends PluginSettingTab {
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    
    containerEl.createEl('h2', { text: 'Hivemind Settings' });
    
    new Setting(containerEl)
      .setName('User ID')
      .setDesc('Your unique identifier')
      .addText(text => text
        .setPlaceholder('your-username')
        .setValue(this.plugin.settings.userId)
        .onChange(async (value) => {
          this.plugin.settings.userId = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Sync Server URL')
      .setDesc('WebSocket server for real-time sync')
      .addText(text => text
        .setPlaceholder('ws://localhost:7777')
        .setValue(this.plugin.settings.syncServerUrl)
        .onChange(async (value) => {
          this.plugin.settings.syncServerUrl = value;
          await this.plugin.saveSettings();
        }));
    
    // Show shared notes
    containerEl.createEl('h3', { text: 'Shared Notes' });
    const sharedList = containerEl.createEl('div', { cls: 'hivemind-shared-list' });
    
    for (const [docId, mapping] of Object.entries(this.plugin.settings.documentMappings)) {
      const item = sharedList.createEl('div', { cls: 'hivemind-shared-item' });
      item.createEl('span', { text: mapping.localPath });
      new ButtonComponent(item)
        .setButtonText('Unshare')
        .onClick(async () => {
          await this.plugin.unshareByDocumentId(docId);
          this.display(); // Refresh
        });
    }
  }
}
```

## Phase 4: Recovery & Robustness

### 4.1 File Recovery System

```typescript
class FileRecoveryService {
  async reconcileMappings() {
    const orphanedMappings: LocalDocumentMapping[] = [];
    
    for (const [docId, mapping] of Object.entries(this.plugin.settings.documentMappings)) {
      const file = this.app.vault.getAbstractFileByPath(mapping.localPath);
      
      if (!file) {
        // File not found at expected location
        orphanedMappings.push(mapping);
      }
    }
    
    if (orphanedMappings.length > 0) {
      await this.attemptRecovery(orphanedMappings);
    }
  }
  
  private async attemptRecovery(orphanedMappings: LocalDocumentMapping[]) {
    // Strategy 1: Search by filename
    for (const mapping of orphanedMappings) {
      const basename = this.getBasename(mapping.lastKnownPath);
      const candidates = this.app.vault.getFiles()
        .filter(f => f.basename === basename);
      
      if (candidates.length === 1) {
        // Single match - likely the moved file
        await this.relinkMapping(mapping, candidates[0]);
        continue;
      }
      
      // Strategy 2: Content matching (for multiple candidates or renamed files)
      if (candidates.length > 0 || mapping.lastSyncedHash) {
        const matchedFile = await this.findByContent(mapping);
        if (matchedFile) {
          await this.relinkMapping(mapping, matchedFile);
          continue;
        }
      }
      
      // Strategy 3: Frontmatter matching
      const frontmatterMatch = await this.findByFrontmatter(mapping.documentId);
      if (frontmatterMatch) {
        await this.relinkMapping(mapping, frontmatterMatch);
        continue;
      }
      
      // Strategy 4: Ask user
      await this.promptUserForRecovery(mapping);
    }
  }
  
  private async findByContent(mapping: LocalDocumentMapping): Promise<TFile | null> {
    const files = this.app.vault.getFiles();
    
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const hash = this.hashContent(content);
      
      // Check if content matches or is very similar
      if (hash === mapping.lastSyncedHash || 
          this.calculateSimilarity(content, mapping) > 0.9) {
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
}
```

### 4.2 Recovery Modal

```typescript
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
      text: `Cannot find shared note: ${this.mapping.lastKnownPath}` 
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
    
    new ButtonComponent(contentEl)
      .setButtonText('Ignore')
      .onClick(() => {
        this.close();
        this.onChoice('ignore');
      });
  }
}
```

### 4.3 Startup Recovery

```typescript
class HivemindPlugin extends Plugin {
  async onload() {
    // Load settings and mappings
    await this.loadSettings();
    
    // Initialize keepsync
    await this.keepsyncService.initialize(this.settings.syncServerUrl);
    
    // Reconcile mappings (handle moved/deleted files)
    await this.fileRecoveryService.reconcileMappings();
    
    // Re-establish listeners for all shared notes
    for (const [docId, mapping] of Object.entries(this.settings.documentMappings)) {
      const file = this.app.vault.getAbstractFileByPath(mapping.localPath);
      if (file instanceof TFile) {
        await this.sharedNoteManager.setupBidirectionalSync(file, docId);
      }
    }
    
    // Set up event listeners
    this.syncOrchestrator.setupEventListeners();
  }
}
```

## Phase 5: Team Management

### 5.1 Team Discovery

```typescript
class TeamManager {
  async joinTeam(teamId: string) {
    // Get list of shared documents in team
    const teamIndex = await readDoc<string[]>(`/teams/${teamId}/index`);
    
    if (teamIndex) {
      // Show user available documents to sync
      new TeamDocumentsModal(this.app, teamId, teamIndex, async (selectedDocs) => {
        for (const docId of selectedDocs) {
          await this.joinDocument(docId, teamId);
        }
      }).open();
    }
    
    // Add team to user's team list
    if (!this.plugin.settings.teams.includes(teamId)) {
      this.plugin.settings.teams.push(teamId);
      await this.plugin.saveSettings();
    }
  }
  
  private async joinDocument(documentId: string, teamId: string) {
    // Fetch document metadata
    const metadata = await readDoc<SharedDocumentMetadata>(`/teams/${teamId}/documents/${documentId}/metadata`);
    
    // Prompt user for local save location
    const suggestedName = metadata?.originalName || 'shared-document.md';
    const localPath = await this.promptForSaveLocation(suggestedName);
    
    if (localPath) {
      await this.mappingManager.joinSharedDocument(documentId, teamId, localPath);
    }
  }
}
```

## Dependencies

```json
{
  "dependencies": {
    "@tonk/keepsync": "latest",
    "@automerge/automerge-repo-network-websocket": "latest",
    "@automerge/automerge-repo-storage-indexeddb": "latest",
    "crypto-js": "latest"
  }
}
```

## Implementation Timeline

- **Week 1**: Foundation & mapping system
- **Week 2**: Sync implementation & event handlers
- **Week 3**: UI components & user experience
- **Week 4**: Recovery system & robustness
- **Week 5**: Team management & testing

## Key Benefits

- **Flexible file organization**: Each user maintains their own structure
- **Robust recovery**: Multiple strategies for handling moved/deleted files
- **Real-time sync**: Instant updates using keepsync's CRDT technology
- **Conflict-free**: Automerge handles concurrent edits automatically
- **Offline support**: Works offline, syncs when reconnected
- **Team-based**: Multiple teams, granular sharing control