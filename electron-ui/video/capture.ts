/** Presentation and app chrome share a lease for the entire capture interval.
 * Native emulation/credit continue; only the last lease restores presentation.
 * The main capture caller releases in finally. Navigation destroys the scope. */
const leases = new Set<string>();
const listeners = new Set<() => void>();
export function captureHeld() { return leases.size > 0; }
export function hasVideoCapture(id: string) { return leases.has(id); }
export function onCaptureReleased(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback); }; }
function applyChromeScope() {
  if(typeof document !== 'undefined')document.documentElement.toggleAttribute('data-game-capture',captureHeld());
}
export function endVideoCapture(id: string) {
  if(!leases.delete(id))return;
  applyChromeScope();
  if (!leases.size) for (const listener of listeners) listener();
}
export function beginVideoCapture() {
  if (leases.size >= 4) throw new Error('video_capture_busy');
  const id = crypto.randomUUID();leases.add(id);applyChromeScope();return id;
}
export async function beginVideoCaptureReady() {
  const id=beginVideoCapture();
  try {
    // Wait for style/layout and a compositor submission with excluded chrome hidden.
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    return id;
  } catch(error) {endVideoCapture(id);throw error;}
}
if(typeof window !== 'undefined' && typeof window.addEventListener==='function')window.addEventListener('pagehide',()=>{
  for(const id of [...leases])endVideoCapture(id);
});
