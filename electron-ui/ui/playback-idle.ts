/** Pointer inactivity affects the viewport only; native focus-visible controls stay usable. */
export function installPlaybackIdle(viewport: HTMLElement, toolbarDelay = 5000, cursorDelay = 5000): () => void {
  const events = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined, toolbarTimer: ReturnType<typeof setTimeout> | undefined, inside = false;
  const clear = () => { clearTimeout(timer); clearTimeout(toolbarTimer); timer = toolbarTimer = undefined; delete viewport.dataset.mouseIdle; delete viewport.dataset.toolbarIdle; };
  const wake = () => {
    clear();
    if (inside) {
      timer = setTimeout(() => { viewport.dataset.mouseIdle = 'true'; }, cursorDelay);
      toolbarTimer = setTimeout(() => { viewport.dataset.toolbarIdle = 'true'; }, toolbarDelay);
    }
  };
  const pointer = (event: PointerEvent) => { if (event.pointerType === 'mouse') { inside = true; wake(); } };
  viewport.addEventListener('pointerenter', pointer, {signal: events.signal});
  viewport.addEventListener('pointermove', pointer, {signal: events.signal});
  viewport.addEventListener('pointerdown', pointer, {signal: events.signal});
  viewport.addEventListener('pointerleave', () => { inside = false; clear(); }, {signal: events.signal});
  viewport.addEventListener('wheel', wake, {passive: true, signal: events.signal});
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(timer); clearTimeout(toolbarTimer); timer = toolbarTimer = undefined; if (inside) { viewport.dataset.mouseIdle = 'true'; viewport.dataset.toolbarIdle = 'true'; } }
    else wake();
  }, {signal: events.signal});
  return () => { events.abort(); clear(); };
}
