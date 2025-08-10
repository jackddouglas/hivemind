export interface LocalDocumentMapping {
  documentId: string;
  localPath: string;
  teamId: string;
  lastSyncedHash: string;
  lastKnownPath: string;
  sharedAt: number;
  sharedBy?: string;
}

export interface HivemindSettings {
  userId: string;
  syncServerUrl: string;
  documentMappings: Record<string, LocalDocumentMapping>;
  teams: string[];
}

export interface SharedDocumentMetadata {
  documentId: string;
  originalName: string;
  createdBy: string;
  createdAt: number;
  description?: string;
}

export const DEFAULT_SETTINGS: HivemindSettings = {
  userId: '',
  syncServerUrl: 'ws://localhost:7777',
  documentMappings: {},
  teams: [],
};