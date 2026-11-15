import type { AresBridge, RendererStats } from './bridge.js';
declare global {
  interface Window {
    beginVideoCaptureReady:typeof import('./video/capture.js').beginVideoCaptureReady;
    hasVideoCapture:typeof import('./video/capture.js').hasVideoCapture;
    beginVideoCapture:typeof import('./video/capture.js').beginVideoCapture;
    endVideoCapture:typeof import('./video/capture.js').endVideoCapture;
    videoSnapshot:typeof import('./video/surfaces.js').videoSnapshot;
    overlaySnapshot:typeof import('./plugins/overlays.js').overlaySnapshot;
    overlayFrame:()=>import('./services/frame-contracts.js').FrameReference|null;
    ares: AresBridge;
    /** Opt-in smoke harness diagnostics. */
    stats(): RendererStats;
    sendInput(mask: number, x?: number, y?: number, rx?: number, ry?: number): void;
  }
}
