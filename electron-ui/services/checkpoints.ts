import {Worker} from 'node:worker_threads';
import {CheckpointLibrary, type CheckpointGame} from './checkpoint-library.js';
import type {SessionClient, SessionIdentity, SessionReply, ServiceMethod, ServiceParams, ServiceResult} from './contracts.js';

export class Checkpoints {
  constructor(private client: SessionClient, readonly game: CheckpointGame, private identity: () => SessionIdentity | undefined, private current: () => boolean, private compatibility: () => Record<string, unknown>) {}
  private guard(identity: SessionIdentity) {
    const current = this.identity();
    if (!this.current() || current?.session !== identity.session || current.epoch !== identity.epoch) throw new Error('checkpoint_session_changed');
  }
  private async request<M extends ServiceMethod>(method: M, identity: SessionIdentity, params?: ServiceParams<M>): Promise<ServiceResult<M>> {
    const reply: SessionReply<ServiceResult<M>> = await this.client.request(method, identity, params, 'ui');
    if (!reply.ok || !reply.result) throw new Error(reply.error || 'invalid_reply');
    return reply.result;
  }
  async save(library: CheckpointLibrary, permanent: boolean) {
    const identity = {...this.identity()!}; this.guard(identity);
    const compatibility = this.compatibility();
    const snapshot = await this.request('checkpoint.capture', identity);
    try {
      const bytes = Buffer.alloc(snapshot.bytes);
      for (let offset = 0; offset < bytes.length;) {
        this.guard(identity);
        const length = Math.min(16384, bytes.length-offset);
        const page = await this.request('checkpoint.read', identity, {id:snapshot.id, offset, length});
        const data = Buffer.from(page.hex, 'hex'); if (data.length !== length) throw new Error('invalid_reply');
        data.copy(bytes,offset); offset += length;
      }
      this.guard(identity);
      const screenshot = await new Promise<Buffer>((resolve,reject) => {
        const worker = new Worker(new URL('./png-worker.js',import.meta.url), {workerData:{pixels:bytes.subarray(snapshot.stateBytes),sourceWidth:snapshot.width,sourceHeight:snapshot.height,region:null,scale:1}});
        worker.once('message', value => { void worker.terminate(); value.error ? reject(new Error(value.error)) : resolve(Buffer.from(value.png)); });
        worker.once('error',reject); worker.once('exit',()=>reject(new Error('encoding_failed')));
      });
      return await library.publish(this.game,{state:bytes.subarray(0,snapshot.stateBytes),screenshot,capturedAt:new Date(snapshot.capturedAt),screenshotGeometry:{width:snapshot.width,height:snapshot.height,aspect:snapshot.aspect??snapshot.width/snapshot.height},compatibility},permanent,()=>this.guard(identity));
    } finally { await this.request('checkpoint.release',identity,{id:snapshot.id}).catch(()=>{}); }
  }
  async load(library: CheckpointLibrary, id: string) {
    const identity = {...this.identity()!}; this.guard(identity);
    const {state, metadata} = await library.read(this.game,id);
    if (JSON.stringify(metadata.compatibility) !== JSON.stringify(this.compatibility())) throw new Error('checkpoint_configuration_mismatch');
    this.guard(identity);
    const upload = await this.request('checkpoint.upload',identity,{bytes:state.length});
    try {
      for(let offset=0;offset<state.length;offset+=1800) {
        this.guard(identity);
        await this.request('checkpoint.write',identity,{id:upload.id,offset,hex:state.subarray(offset,offset+1800).toString('hex')});
      }
      this.guard(identity); await this.request('checkpoint.commit',identity,{id:upload.id,resume:true});
    } finally { await this.request('checkpoint.abort',this.identity() ?? identity,{id:upload.id}).catch(()=>{}); }
  }
}
