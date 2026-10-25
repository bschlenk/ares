import {validVideoGeometry} from './services/video-geometry.js';
import type { VideoFrame } from './bridge.js';
export interface NativeFrame extends VideoFrame { pixels: Buffer<ArrayBuffer> }
export const HEADER = 48;
const MAX_BYTES = 1920 * 1080 * 4;
// Incremental parser: each payload is allocated once, even with fragmented pipes.
export class FrameParser {
  private header = Buffer.alloc(128);
  private headerLength=HEADER;
  private used = 0;
  private frame: NativeFrame | null = null;
  private onFrame: (frame: NativeFrame) => void;
  constructor(onFrame: (frame: NativeFrame) => void) {
    this.onFrame = onFrame;
  }
  push(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length) {
      const target = this.frame?.pixels ?? this.header.subarray(0,this.headerLength);
      const count = Math.min(target.length - this.used, chunk.length - offset);
      chunk.copy(target, this.used, offset, offset + count);
      this.used += count; offset += count;
      if (this.used !== target.length) continue;
      if(!this.frame&&this.headerLength===48){const version=this.header.toString('ascii',0,4);if(version==='AEF3'||version==='AEF4'){this.headerLength=version==='AEF4'?128:96;continue;}}
      this.used = 0;
      if (this.frame) {
        const complete = this.frame; this.frame = null;
        this.onFrame(complete);
      } else {
        const h = this.header;
        const size = h.readUInt32LE(4), width = h.readUInt32LE(8), height = h.readUInt32LE(12);
        const geometryHeader=this.headerLength===128,extended=this.headerLength>=96;this.headerLength=48;
        if (!['AEF2','AEF3','AEF4'].includes(h.toString('ascii',0,4)) || !width || !height ||
            size > MAX_BYTES || size !== width * height * 4 ||
            !Number.isFinite(h.readDoubleLE(40)) || h.readDoubleLE(40) <= 0) throw new Error('Invalid AEF2 frame');
        if(extended&&(![48,56,64].every(offset=>Number.isSafeInteger(h.readDoubleLE(offset))&&h.readDoubleLE(offset)>=0)||!h.readUInt32LE(80)||!h.readUInt32LE(84)))throw new Error('Invalid AEF3 frame identity');
        const flags=extended?h.readUInt32LE(76):0;
        const reference=extended&&(flags&1)?{
          native_session:'',epoch:h.readDoubleLE(48),vi:flags&8?null:h.readDoubleLE(56),
          boundary:flags&4?'synthetic-vi':flags&8?'primary-screen-frame':'vi',
          origin:flags&2?h.readUInt32LE(72):null,origin_commit:flags&2?h.readDoubleLE(64):null,
          video_sequence:h.readUInt32LE(16),presentation:null,provenance:'unmatched' as const,
        }:undefined;
        if(reference&&reference.epoch<1)throw new Error('Invalid AEF3 epoch');
        let geometry=null;
        if(geometryHeader){
          if(h.readUInt32LE(116)>1)throw new Error('Invalid AEF4 geometry flags');
          if(h.readUInt32LE(116)){
            const g={canvasWidth:h.readUInt32LE(96),canvasHeight:h.readUInt32LE(100),cropX:h.readUInt32LE(104),cropY:h.readUInt32LE(108),rotation:h.readUInt32LE(112)};
            if(!validVideoGeometry(g as any,width,height))throw new Error('Invalid AEF4 geometry');
            geometry=g as import('./services/video-geometry.js').VideoGeometry;
          }
        }
        this.frame={
          width,height,sequence:h.readUInt32LE(16),inputSequence:h.readUInt32LE(20),
          nativeMs:h.readDoubleLE(24),queueMs:h.readDoubleLE(32),aspect:h.readDoubleLE(40),
          pixels:Buffer.allocUnsafe(size),
          ...(geometryHeader?{geometry}:{}),
          ...(extended?{logicalWidth:h.readUInt32LE(80),logicalHeight:h.readUInt32LE(84)}:{}),
          ...(reference?{frameReference:reference}:{}),
        };
      }
    }
  }
}

