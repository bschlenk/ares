import {unwrapPluginBridge} from './admission.js';
import {NETWORK_LIMITS, type NetworkCall, type NetworkReply, type NetworkHead, type NetworkChunk, type PluginFetchOptions, type SocketHead, type SocketEvent, type PluginSocket} from './network-contracts.js';
import type {PluginBridgeFailure} from './admission.js';
type Dispose=()=>void|Promise<void>;
type Bridge=(p:NetworkCall)=>Promise<NetworkReply|PluginBridgeFailure>;
const aborted=(signal:AbortSignal)=>{if(signal.aborted)throw signal.reason??new DOMException('Aborted','AbortError');};
export function createPluginNetworking(bridge:Bridge,scope:AbortSignal,add:(dispose:Dispose)=>Dispose,writable:()=>void){
  return {
    async fetch(url:string,options:PluginFetchOptions={}):Promise<Response>{
      writable();
      const id=crypto.randomUUID(),local=new AbortController(),signal=AbortSignal.any([scope,local.signal,...(options.signal?[options.signal]:[])]);
      aborted(signal);
      let controller:ReadableStreamDefaultController<Uint8Array>|undefined,finished=false,release:Dispose|undefined;
      const timeout=options.timeoutMs??NETWORK_LIMITS.timeoutMs;
      if(!Number.isSafeInteger(timeout)||timeout<1||timeout>NETWORK_LIMITS.maxTimeoutMs)throw new Error('network_invalid_limits');
      const timer=setTimeout(()=>local.abort(new DOMException('network_timeout','TimeoutError')),timeout);
      const cleanup=()=>{if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);void release?.();};
      const stop=()=>bridge({operation:'cancel',id}).then(()=>{},()=>{});
      const cancel=()=>{if(finished)return;controller?.error(signal.reason);void stop();cleanup();};
      signal.addEventListener('abort',cancel,{once:true});release=add(()=>{if(!finished)local.abort(new DOMException('Plugin effect disposed','AbortError'));});
      try{
        const {signal:_,...wireOptions}=options;
        const head=unwrapPluginBridge(await bridge({operation:'start',id,url,options:wireOptions})) as NetworkHead;
        aborted(signal);
        const body=head.body ? new ReadableStream<Uint8Array>({
          start(c){controller=c;},
          async pull(c){
            try{
              aborted(signal);const part=unwrapPluginBridge(await bridge({operation:'read',id})) as NetworkChunk;if(finished)return;aborted(signal);
              if(part.done){c.close();cleanup();}else c.enqueue(part.bytes);
            }catch(error){if(!finished)c.error(error);void stop();cleanup();}
          },
          async cancel(){cleanup();await stop();},
        }) : null;
        if(!body)cleanup();
        const response=new Response(body,{status:head.status,statusText:head.statusText,headers:head.headers});
        Object.defineProperties(response,{url:{value:head.url},redirected:{value:head.redirected}});
        return response;
      }catch(error){void stop();cleanup();throw signal.aborted?signal.reason:error;}
    },
    async connect(url:string,options:{protocols?:string[];signal?:AbortSignal}={}):Promise<PluginSocket>{
      writable();
      const id=crypto.randomUUID(),local=new AbortController(),signal=AbortSignal.any([scope,local.signal,...(options.signal?[options.signal]:[])]);
      aborted(signal);
      let controller:ReadableStreamDefaultController<string|Uint8Array>|undefined,finished=false,release:Dispose|undefined;
      let resolveClosed!:(value:{code:number;reason:string})=>void;
      const closed=new Promise<{code:number;reason:string}>(resolve=>resolveClosed=resolve);
      const cleanup=(code:number,reason:string)=>{if(finished)return;finished=true;signal.removeEventListener('abort',cancel);resolveClosed({code,reason});void release?.();};
      const stop=(code?:number,reason?:string)=>bridge({operation:'socketClose',id,...(code!==undefined?{code}:{}),...(reason!==undefined?{reason}:{})}).then(unwrapPluginBridge);
      const cancel=()=>{if(finished)return;controller?.error(signal.reason);void stop().catch(()=>{});cleanup(1006,'network_cancelled');};
      signal.addEventListener('abort',cancel,{once:true});release=add(()=>{if(!finished)local.abort(new DOMException('Plugin effect disposed','AbortError'));});
      try{
        const head=unwrapPluginBridge(await bridge({operation:'socketOpen',id,url,...(options.protocols?{protocols:options.protocols}:{})})) as SocketHead;
        aborted(signal);
        const messages=new ReadableStream<string|Uint8Array>({
          start(c){controller=c;},
          async pull(c){
            try{
              for(;;){
                aborted(signal);const event=unwrapPluginBridge(await bridge({operation:'socketRead',id})) as SocketEvent;if(finished)return;aborted(signal);
                if(event.type==='message'){c.enqueue(event.data);return;}
                if(event.type==='idle')continue;
                if(event.type==='error')throw new Error(event.error);
                c.close();cleanup(event.code,event.reason);return;
              }
            }catch(error){if(!finished)c.error(error);void stop().catch(()=>{});cleanup(1006,String(error));}
          },
          async cancel(){cleanup(1000,'');await stop();},
        });
        return {url:head.url,protocol:head.protocol,messages,closed,
          async send(data){writable();aborted(signal);if(finished)throw new Error('network_socket_closed');unwrapPluginBridge(await bridge({operation:'socketSend',id,data}));aborted(signal);},
          async close(code=1000,reason=''){if(finished)return;await stop(code,reason);if(!finished)controller?.close();cleanup(code,reason);},
        };
      }catch(error){void stop().catch(()=>{});cleanup(1006,String(error));throw signal.aborted?signal.reason:error;}
    },
  };
}
