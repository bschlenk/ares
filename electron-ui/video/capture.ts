/** Freeze presentation briefly for capture; native emulation and frame credit continue. */
const leases = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
export function captureHeld() { return leases.size > 0; }
export function onCaptureReleased(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback); }; }
export function endVideoCapture(id: string) {
  clearTimeout(leases.get(id)); leases.delete(id);
  if (!leases.size) for (const listener of listeners) listener();
}
export function beginVideoCapture() {
  if (leases.size >= 4) throw new Error('video_capture_busy');
  const id = crypto.randomUUID();
  leases.set(id, setTimeout(() => endVideoCapture(id), 2000));
  return id;
}
