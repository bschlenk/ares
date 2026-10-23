import { performance } from 'node:perf_hooks';
import type { NativeSessionClient } from './native-client.js';
import { ServiceError, type SessionIdentity } from './contracts.js';
import { publishArtifact } from './artifact-writer.js';
import type { MemoryExportParams, MemoryExportResult } from './artifact-contracts.js';
import type { CaptureCursor, CapturePage } from './memory-tools-contracts.js';

/** Export stopped captures without materializing their entire contents in main. */
export class MemoryArtifacts {
  private jobs = new Map<string, AbortController>();
  release(owner: string) { this.jobs.get(owner)?.abort(); }
  close() { for (const job of this.jobs.values()) job.abort(); }
  async export(client: NativeSessionClient, identity: SessionIdentity, p: MemoryExportParams, owner: string, current: () => boolean): Promise<MemoryExportResult> {
    if (this.jobs.has(owner) || this.jobs.size >= 2) throw new ServiceError('busy');
    const job = new AbortController(); this.jobs.set(owner, job);
    const deadline = performance.now() + 25000;
    const guard = () => {
      if (job.signal.aborted || !current()) throw new ServiceError('artifact_cancelled');
      if (client.identity.epoch !== identity.epoch || client.identity.session !== identity.session) throw new ServiceError('stale_epoch');
      if (performance.now() >= deadline) throw new ServiceError('artifact_timeout');
    };
    try {
      guard();
      const reply = await client.request('memory.capture.status', identity, { handle: p.handle }, owner);
      if (!reply.ok || !reply.result) throw new ServiceError(reply.error ?? 'invalid_reply');
      const metadata = reply.result;
      if (metadata.active) throw new ServiceError('capture_active');
      const published = await publishArtifact(p.path, p.overwrite, async write => {
        await write(JSON.stringify({ version: 1, format: 'ares-memory-capture-v1', ...identity, metadata }).slice(0, -1) + ',"chunks":[');
        let cursor: CaptureCursor | null = { sequence: metadata.first_sequence, range: 0, offset: 0 }, emitted = false;
        while (cursor) {
          guard();
          const page: import('./contracts.js').SessionReply<CapturePage> = await client.request('memory.capture.page', identity, { handle: p.handle, ...cursor }, owner);
          if (!page.ok || !page.result) throw new ServiceError(page.error ?? 'invalid_reply');
          for (const chunk of page.result.chunks) {
            await write((emitted ? ',' : '') + JSON.stringify(chunk)); emitted = true;
          }
          cursor = page.result.next;
        }
        await write(']}\n');
        // Revalidate native epoch and handle after the last asynchronous write.
        const final = await client.request('memory.capture.status', identity, { handle: p.handle }, owner);
        if (!final.ok || final.result?.next_sequence !== metadata.next_sequence) throw new ServiceError(final.error ?? 'stale_memory_handle');
      }, guard);
      return { ...published, ...identity, samples: metadata.next_sequence - metadata.first_sequence, format: 'ares-memory-capture-v1' };
    } finally { if (this.jobs.get(owner) === job) this.jobs.delete(owner); }
  }
}
