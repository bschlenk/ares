export interface CheckpointGame { hash: string; system: string; title: string }
export interface CheckpointMetadata {
  schema: 1; capturedAt: string; offset: string; game: CheckpointGame; name: string; permanent: boolean;
  state: {bytes: number; sha256: string}; screenshot: {bytes: number; sha256: string; width?: number; height?: number; aspect?: number}; compatibility: Record<string, unknown>;
}
export interface CheckpointEntry extends CheckpointMetadata { id: string; screenshotUrl?: string }
