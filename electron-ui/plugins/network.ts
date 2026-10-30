import WebSocket from 'ws';
import {NETWORK_LIMITS as L, type NetworkCall, type NetworkHead, type NetworkChunk, type NetworkReply, type SocketCall, type SocketEvent} from './network-contracts.js';
import {ServiceError} from '../services/contracts.js';
interface Transfer {
  owner: string;
  abort: AbortController;
  timer: ReturnType<typeof setTimeout>;
  guard: () => void;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  rest?: Uint8Array;
  bytes: number;
  limit: number;
  reading: boolean;
}
const fail = (code: string): never => {throw new ServiceError(code);};
const object = (v: any, keys: string[]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k=>keys.includes(k));
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(v);
const bounded = (v: unknown, max: number): v is number => Number.isSafeInteger(v) && (v as number)>0 && (v as number)<=max;
function destination(value: unknown, origins: readonly string[], websocket=false): URL {
  if(typeof value !== 'string' || value.length>8192 || /\s/.test(value))return fail('network_invalid_url');
  let url: URL;
  try{url = new URL(value);}catch{return fail('network_invalid_url');}
  if(!(websocket?['ws:','wss:']:['http:','https:']).includes(url.protocol) || websocket&&!!url.hash || url.username || url.password)return fail('network_invalid_url');
  if(!origins.includes(url.origin))return fail('network_origin_denied');
  return url;
}
function headers(value: unknown): Record<string,string> {
  const result: Record<string,string> = Object.create(null);
  if(value === undefined)return result;
  if(!value || typeof value!=='object' || Array.isArray(value))return fail('network_invalid_headers');
  let bytes=0;
  for(const [name,v] of Object.entries(value)){
    const key=name.toLowerCase();
    if(!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(key) || typeof v!=='string' || /[\r\n\0]/.test(v) || Object.hasOwn(result,key))return fail('network_invalid_headers');
    if(['host','cookie','cookie2','connection','upgrade','content-length','transfer-encoding','keep-alive','expect','trailer','te','accept-encoding'].includes(key) || key.startsWith('proxy-') || key.startsWith('sec-'))return fail('network_forbidden_header');
    bytes+=Buffer.byteLength(name)+Buffer.byteLength(v);
    if(bytes>L.headerBytes)return fail('network_headers_too_large');
    result[key]=v;
  }
  return result;
}
/** Main-process HTTP broker. No browser cookie jar, CORS exception or raw socket is exposed. */
export class PluginNetwork {
  private transfers = new Map<string,Transfer>();
  private sockets = new PluginSockets();
  constructor(private fetcher: typeof fetch = fetch) {}
  releaseOwner(owner: string) {
    this.sockets.releaseOwner(owner);
    for(const [id,t] of this.transfers)if(t.owner===owner)this.close(id,t,'network_cancelled');
  }
  private close(id: string, t: Transfer, reason?: string) {
    if(this.transfers.get(id)!==t)return;
    this.transfers.delete(id);clearTimeout(t.timer);
    if(reason)t.abort.abort(new ServiceError(reason));
    void t.reader?.cancel().catch(()=>{});
  }
  async call(owner: string, origins: readonly string[], p: NetworkCall, guard: ()=>void): Promise<NetworkReply> {
    guard();
    if(!p || !identifier(p.id) || typeof p.operation!=='string')return fail('network_invalid_request');
    if(p.operation.startsWith('socket'))return this.sockets.call(owner,origins,p as SocketCall,guard);
    if(p.operation==='start')return this.start(owner,origins,p,guard);
    if(!object(p,['operation','id']) || !['read','cancel'].includes(p.operation))return fail('network_invalid_request');
    const t=this.transfers.get(p.id);
    if(t && t.owner!==owner)return fail('network_owner_denied');
    if(p.operation==='cancel'){if(t)this.close(p.id,t,'network_cancelled');return {cancelled:!!t};}
    if(!t?.reader)return fail('network_stale_request');
    if(t.reading)return fail('network_read_busy');
    t.reading=true;
    try{
      t.guard();
      const part=t.rest ? {done:false,value:t.rest} : await t.reader.read();
      t.guard();
      if(t.abort.signal.aborted)throw t.abort.signal.reason;
      if(part.done){this.close(p.id,t);return {done:true,bytes:new Uint8Array()};}
      const value=part.value!;
      if(!t.rest){t.bytes+=value.byteLength;if(t.bytes>t.limit)return fail('network_response_too_large');}
      const bytes=value.slice(0,L.chunkBytes);
      t.rest=value.length>bytes.length ? value.subarray(bytes.length) : undefined;
      return {done:false,bytes};
    }catch(error){this.close(p.id,t,'network_cancelled');throw error;}
    finally{t.reading=false;}
  }
  private async start(owner: string, origins: readonly string[], p: Extract<NetworkCall,{operation:'start'}>, guard: ()=>void): Promise<NetworkHead> {
    if(!object(p,['operation','id','url','options']) || !object(p.options,['method','headers','body','timeoutMs','maxResponseBytes']))return fail('network_invalid_request');
    let url=destination(p.url,origins),method=p.options.method??'GET';
    if(typeof method!=='string' || !/^[A-Za-z]{1,32}$/.test(method) || ['CONNECT','TRACE','TRACK'].includes(method.toUpperCase()))return fail('network_invalid_method');
    method=method.toUpperCase();
    let requestHeaders=headers(p.options.headers),body=p.options.body;
    if(body!==undefined && typeof body!=='string' && !(body instanceof Uint8Array))return fail('network_invalid_body');
    if(body!==undefined && (['GET','HEAD'].includes(method) || Buffer.byteLength(body)>L.requestBytes))return fail('network_invalid_body');
    const timeout=p.options.timeoutMs??L.timeoutMs,limit=p.options.maxResponseBytes??L.responseBytes;
    if(!bounded(timeout,L.maxTimeoutMs) || !bounded(limit,L.responseBytes))return fail('network_invalid_limits');
    if(this.transfers.has(p.id))return fail('network_duplicate_request');
    if(this.transfers.size>=L.total || [...this.transfers.values()].filter(t=>t.owner===owner).length>=L.perOwner)return fail('network_overload');
    const abort=new AbortController();
    const t: Transfer={owner,abort,guard,bytes:0,limit,reading:false,timer:setTimeout(()=>this.close(p.id,t,'network_timeout'),timeout)};
    t.timer.unref();this.transfers.set(p.id,t);
    try{
      for(let redirects=0;;redirects++){
        guard();
        const response=await this.fetcher(url,{method,headers:requestHeaders,body:body as any,redirect:'manual',signal:abort.signal,credentials:'omit',referrerPolicy:'no-referrer'});
        guard();
        if(abort.signal.aborted){void response.body?.cancel().catch(()=>{});throw abort.signal.reason;}
        if([301,302,303,307,308].includes(response.status) && response.headers.has('location')){
          void response.body?.cancel().catch(()=>{});
          if(redirects>=L.redirects)return fail('network_too_many_redirects');
          const next=destination(new URL(response.headers.get('location')!,url).href,origins);
          if(next.origin!==url.origin)requestHeaders=Object.fromEntries(Object.entries(requestHeaders).filter(([k])=>['accept','content-type'].includes(k)));
          if(response.status===303 && method!=='HEAD' || [301,302].includes(response.status) && method==='POST'){
            method='GET';body=undefined;delete requestHeaders['content-type'];
          }
          url=next;continue;
        }
        const responseHeaders: Record<string,string>=Object.create(null);let size=0;
        for(const [k,v] of response.headers){if(k==='set-cookie')continue;size+=Buffer.byteLength(k)+Buffer.byteLength(v);if(size>L.headerBytes){void response.body?.cancel().catch(()=>{});return fail('network_headers_too_large');}responseHeaders[k]=v;}
        const hasBody=!!response.body && method!=='HEAD';
        if(hasBody)t.reader=response.body!.getReader();else this.close(p.id,t);
        return {url:url.href,status:response.status,statusText:response.statusText,headers:responseHeaders,redirected:redirects>0,body:hasBody};
      }
    }catch(error){const reason=abort.signal.aborted ? abort.signal.reason : error;this.close(p.id,t,'network_cancelled');throw reason;}
  }
}
interface SocketTransfer {
  owner:string;
  socket:WebSocket;
  guard:()=>void;
  queue:SocketEvent[];
  bytes:number;
  sending:boolean;
  ended:boolean;
  terminal?:SocketEvent;
  locallyClosed?:boolean;
  waiter?:{resolve:(event:SocketEvent)=>void;reject:(error:unknown)=>void;timer:ReturnType<typeof setTimeout>};
  expiry?:ReturnType<typeof setTimeout>;
}
/** Separate socket grants, no cookies/custom handshake headers, no redirects. */
class PluginSockets {
  private sockets=new Map<string,SocketTransfer>();
  releaseOwner(owner:string){for(const [id,t] of this.sockets)if(t.owner===owner)this.remove(id,t);}
  private remove(id:string,t:SocketTransfer){
    if(this.sockets.get(id)!==t)return;
    this.sockets.delete(id);clearTimeout(t.expiry);clearTimeout(t.waiter?.timer);
    t.waiter?.reject(new ServiceError('network_cancelled'));t.waiter=undefined;
    t.queue=[];t.bytes=0;t.socket.terminate();
  }
  private end(id:string,t:SocketTransfer,event:SocketEvent){
    if(t.ended||this.sockets.get(id)!==t)return;
    t.ended=true;t.terminal=event;
    if(t.waiter){const w=t.waiter;t.waiter=undefined;clearTimeout(w.timer);w.resolve(event);this.remove(id,t);}
    else if(t.locallyClosed)this.remove(id,t);
    else{t.expiry=setTimeout(()=>this.remove(id,t),30000);t.expiry.unref();}
  }
  async call(owner:string,origins:readonly string[],p:SocketCall,guard:()=>void):Promise<NetworkReply>{
    if(p.operation==='socketOpen'){
      if(!object(p,['operation','id','url','protocols']))return fail('network_invalid_request');
      const url=destination(p.url,origins,true),protocols=p.protocols??[];
      if(!Array.isArray(protocols)||protocols.length>16||new Set(protocols).size!==protocols.length||protocols.some(s=>typeof s!=='string'||!s.length||s.length>128||!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(s)))return fail('network_invalid_protocols');
      if(this.sockets.has(p.id))return fail('network_duplicate_request');
      if(this.sockets.size>=L.total||[...this.sockets.values()].filter(t=>t.owner===owner).length>=L.perOwner)return fail('network_overload');
      // ws 8.22 supports closeTimeout; its published DefinitelyTyped interface lags this option.
      const socketOptions:WebSocket.ClientOptions & import('node:http').ClientRequestArgs & {closeTimeout:number}={followRedirects:false,handshakeTimeout:10000,maxPayload:L.socketMessageBytes,perMessageDeflate:false,maxHeaderSize:L.headerBytes,closeTimeout:1000};
      const socket=new WebSocket(url,protocols,socketOptions);
      const t:SocketTransfer={owner,socket,guard,queue:[],bytes:0,sending:false,ended:false};this.sockets.set(p.id,t);
      const opened=new Promise<void>((resolve,reject)=>{
        socket.once('open',()=>resolve());
        socket.once('error',()=>reject(new ServiceError('network_socket_failed')));
        socket.once('close',()=>reject(new ServiceError('network_socket_closed')));
      });
      socket.on('message',(raw,binary)=>{
        if(t.ended||this.sockets.get(p.id)!==t)return;
        try{guard();}catch{this.remove(p.id,t);return;}
        const buffer=Array.isArray(raw)?Buffer.concat(raw):Buffer.from(raw as ArrayBuffer);
        const event:SocketEvent={type:'message',data:binary?new Uint8Array(buffer):buffer.toString('utf8')};
        if(t.waiter){const w=t.waiter;t.waiter=undefined;clearTimeout(w.timer);w.resolve(event);}
        else if(t.queue.length>=L.socketQueueMessages||t.bytes+buffer.length>L.socketQueueBytes){
          t.queue=[];t.bytes=0;this.end(p.id,t,{type:'error',error:'network_socket_overflow'});socket.terminate();
        }else{t.queue.push(event);t.bytes+=buffer.length;}
      });
      socket.on('close',(code,reason)=>this.end(p.id,t,{type:'close',code,reason:reason.toString('utf8')}));
      socket.on('error',()=>this.end(p.id,t,{type:'error',error:'network_socket_failed'}));
      try{await opened;guard();if(this.sockets.get(p.id)!==t)return fail('network_cancelled');return {url:url.href,protocol:socket.protocol};}
      catch(error){this.remove(p.id,t);throw error;}
    }
    const t=this.sockets.get(p.id);
    if(t&&t.owner!==owner)return fail('network_owner_denied');
    if(p.operation==='socketClose'){
      if(!object(p,['operation','id','code','reason']) || p.code!==undefined&&(!Number.isInteger(p.code)||p.code!==1000&&(p.code<3000||p.code>4999)) || p.reason!==undefined&&(typeof p.reason!=='string'||Buffer.byteLength(p.reason)>123))return fail('network_invalid_close');
      if(t){t.locallyClosed=true;if(t.ended)this.remove(p.id,t);else if(t.socket.readyState===WebSocket.OPEN)t.socket.close(p.code??1000,p.reason);else t.socket.terminate();}
      return {cancelled:!!t};
    }
    if(!t)return fail('network_stale_request');
    guard();
    if(p.operation==='socketRead'){
      if(!object(p,['operation','id']))return fail('network_invalid_request');
      if(t.waiter)return fail('network_read_busy');
      if(t.queue.length){const event=t.queue.shift()!;if(event.type==='message')t.bytes-=Buffer.byteLength(event.data);return event;}
      if(t.terminal){const event=t.terminal;this.remove(p.id,t);return event;}
      return new Promise<SocketEvent>((resolve,reject)=>{
        const timer=setTimeout(()=>{t.waiter=undefined;resolve({type:'idle'});},30000);timer.unref();t.waiter={resolve,reject,timer};
      });
    }
    if(p.operation==='socketSend'){
      if(!object(p,['operation','id','data']) || typeof p.data!=='string'&&!(p.data instanceof Uint8Array) || Buffer.byteLength(p.data)>L.socketMessageBytes)return fail('network_invalid_body');
      if(t.sending||t.socket.bufferedAmount>L.socketMessageBytes)return fail('network_overload');
      if(t.ended||t.socket.readyState!==WebSocket.OPEN)return fail('network_socket_closed');
      t.sending=true;
      try{await new Promise<void>((resolve,reject)=>t.socket.send(p.data,{binary:typeof p.data!=='string'},e=>e?reject(new ServiceError('network_socket_failed')):resolve()));guard();return {sent:true};}
      finally{t.sending=false;}
    }
    return fail('network_invalid_request');
  }
}
