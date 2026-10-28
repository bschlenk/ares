import type {SessionReply} from './contracts.js';

interface Client {
  request(method: 'session.status' | 'session.pause' | 'session.resume'): Promise<SessionReply>;
}
/** Focus owns only the pause it introduced. Explicit automation takes precedence. */
export class FocusPause {
  private client?: Client;
  private enabled = false;
  private focused = true;
  private owned = false;
  private automation = false;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private changed: (reply: SessionReply) => void) {}
  attach(client?: Client): void { this.client = client; this.owned = false; this.automation = false; }
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.tail.then(run);
    this.tail = result.catch(() => {});
    return result;
  }
  configure(enabled: boolean, focused: boolean): Promise<void> {
    this.enabled = enabled; this.focused = focused;
    const client = this.client;
    return this.enqueue(async () => { if (client === this.client) await this.reconcile(); });
  }
  decorate(reply: SessionReply): SessionReply {
    if (!reply.ok || !reply.result) return reply;
    return {...reply, result: {...reply.result, paused: this.owned || reply.result.paused, focus_paused: this.owned, manual_paused: this.owned ? false : reply.result.paused}};
  }
  async explicit<T>(owner: string, run: () => Promise<T>, success: (reply: T) => boolean): Promise<T> {
    const client = this.client;
    return this.enqueue(async () => {
      if (client !== this.client) throw new Error('session_changed');
      const reply = await run();
      if (client === this.client && success(reply)) {
        this.owned = false;
        this.automation = owner !== 'ui';
        await this.reconcile();
      }
      return reply;
    });
  }
  /** Bounded execution owns its stop/run state, even when the window is hidden. */
  takeControl(): Promise<void> {
    const client = this.client;
    return this.enqueue(async () => {
      if (client !== this.client) return;
      this.owned = false; this.automation = true;
    });
  }
  private async reconcile(): Promise<void> {
    const client = this.client;
    if (!client) return;
    const shouldPause = this.enabled && !this.focused && !this.automation;
    if (shouldPause === this.owned) return;
    const status = await client.request('session.status');
    if (client !== this.client || !status.ok || !status.result) return;
    // Never cancel a bounded run or resume a manually paused/new session.
    if (shouldPause && (status.result.paused || status.result.operation_id != null || status.result.synthetic)) return;
    if (!shouldPause && (!status.result.paused || status.result.operation_id != null)) { this.owned = false; return; }
    const reply = await client.request(shouldPause ? 'session.pause' : 'session.resume');
    if (client !== this.client || !reply.ok) return;
    this.owned = shouldPause;
    this.changed(this.decorate(reply));
  }
}
