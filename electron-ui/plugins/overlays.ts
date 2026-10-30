import {canvasTransform,type VideoGeometry} from '../services/video-geometry.js';
import type { Disposer, OverlayContext, OverlaySize, OverlayOptions } from './sdk.js';
import type { FrameReference } from '../services/frame-contracts.js';
import type { FrameSample } from '../services/observer-contracts.js';
interface Layer {key:string;element:HTMLDivElement;visible:boolean;sample?:FrameSample;paint?:()=>void;resize:Set<(size:OverlaySize)=>void>;abort:AbortController;error:(error:unknown)=>void}
const layers=new Map<string,Layer>();
let viewport:HTMLElement|undefined,screen:HTMLCanvasElement|undefined;
let logicalWidth=0,logicalHeight=0,sourceWidth=0,sourceHeight=0,frame:FrameReference|null=null;
let videoGeometry:VideoGeometry|null=null;
let size:OverlaySize={geometry:null,canvasToCss:null,canvasToPixels:null,width:0,height:0,pixelWidth:0,pixelHeight:0,dpr:1,logicalWidth:0,logicalHeight:0,sourceWidth:0,sourceHeight:0};
export function framesMatch(a:FrameReference,b:FrameReference){
  if(a.native_session!==b.native_session||a.epoch!==b.epoch)return false;
  if(a.vi!==null||b.vi!==null)return a.vi!==null&&a.vi===b.vi&&a.origin_commit===b.origin_commit;
  return a.frame!==undefined&&a.frame===b.frame&&a.frame_kind==='primary-screen-frame'&&b.frame_kind===a.frame_kind;
}
function display(layer:Layer){
  const matched=!!layer.sample&&!!frame&&framesMatch(layer.sample.frame,frame);
  layer.element.dataset.stale=String(!!layer.sample&&!matched);
  layer.element.hidden=!layer.visible||!size.width||!size.height||!!layer.sample&&!matched;
  if(matched&&layer.paint){const paint=layer.paint;layer.paint=undefined;try{paint();}catch(error){layer.error(error);}}
}
export function configureOverlays(target:HTMLElement,canvas:HTMLCanvasElement){viewport=target;screen=canvas;}
export function layoutOverlays(width=logicalWidth,height=logicalHeight,sourceW=sourceWidth,sourceH=sourceHeight,geometry:VideoGeometry|null=videoGeometry){
  videoGeometry=geometry?Object.freeze({...geometry}):null;
  logicalWidth=width;logicalHeight=height;sourceWidth=sourceW;sourceHeight=sourceH;if(!viewport||!screen)return;
  const outer=viewport.getBoundingClientRect(),rect=screen.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
  const next:OverlaySize={geometry:null,canvasToCss:null,canvasToPixels:null,width:rect.width,height:rect.height,pixelWidth:Math.max(1,Math.round(rect.width*dpr)),pixelHeight:Math.max(1,Math.round(rect.height*dpr)),dpr,logicalWidth,logicalHeight,sourceWidth,sourceHeight};
  next.geometry=videoGeometry;next.canvasToCss=videoGeometry?canvasTransform(videoGeometry,sourceWidth,sourceHeight,next.width,next.height):null;next.canvasToPixels=videoGeometry?canvasTransform(videoGeometry,sourceWidth,sourceHeight,next.pixelWidth,next.pixelHeight):null;
  const changed=JSON.stringify(size)!==JSON.stringify(next);size=Object.freeze(next);
  const safeTop = parseFloat(getComputedStyle(document.body).getPropertyValue('--titlebar-safe-top')) || 0;
  for(const layer of layers.values()){
    layer.element.style.clipPath = `inset(${Math.max(0, safeTop - rect.top)}px 0 0)`;
    layer.element.style.left=(rect.left-outer.left)+'px';layer.element.style.top=(rect.top-outer.top)+'px';layer.element.style.width=rect.width+'px';layer.element.style.height=rect.height+'px';
    if(changed)for(const callback of layer.resize)try{callback(size);}catch(error){layer.error(error);}
    display(layer);
  }
}
export function submitOverlayFrame(value:FrameReference|null){frame=value;for(const layer of layers.values())display(layer);}
export function overlayFrame(){return frame;}
export function overlaySnapshot(){const r=screen?.getBoundingClientRect();return {frame,size,rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null};}
export function registerOverlay(key:string,mount:(context:OverlayContext)=>void|Disposer,options:OverlayOptions,error:(error:unknown)=>void):Disposer {
  if(!viewport)throw new Error('viewport_unavailable');
  if(layers.has(key))throw new Error('duplicate_overlay');
  if(layers.size>=16)throw new Error('overlay_limit');
  if(!Number.isInteger(options.order??0)||Math.abs(options.order??0)>100||options.interactive!==undefined&&typeof options.interactive!=='boolean')throw new Error('invalid_overlay_options');
  const element=document.createElement('div');element.className='ares-screen-overlay';element.dataset.overlay=key;element.dataset.interactive=String(options.interactive===true);element.style.zIndex=String(200+(options.order??0));
  const layer:Layer={key,element,visible:true,resize:new Set(),abort:new AbortController(),error};layers.set(key,layer);viewport.append(element);layoutOverlays();
  let cleanup:void|Disposer;
  const dispose=()=>{layer.abort.abort();layers.delete(key);element.remove();layer.resize.clear();return cleanup?.();};
  try{cleanup=mount({element,signal:layer.abort.signal,get size(){return size;},get frame(){return frame;},onResize(callback){layer.resize.add(callback);callback(size);return ()=>{layer.resize.delete(callback);};},setVisible(visible){layer.visible=visible;display(layer);},present(sample,paint){if(layer.abort.signal.aborted)return;layer.sample=sample;layer.paint=paint;display(layer);}});}
  catch(error){void dispose();throw error;}
  return dispose;
}
