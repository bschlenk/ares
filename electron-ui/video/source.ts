import type { FramePacket } from '../bridge.js';
import type { SessionIdentity } from '../services/contracts.js';

/** One retained binary packet for all views; no subscriber owns native credit. */
export class VideoSource {
  latest: FramePacket | null = null;
  reason: string | null = 'waiting_for_frame';
  revision = 0;
  private paused = false;
  private receivedAt = 0;
  private identity: SessionIdentity | undefined;
  private listeners = new Set<() => void>();
  subscribe(callback: () => void) { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; }
  private notify() { ++this.revision; for (const listener of this.listeners) listener(); }
  reset(reason = 'session_changed', identity?: SessionIdentity) {
    this.latest = null; this.reason = reason; this.identity = identity ?? this.identity; this.notify();
  }
  session(identity: SessionIdentity) {
    if (this.identity?.session === identity.session && this.identity.epoch === identity.epoch) return;
    this.reset('session_changed', identity);
  }
  setPaused(paused: boolean) {
    if (this.paused && !paused) this.receivedAt = performance.now();
    this.paused = paused;
  }
  checkStale(now = performance.now()) {
    if (this.latest && !this.paused && now - this.receivedAt > 2000) this.reset('frame_stalled', this.identity);
  }
  submit(packet: FramePacket) {
    const f = packet.frameReference;
    // No invented provenance for old protocols or packets queued before reset.
    if (!f) { this.reset('frame_identity_unavailable', this.identity); return; }
    if (this.identity && (f.native_session !== this.identity.session || f.epoch !== this.identity.epoch)) return;
    this.identity = {session: f.native_session, epoch: f.epoch};
    this.latest = packet; this.receivedAt = performance.now(); this.reason = null; this.notify();
  }
}
export const videoSource = new VideoSource();
