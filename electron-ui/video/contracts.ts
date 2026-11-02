import type { FrameReference } from '../services/frame-contracts.js';
import type { VideoGeometry } from '../services/video-geometry.js';

export interface VideoOptions {
  fit?: 'contain' | 'cover';
  filtering?: 'nearest' | 'linear';
  /** Integer device-pixel scaling when the aspect-correct picture fits at >= 1x. */
  integerScale?: boolean;
}
export interface VideoSurfaceStatus {
  id: string;
  state: 'waiting' | 'live' | 'suspended' | 'unavailable' | 'disposed';
  reason: string | null;
  /** Native packet pixels, after native rendering; excludes frontend scaling. */
  source: 'native-presented';
  sourceWidth: number;
  sourceHeight: number;
  aspect: number;
  geometry: VideoGeometry | null;
  /** This surface's renderer submission, never an OS compositor timestamp. */
  frame: FrameReference | null;
  submitted: number;
  skipped: number;
}
export interface VideoSurface {
  readonly status: Readonly<VideoSurfaceStatus>;
  /** Optional host-aligned overlay; present(sample, paint) hides mismatched frames. */
  readonly overlay: import('../plugins/sdk.js').OverlayContext;
  /** Suspends only this view. Panel visibility is also enforced by the host. */
  setVisible(visible: boolean): void;
  dispose(): void;
}
