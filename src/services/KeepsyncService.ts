import { configureSyncEngine } from '@tonk/keepsync';
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';

export class KeepsyncService {
  private initialized = false;

  async initialize(serverUrl: string): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Convert ws:// to http:// for the HTTP API
      const httpUrl = serverUrl
        .replace('ws://', 'http://')
        .replace('wss://', 'https://');

      // Use the original WebSocket URL for the network adapter
      const wsAdapter = new BrowserWebSocketClientAdapter(`${serverUrl}/sync`);
      const storage = new IndexedDBStorageAdapter();

      const engine = await configureSyncEngine({
        url: httpUrl,
        network: [wsAdapter as any],
        storage,
      });

      await engine.whenReady();
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize KeepsyncService:', error);
      throw error;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }
}
