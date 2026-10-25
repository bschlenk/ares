import type { AresBridge, RendererStats } from './bridge.js';
declare global {
  interface Window {
    overlaySnapshot:typeof import('./plugins/overlays.js').overlaySnapshot;
    overlayFrame:()=>import('./services/frame-contracts.js').FrameReference|null;
    ares: AresBridge;
    /** Opt-in smoke harness diagnostics. */
    stats(): RendererStats;
    sendInput(mask: number, x?: number, y?: number, rx?: number, ry?: number): void;
  }
}
