import { Plugin } from 'obsidian';

export class SyncStatusBar {
  private statusEl: HTMLElement;
  private syncQueue: number = 0;
  private isConnected: boolean = false;

  constructor(plugin: Plugin) {
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

  setConnected(connected: boolean) {
    this.isConnected = connected;
    this.updateDisplay();
  }

  private updateDisplay() {
    if (!this.isConnected) {
      this.statusEl.setText('Hivemind: Disconnected');
      this.statusEl.addClass('hivemind-status-disconnected');
      return;
    }

    this.statusEl.removeClass('hivemind-status-disconnected');

    const icon = this.syncQueue > 0 ? '↻' : '✓';
    const text =
      this.syncQueue > 0
        ? `Hivemind: ${icon} Syncing ${this.syncQueue} changes`
        : `Hivemind: ${icon} Synced`;

    this.statusEl.setText(text);

    if (this.syncQueue > 0) {
      this.statusEl.addClass('hivemind-status-syncing');
    } else {
      this.statusEl.removeClass('hivemind-status-syncing');
    }
  }

  destroy() {
    this.statusEl.remove();
  }
}
