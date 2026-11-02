import {captureHeld, onCaptureReleased} from './capture.js';
import {framesMatch} from '../plugins/overlays.js';
import {canvasTransform} from '../services/video-geometry.js';
import type {OverlaySize} from '../plugins/sdk.js';
import type {FrameSample} from '../services/observer-contracts.js';
import { VideoCanvas } from './canvas.js';
import { videoSize } from './layout.js';
import { videoSource } from './source.js';
import type { VideoOptions, VideoSurface, VideoSurfaceStatus } from './contracts.js';
import type { SessionIdentity } from '../services/contracts.js';

const surfaces = new Map<string, {owner: string; snapshot(): unknown}>();
let serial = 0;
const MAX_VIEWS = 8, MAX_OWNER_VIEWS = 4, MAX_BACKING_PIXELS = 4194304;
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) frozen(child); }
  return value;
}
/** Capture diagnostics contain metadata only, never pixel payloads. */
export function videoSnapshot() { return [...surfaces.values()].map(surface => surface.snapshot()); }

export function mountVideo(element: HTMLElement, options: VideoOptions, owner: string, instanceId: string,
  identity: SessionIdentity, panelVisible: () => boolean, onError: (error: unknown) => void): VideoSurface & {refresh(): void} {
  if (surfaces.size >= MAX_VIEWS || [...surfaces.values()].filter(s => s.owner === owner).length >= MAX_OWNER_VIEWS)
    throw new Error('video_surface_limit');
  if (!options || Object.keys(options).some(k => !['fit', 'filtering', 'integerScale'].includes(k)) ||
    options.fit !== undefined && !['contain', 'cover'].includes(options.fit) ||
    options.filtering !== undefined && !['nearest', 'linear'].includes(options.filtering) ||
    options.integerScale !== undefined && typeof options.integerScale !== 'boolean') throw new Error('invalid_video_options');
  options = {...options};
  const id = `${owner}:${instanceId}:video-${++serial}`;
  const root = document.createElement('div'), canvas = document.createElement('canvas'), overlayElement = document.createElement('div'), message = document.createElement('span');
  root.dataset.videoSurface = id;
  Object.assign(root.style, {position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#000', isolation: 'isolate'});
  Object.assign(canvas.style, {position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none'});
  Object.assign(overlayElement.style, {position:'absolute',left:'50%',top:'50%',transform:'translate(-50%, -50%)',pointerEvents:'none'});
  Object.assign(message.style, {position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', color: '#ccc', font: '14px sans-serif', pointerEvents: 'none'});
  canvas.setAttribute('aria-label', 'Native game video'); message.setAttribute('role', 'status');
  root.append(canvas, overlayElement, message); element.append(root);
  let renderer: VideoCanvas | undefined, visible = true, intersecting = true, disposed = false, lost = false, raf = 0;
  const overlayAbort = new AbortController(), resizeListeners = new Set<(size: OverlaySize) => void>();
  let overlayVisible = true, sample: FrameSample | undefined, paint: (() => void) | undefined;
  let overlaySize: OverlaySize = Object.freeze({width:0,height:0,pixelWidth:0,pixelHeight:0,dpr:1,logicalWidth:0,logicalHeight:0,sourceWidth:0,sourceHeight:0,geometry:null,canvasToCss:null,canvasToPixels:null});
  const showOverlay = () => {
    const matched = !!sample && !!status.frame && framesMatch(sample.frame, status.frame);
    overlayElement.hidden = !overlayVisible || status.state !== 'live' || !!sample && !matched;
    overlayElement.dataset.stale = String(!!sample && !matched);
    if (matched && paint) { const callback=paint;paint=undefined;try{callback();}catch(error){onError(error);} }
  };
  let lastRevision = -1, lastSequence = 0, lastEpoch = '', dirty = true;
  let status: Readonly<VideoSurfaceStatus> = frozen({id, state: 'waiting', reason: 'waiting_for_frame', source: 'native-presented',
    sourceWidth: 0, sourceHeight: 0, aspect: 0, geometry: null, frame: null, submitted: 0, skipped: 0});
  const update = (change: Partial<VideoSurfaceStatus>) => {
    status = frozen({...status, ...change}); root.dataset.videoState = status.state;
    const show = status.state !== 'live'; canvas.hidden = show; message.hidden = !show;
    // Inline display overrides the HTML hidden rule in some themes.
    message.style.display = show ? 'grid' : 'none';
    showOverlay();
    message.textContent = status.state === 'suspended' ? 'Video suspended' : status.state === 'waiting' ? 'Waiting for game video' : 'Game video unavailable';
  };
  const clear = (state: VideoSurfaceStatus['state'], reason: string | null) => {
    lastRevision = -1; renderer?.clear(); update({state, reason, frame: null, geometry: null, sourceWidth: 0, sourceHeight: 0, aspect: 0});
  };
  const schedule = () => { if (!disposed && !raf) raf = requestAnimationFrame(render); };
  function render() {
    raf = 0;
    if (disposed) return;
    const rect = root.getBoundingClientRect();
    if (!visible || !panelVisible() || !intersecting || !root.isConnected || !rect.width || !rect.height || document.hidden) {
      clear('suspended', 'view_hidden'); return;
    }
    if (captureHeld()) return;
    if (lost) { clear('unavailable', 'graphics_context_lost'); return; }
    const frame = videoSource.latest, ref = frame?.frameReference;
    if (!frame || !ref) { clear(['native_disconnected', 'frame_stalled', 'frame_identity_unavailable'].includes(videoSource.reason ?? '') ? 'unavailable' : 'waiting', videoSource.reason); return; }
    if (ref.native_session !== identity.session || ref.epoch !== identity.epoch) { clear('unavailable', 'stale_plugin_session'); return; }
    try {
      if (!renderer) renderer = new VideoCanvas(canvas, options.filtering);
      const dpr = window.devicePixelRatio || 1;
      const size = videoSize(rect.width, rect.height, frame.height, frame.aspect, dpr, options)!;
      canvas.style.width = `${size.width}px`; canvas.style.height = `${size.height}px`;
      const pixels = size.width * size.height * dpr * dpr;
      const budgetScale = Math.min(1, Math.sqrt(MAX_BACKING_PIXELS / pixels));
      const w = Math.max(1, Math.min(8192, Math.floor(size.width * dpr * budgetScale))), h = Math.max(1, Math.min(8192, Math.floor(size.height * dpr * budgetScale)));
      const resized = canvas.width !== w || canvas.height !== h;
      if (resized) { canvas.width = w; canvas.height = h; }
      const changed = lastRevision !== videoSource.revision;
      if (!changed && !resized && !dirty && status.state === 'live') return;
      if (changed || lastRevision < 0) renderer.upload(frame);
      renderer.draw(); dirty = false;
      overlayElement.style.width = `${size.width}px`; overlayElement.style.height = `${size.height}px`;
      const geometry = frame.geometry ? Object.freeze({...frame.geometry}) : null;
      const nextSize: OverlaySize = {width:size.width,height:size.height,pixelWidth:w,pixelHeight:h,dpr,
        logicalWidth:frame.logicalWidth??frame.width,logicalHeight:frame.logicalHeight??frame.height,sourceWidth:frame.width,sourceHeight:frame.height,
        geometry,canvasToCss:geometry?canvasTransform(geometry,frame.width,frame.height,size.width,size.height):null,
        canvasToPixels:geometry?canvasTransform(geometry,frame.width,frame.height,w,h):null};
      if (JSON.stringify(nextSize)!==JSON.stringify(overlaySize)) {
        overlaySize=Object.freeze(nextSize);
        for(const callback of resizeListeners)try{callback(overlaySize);}catch(error){onError(error);}
      }
      if(disposed)return;
      const epoch = `${ref.native_session}:${ref.epoch}`;
      const skipped = status.skipped + (epoch === lastEpoch && lastSequence ? Math.max(0, frame.sequence - lastSequence - 1) : 0);
      const submitted = status.submitted + (changed ? 1 : 0);
      lastRevision = videoSource.revision; lastSequence = frame.sequence; lastEpoch = epoch;
      update({state: 'live', reason: null, sourceWidth: frame.width, sourceHeight: frame.height, aspect: frame.aspect,
        geometry: frame.geometry ? {...frame.geometry} : null, submitted, skipped,
        frame: structuredClone({...ref, presentation: {window: 'main', surface: id, sequence: frame.sequence, stage: 'renderer_submit'}, provenance: 'matched'})});
    } catch (error) { clear('unavailable', `render_failed: ${String(error).slice(0, 160)}`); }
  }
  const refresh = () => {
    dirty = true;
    // Invalidate immediately; a paused/hidden view must not advertise old pixels.
    if (!videoSource.latest) { lastRevision = -1; clear(['native_disconnected', 'frame_stalled', 'frame_identity_unavailable'].includes(videoSource.reason ?? '') ? 'unavailable' : 'waiting', videoSource.reason); }
    if (!panelVisible() || !visible) clear('suspended', 'view_hidden');
    schedule();
  };
  const resize = new ResizeObserver(refresh); resize.observe(root);
  const intersection = new IntersectionObserver(entries => { intersecting = entries[0]?.isIntersecting ?? false; refresh(); }); intersection.observe(root);
  const visibility = () => refresh(); document.addEventListener('visibilitychange', visibility);
  const lostContext = (event: Event) => { event.preventDefault(); lost = true; renderer = undefined; refresh(); };
  const restoredContext = () => { lost = false; lastRevision = -1; refresh(); };
  canvas.addEventListener('webglcontextlost', lostContext); canvas.addEventListener('webglcontextrestored', restoredContext);
  let media: MediaQueryList;
  const watchDpr = () => { media?.removeEventListener('change', dprChanged); media = matchMedia(`(resolution: ${devicePixelRatio}dppx)`); media.addEventListener('change', dprChanged); };
  const dprChanged = () => { watchDpr(); refresh(); }; watchDpr();
  const releaseCapture = onCaptureReleased(refresh);
  const unsubscribe = videoSource.subscribe(() => {
    if (!videoSource.latest) refresh(); else if (visible && panelVisible() && intersecting && !document.hidden) schedule();
  });
  surfaces.set(id, {owner, snapshot: () => {
    const rect = root.getBoundingClientRect(), picture = canvas.getBoundingClientRect();
    const visible = status.state === 'live' && root.isConnected && rect.width > 0 && rect.height > 0 && !canvas.hidden;
    return {...status, frame: visible ? status.frame : null, instanceId,
      rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
      pictureRect: {x: picture.x, y: picture.y, width: picture.width, height: picture.height},
      overlayGeometry: overlaySize,
      backingWidth: canvas.width, backingHeight: canvas.height,
      backingLimited: picture.width * picture.height * (window.devicePixelRatio || 1) ** 2 > MAX_BACKING_PIXELS,
      options, visible};
  }});
  refresh();
  return {
    get status() { return status; }, refresh,
    overlay: {
      element:overlayElement, signal:overlayAbort.signal,
      get size(){return overlaySize;},get frame(){return status.frame;},
      onResize(callback){if(disposed)return ()=>{};if(resizeListeners.size>=32)throw new Error('video_overlay_listener_limit');resizeListeners.add(callback);callback(overlaySize);return ()=>{resizeListeners.delete(callback);};},
      setVisible(value){overlayVisible=Boolean(value);showOverlay();},
      present(value,callback){if(disposed)return;sample=value;paint=callback;showOverlay();},
    },
    setVisible(value) { if (disposed) return; visible = Boolean(value); refresh(); },
    dispose() {
      if (disposed) return; disposed = true; cancelAnimationFrame(raf); unsubscribe(); releaseCapture(); resize.disconnect(); intersection.disconnect();
      document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', dprChanged);
      canvas.removeEventListener('webglcontextlost', lostContext); canvas.removeEventListener('webglcontextrestored', restoredContext);
      overlayAbort.abort(); resizeListeners.clear(); paint=undefined; sample=undefined;
      renderer?.dispose(); canvas.width = canvas.height = 1; root.remove(); surfaces.delete(id);
      update({state: 'disposed', reason: 'disposed', frame: null, geometry: null});
    },
  };
}
