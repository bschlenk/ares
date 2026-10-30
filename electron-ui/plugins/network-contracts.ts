/** Browser-safe wire contracts. Origins are exact scheme/host/port grants. */
export const NETWORK_LIMITS = {
  origins: 32, perOwner: 4, total: 32, requestBytes: 1024 * 1024,
  responseBytes: 16 * 1024 * 1024, chunkBytes: 64 * 1024, headerBytes: 16384,
  socketMessageBytes: 256 * 1024, socketQueueBytes: 1024 * 1024, socketQueueMessages: 64,
  timeoutMs: 60000, maxTimeoutMs: 600000, redirects: 5,
} as const;
export function networkOrigin(value: unknown): string {
  if(typeof value !== 'string' || value.length > 2048 || /[\s*]/.test(value))throw new Error('network_invalid_origin');
  const url = new URL(value);
  if(!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)throw new Error('network_invalid_origin');
  return url.origin;
}
export interface NetworkOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** Total deadline, including response consumption; 1–600,000 ms. */
  timeoutMs?: number;
  /** Decoded response bytes, at most 16 MiB. */
  maxResponseBytes?: number;
}
export interface PluginFetchOptions extends NetworkOptions { signal?: AbortSignal }
export type NetworkCall =
  | {operation: 'start'; id: string; url: string; options: NetworkOptions}
  | {operation: 'read' | 'cancel'; id: string}
  | SocketCall;
export interface NetworkHead {url: string; status: number; statusText: string; headers: Record<string,string>; redirected: boolean; body: boolean}
export interface NetworkChunk {done: boolean; bytes: Uint8Array}
export type SocketCall =
  | {operation:'socketOpen';id:string;url:string;protocols?:string[]}
  | {operation:'socketRead';id:string}
  | {operation:'socketSend';id:string;data:string|Uint8Array}
  | {operation:'socketClose';id:string;code?:number;reason?:string};
export interface SocketHead {url:string;protocol:string}
export type SocketEvent = {type:'message';data:string|Uint8Array} | {type:'close';code:number;reason:string} | {type:'error';error:string} | {type:'idle'};
export interface PluginSocket {
  readonly url:string;
  readonly protocol:string;
  readonly messages:ReadableStream<string|Uint8Array>;
  readonly closed:Promise<{code:number;reason:string}>;
  send(data:string|Uint8Array):Promise<void>;
  close(code?:number,reason?:string):Promise<void>;
}
export type NetworkReply = NetworkHead | NetworkChunk | SocketHead | SocketEvent | {cancelled: boolean} | {sent:true};
