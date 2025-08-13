import { configureSyncEngine } from '@tonk/keepsync';
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';

export class KeepsyncService {
  private initialized = false;
  private onReconnectCallbacks: (() => Promise<void>)[] = [];

  async initialize(serverUrl: string): Promise<void> {
    const wasInitialized = this.initialized;

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

      // If this is a reconnection (was previously initialized), notify callbacks
      if (wasInitialized) {
        await this.notifyReconnect();
      }
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

  /**
   * Register a callback to be called when the service reconnects
   */
  onReconnect(callback: () => Promise<void>): void {
    this.onReconnectCallbacks.push(callback);
  }

  /**
   * Remove a reconnection callback
   */
  removeReconnectCallback(callback: () => Promise<void>): void {
    const index = this.onReconnectCallbacks.indexOf(callback);
    if (index > -1) {
      this.onReconnectCallbacks.splice(index, 1);
    }
  }

  /**
   * Notify all reconnection callbacks
   */
  private async notifyReconnect(): Promise<void> {
    for (const callback of this.onReconnectCallbacks) {
      try {
        await callback();
      } catch (error) {
        console.error('Error in reconnection callback:', error);
      }
    }
  }
}
