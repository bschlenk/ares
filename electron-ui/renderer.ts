import {beginVideoCapture,endVideoCapture,captureHeld,onCaptureReleased} from './video/capture.js';
import {VideoCanvas} from './video/canvas.js';
import {videoSource} from './video/source.js';
import {videoSnapshot} from './video/surfaces.js';
import {installCheckpointControls} from './ui/checkpoints.js';
import {installDemonstrationControls} from './ui/demonstration-controls.js';
import {controlOwnsKey} from './ui/keyboard-target.js';
import {updateWindowTitle} from './ui/window-title.js';
import {installFastForward} from './ui/fast-forward.js';
import {configureOverlays,layoutOverlays,submitOverlayFrame,overlayFrame,overlaySnapshot} from './plugins/overlays.js';
import {installPlaybackIdle} from './ui/playback-idle.js';
import { appliedInputSettings, defaultInputSettings, mapInput, boundKeyboardCodes, keyboardPolicy } from './settings/input.js';
import { blocksGameInput, notify, onSessionAction } from './workspace/shell.js';
import type { FramePacket, RendererStats } from './bridge.js';
import type { SessionIdentity, SessionMethod, SessionReply, ServiceParams } from './services/contracts.js';
interface Elements {
  screen: HTMLCanvasElement; viewport: HTMLElement; system: HTMLSelectElement;
  pause: HTMLButtonElement; reset: HTMLButtonElement; open: HTMLButtonElement;
  'video-pause': HTMLButtonElement; 'video-reset': HTMLButtonElement; 'paused-indicator': HTMLElement;
  'video-controls': HTMLElement; 'video-fast-forward': HTMLButtonElement;
}
const $ = <K extends keyof Elements>(id: K): Elements[K] => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element: ${id}`);
  return element as Elements[K];
};
window.addEventListener('error', event => notify(event.message));
const canvas = $('screen'), videoRenderer = new VideoCanvas(canvas), gl = videoRenderer.gl;
let demonstrationActive=false;
let system = 'Synthetic', aspect = 4 / 3;
configureOverlays($('viewport'),canvas);
let width = 0, height = 0, pending: FramePacket | null = null, port: MessagePort | undefined, paused = false;
let repaint = false;
onCaptureReleased(()=>{repaint=true;});
let frames = 0, skipped = 0, last = 0, firstNative = 0, lastNative = 0, firstSequence = 0;
let bridge: number[] = [], upload: number[] = [], inputTimes = new Map<number, number>(), inputAges: number[] = [], latestQueue = 0;
let started = performance.now(), lastStats = started, latestReadback: number[] | null = null;
let receivedFrames = 0, maxPending = 0;
const fastForward = installFastForward($('video-fast-forward'), active => window.ares.command({type:'fast-forward', active}), blocksGameInput);
let scaleSetting = 'fit';
let preferenceRevision = -1;
let inputSettings = defaultInputSettings();
let inputSettingsSignature = JSON.stringify(inputSettings);
function applyPreferences(snapshot: import('./settings/contracts.js').SettingsSnapshot) {
  if (snapshot.revision < preferenceRevision) return;
  preferenceRevision = snapshot.revision;
  const nextInputSettings = appliedInputSettings(snapshot);
  const nextInputSignature = JSON.stringify(nextInputSettings);
  if (nextInputSignature !== inputSettingsSignature) {
    inputSettings = nextInputSettings; inputSettingsSignature = nextInputSignature;
    releaseInput();
  }
  const get = (id: string) => snapshot.entries.find(entry => entry.descriptor.id === id)?.applied;
  document.body.dataset.theme = String(get('presentation.theme') ?? 'dark');
  scaleSetting = String(get('presentation.scale') ?? 'fit');
  fastForward.binding(String(get('emulation.fastForwardKey') ?? 'Space'));
  if (width) resize();
  if (snapshot.error) notify(snapshot.error);
}
window.ares.preferences.changed(applyPreferences);
void window.ares.preferences.catalog().then(applyPreferences).catch(notify);
function resize() {
  if (!width) return;
  const rect = $('viewport').getBoundingClientRect();
  const displayWidth = height * aspect;
  let factor = Math.min(rect.width / displayWidth, rect.height / height);
  if (scaleSetting === 'integer' && factor >= 1) factor = Math.floor(factor);
  const w = Math.max(1, Math.floor(displayWidth * factor)), h = Math.max(1, Math.floor(height * factor));
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  const backingW = Math.round(w * devicePixelRatio), backingH = Math.round(h * devicePixelRatio);
  if (canvas.width !== backingW || canvas.height !== backingH) { canvas.width = backingW; canvas.height = backingH; }
  gl.viewport(0, 0, canvas.width, canvas.height);
  draw();layoutOverlays();
}
function draw() {
  videoRenderer.draw();
}
function watchDpr(){const media=matchMedia(`(resolution: ${devicePixelRatio}dppx)`);media.addEventListener('change',()=>{resize();watchDpr();},{once:true});}
watchDpr();
function discardPending() { if (pending) port?.postMessage({ack:pending.sequence,generation:pending.generation,submitted:false}); pending=null; }
window.addEventListener('ares-session-reset',()=>{discardPending();videoSource.reset('session_changed',sessionIdentity);videoRenderer.clear();submitOverlayFrame(null);layoutOverlays(0,0,0,0,null);});
new ResizeObserver(resize).observe($('viewport'));
window.addEventListener('message', event => {
  if (event.source !== window || event.data?.type !== 'ares-frames' || !event.ports[0]) return;
  port?.close(); port = event.ports[0];
  port.onmessage = ({ data }: MessageEvent<import('./bridge.js').FrameMessage>) => {
    if (data.reset) {
      system = data.system;
      videoRenderer.clear();
      document.getElementById('empty-state')!.hidden = system !== 'Synthetic';
      submitOverlayFrame(null);layoutOverlays(0,0,0,0,null);
      discardPending(); frames = skipped = last = firstNative = lastNative = firstSequence = receivedFrames = maxPending = 0;
      bridge = []; upload = []; inputAges = []; inputTimes.clear(); started = performance.now();
      lastMask = -1; syncSession(); window.dispatchEvent(new Event('ares-session-reset'));
      videoSource.reset(data.reason ?? 'session_changed', data.identity); return;
    }
    receivedFrames++;
    if (pending) throw new Error('Frame credit invariant violated');
    pending = data; maxPending = Math.max(maxPending, 1);
  };
  port.start();
});
// Bits represent ares's virtual pad, so existing per-system mappings remain authoritative.
const pressed = new Set<string>();
const nativePressed = new Set<string>();
let inputSeq = 0, lastMask = -1, lastAxes = '';
function sendInput(mask: number, x = 0, y = 0, rx = 0, ry = 0) {
  const axes = `${x},${y},${rx},${ry}`;
  if (mask === lastMask && axes === lastAxes) return;
  lastMask = mask; lastAxes = axes; inputSeq++;
  if (frames > 60) inputTimes.set(inputSeq, performance.now());
  if (inputTimes.size > 128) inputTimes.delete(inputTimes.keys().next().value!);
  window.ares.command({ type: 'input', sequence: inputSeq, mask, x, y, rx, ry });
}
function pollInput() {
  const input = mapInput(inputSettings, pressed, system, [...navigator.getGamepads()], document.hasFocus() && !blocksGameInput(), document.activeElement === canvas);
  sendInput(input.mask, input.x, input.y, input.rx, input.ry);
}
function nativeKey(code: string) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return 'Num' + code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return 'Keypad' + code.slice(6);
  const names: Record<string, string> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    ShiftLeft: 'LeftShift', ShiftRight: 'RightShift', ControlLeft: 'LeftControl', ControlRight: 'RightControl',
    AltLeft: 'LeftAlt', AltRight: 'RightAlt', MetaLeft: 'LeftSuper', MetaRight: 'RightSuper',
    Backquote: 'Tilde', Minus: 'Dash', Equal: 'Equal', BracketLeft: 'LeftBracket', BracketRight: 'RightBracket',
    Backslash: 'Backslash', Semicolon: 'Semicolon', Quote: 'Apostrophe', Comma: 'Comma', Period: 'Period',
    Slash: 'Slash', NumpadEnter: 'Enter', NumpadAdd: 'Add', NumpadSubtract: 'Subtract',
    NumpadMultiply: 'Multiply', NumpadDivide: 'Divide', NumpadDecimal: 'Point',
    PageUp: 'Pageup', PageDown: 'Pagedown' };
  return names[code] || code;
}
window.addEventListener('keydown', event => {
  if (blocksGameInput() || controlOwnsKey(event.target, event.code)) return;
  const policy = keyboardPolicy(boundKeyboardCodes(inputSettings, system), event);
  if (policy.shortcut) { releaseInput(); return; }
  if (!policy.game) return;
  if (policy.consume) event.preventDefault();
  if (policy.bound) { pressed.add(event.code); pollInput(); }
  // Computer cores still receive ordinary keyboard keys, including unbound keys.
  if (!nativePressed.has(event.code)) {
    nativePressed.add(event.code);
    window.ares.command({ type: 'key', name: nativeKey(event.code), value: true });
  }
});
window.addEventListener('keyup', event => {
  const held = pressed.delete(event.code);
  if (held) {
    if (!controlOwnsKey(event.target, event.code) && keyboardPolicy(boundKeyboardCodes(inputSettings, system), event).consume) event.preventDefault();
    pollInput();
  }
  if (nativePressed.delete(event.code)) window.ares.command({ type: 'key', name: nativeKey(event.code), value: false });
});
function releaseInput() { fastForward.release(); pressed.clear(); nativePressed.clear(); sendInput(0); window.ares.command({ type: 'clear' }); }
window.addEventListener('ares-input-release', releaseInput);
window.addEventListener('blur', releaseInput);
window.addEventListener('focusin', event => { if (controlOwnsKey(event.target, 'KeyA')) releaseInput(); });
function mouseInput(event: MouseEvent) {
  if (document.activeElement !== canvas) return;
  const rect = canvas.getBoundingClientRect();
  // DOM and HID use different middle/right button bit ordering.
  const mask = (event.buttons & 1) | ((event.buttons & 4) >> 1) | ((event.buttons & 2) << 1);
  window.ares.command({ type: 'mouse', x: event.type === 'mousemove' ? event.movementX * width / rect.width : 0,
    y: event.type === 'mousemove' ? event.movementY * height / rect.height : 0, mask });
}
canvas.addEventListener('mousedown', event => { canvas.focus(); mouseInput(event); });
canvas.addEventListener('mousemove', mouseInput); canvas.addEventListener('mouseup', mouseInput);
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.onclick = () => canvas.focus();
window.addEventListener('pagehide', installPlaybackIdle($('viewport')), {once:true});
$('open').onclick = () => window.ares.open({ system: $('system').value });
window.ares.systems().then(systems => {
  for (const name of systems) { const option = document.createElement('option'); option.value = option.textContent = name; $('system').append(option); }
}).catch(error => { notify(error); });
let sessionIdentity: SessionIdentity | undefined;
function acceptSessionState(reply: SessionReply) {
  if (!reply.ok || !reply.result) { if (reply.error?.includes('disconnected')) videoSource.reset('native_disconnected'); return; }
  updateWindowTitle(reply.result.title, reply.result.system);
  const previous = sessionIdentity;
  sessionIdentity = { session: reply.session, epoch: reply.epoch };
  paused = (reply.result.manual_paused ?? reply.result.paused) && reply.result.operation_id == null;
  $('pause').textContent = paused ? 'Resume' : 'Pause';
  const pauseButton = $('video-pause');
  pauseButton.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  pauseButton.title = paused ? 'Resume' : 'Pause';
  pauseButton.querySelector<SVGElement>('.pause-icon')!.toggleAttribute('hidden', paused);
  pauseButton.querySelector<SVGElement>('.play-icon')!.toggleAttribute('hidden', !paused);
  const loaded = !reply.result.synthetic;
  $('video-controls').hidden = !loaded&&!demonstrationActive;
  $('paused-indicator').hidden = !loaded || !(paused || reply.result.focus_paused);
  $('paused-indicator').textContent = reply.result.focus_paused ? 'Ⅱ Paused while unfocused' : 'Ⅱ Paused';
  if (previous && (previous.session !== reply.session || previous.epoch !== reply.epoch)) window.dispatchEvent(new Event('ares-session-reset'));
  videoSource.session(sessionIdentity);
  videoSource.setPaused(Boolean(reply.result.paused || reply.result.focus_paused));
}
window.ares.onSessionState(acceptSessionState);
async function sessionRequest<M extends SessionMethod>(method: M, params?: ServiceParams<M>) {
  let identity = sessionIdentity;
  if (!identity && method !== 'session.status') {
    const status = await window.ares.session('session.status');
    if (!status.ok) throw new Error(status.error);
    acceptSessionState(status);
    identity = { session: status.session, epoch: status.epoch };
  }
  // Capture the identity for this action. Overlapping reload/status synchronization
  // may clear the shared field; stale actions still fail instead of being replayed.
  const reply = await window.ares.session(method, identity, params);
  if (!reply.ok) throw new Error(reply.error);
  acceptSessionState(reply);
  return reply;
}
async function syncSession() {
  sessionIdentity = undefined;
  try { await sessionRequest('session.status'); } catch (error) { notify(error); }
}
async function togglePause() {
  if ($('pause').disabled) return;
  $('pause').disabled = $('video-pause').disabled = true;
  try {
    await sessionRequest('session.status');
    await sessionRequest(paused ? 'session.resume' : 'session.pause');
  }
  catch (error) { notify(error); await syncSession(); }
  finally { $('pause').disabled = $('video-pause').disabled = false; }
}
$('pause').onclick = togglePause;
$('video-pause').onclick = () => { canvas.focus(); void togglePause(); };
$('video-reset').onclick = () => { canvas.focus(); $('reset').click(); };
$('reset').onclick = async () => {
  try { await sessionRequest('session.reset', {preview:true}); }
  catch (error) { notify(error); await syncSession(); }
};
onSessionAction(action => {
  if (action === 'open') $('open').click();
  else if (action === 'pause') $('pause').click();
  else $('reset').click();
});
function stress() { const until = performance.now() + 250; while (performance.now() < until) {} }
window.ares.onStatus(text => { if (!/^ready:|^stopped$/.test(text)) notify(text); });
window.ares.onNativeDiagnostic(text => console.log('[native]', text));
const percentile = (array: number[], p: number) => array.length ? [...array].sort((a, b) => a - b)[Math.min(array.length - 1, Math.floor(array.length * p))] : 0;
function record(array: number[], value: number) { array.push(value); if (array.length > 3600) array.shift(); }
function stats(): RendererStats {
  return { system, frames, receivedFrames, maxPending, skipped, width, height,
    seconds: (performance.now() - started) / 1000,
    nativeFPS: lastNative > firstNative ? (last - firstSequence) * 1000 / (lastNative - firstNative) : 0,
    bridgeToSubmitP50Ms: percentile(bridge, .5), bridgeToSubmitP95Ms: percentile(bridge, .95),
    uploadSubmitP95Ms: percentile(upload, .95), inputToFrameSubmitP95Ms: percentile(inputAges, .95),
    nativeQueueMs: latestQueue, glError: gl.getError(), readback: latestReadback };
}
function tick() {
  pollInput();
  videoSource.checkStale();
  if (pending || repaint && videoSource.latest) {
    const hadCredit = !!pending, frame = pending ?? videoSource.latest!; pending = null; repaint = false;
    if (sessionIdentity && frame.frameReference && (frame.frameReference.native_session !== sessionIdentity.session || frame.frameReference.epoch !== sessionIdentity.epoch)) {
      if(hadCredit)port!.postMessage({ack:frame.sequence,generation:frame.generation,submitted:false}); requestAnimationFrame(tick); return;
    }
    if(hadCredit)videoSource.submit(frame);
    if (captureHeld()) {
      if(hadCredit)port!.postMessage({ack:frame.sequence,generation:frame.generation,submitted:false}); requestAnimationFrame(tick); return;
    }
    const changedAspect = aspect !== frame.aspect; aspect = frame.aspect;
    const before = performance.now();
    if (frame.width !== width || frame.height !== height) {
      width = frame.width; height = frame.height;
      videoRenderer.upload(frame);
      resize();
    } else videoRenderer.upload(frame);
    if (changedAspect) resize();
    draw();
    layoutOverlays(frame.logicalWidth??frame.width,frame.logicalHeight??frame.height,frame.width,frame.height,frame.geometry??null);
    const reference=frame.frameReference?{...frame.frameReference,presentation:{window:'main',sequence:frame.sequence,stage:'renderer_submit' as const},provenance:'matched' as const}:null;
    submitOverlayFrame(reference);
    const after = performance.now();
    record(upload, after - before);
    record(bridge, performance.timeOrigin + after - frame.receivedMs);
    latestQueue = frame.queueMs;
    if (inputTimes.has(frame.inputSequence)) {
      record(inputAges, after - inputTimes.get(frame.inputSequence)!);
      for (const seq of inputTimes.keys()) if (seq <= frame.inputSequence) inputTimes.delete(seq);
    }
    if (last) skipped += Math.max(0, frame.sequence - last - 1);
    else { firstNative = frame.nativeMs; firstSequence = frame.sequence; }
    last = frame.sequence; lastNative = frame.nativeMs; frames++;
    if(hadCredit)port!.postMessage({ ack: frame.sequence, generation: frame.generation,submitted:true });
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
window.beginVideoCapture=beginVideoCapture;window.endVideoCapture=endVideoCapture;
window.videoSnapshot=videoSnapshot;
window.overlayFrame=overlayFrame;window.overlaySnapshot=overlaySnapshot;
window.stats = stats;
window.sendInput = sendInput;
window.ares.ready();
const params = new URLSearchParams(location.search);
if (params.get('autotest') === '1') {
  setTimeout(stress, 2500);
  setTimeout(() => {
    const pixel = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    latestReadback = [...pixel];
    window.ares.command({ type: 'report', report: stats() });
  }, Math.max(5, Math.min(3600, Number(params.get('duration')) || 12)) * 1000);
}

const recordingControls=document.getElementById('recording-controls')!;
window.addEventListener('pagehide',installDemonstrationControls(window.ares,recordingControls,visible=>{
  demonstrationActive=visible;
  $('viewport').toggleAttribute('data-recording-controls',visible);
  $('video-controls').hidden=system==='Synthetic'&&!visible;
},notify),{once:true});

installCheckpointControls();
