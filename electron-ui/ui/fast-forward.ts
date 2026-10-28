import {controlOwnsKey} from './keyboard-target.js';
/** Momentary control: every loss-of-input path releases the native speed override. */
export function installFastForward(button: HTMLButtonElement,
  send: (active: boolean) => void, blocked: () => boolean): {binding(code: string): void; release(): void} {
  let code = 'Space', heldKey = '', pointer: number | undefined, active = false;
  function update() {
    const next = Boolean(heldKey || pointer !== undefined);
    if (next === active) return;
    active = next; button.setAttribute('aria-pressed', String(active)); send(active);
  }
  function release() { heldKey = ''; pointer = undefined; update(); }
  window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey ||
      !code || event.code !== code || controlOwnsKey(event.target, event.code) || blocked()) return;
    event.preventDefault(); event.stopImmediatePropagation(); heldKey = event.code; update();
  }, true);
  window.addEventListener('keyup', event => {
    if (event.code !== heldKey) return;
    event.preventDefault(); event.stopImmediatePropagation(); heldKey = ''; update();
  }, true);
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || blocked()) return;
    event.preventDefault(); pointer = event.pointerId; button.setPointerCapture(pointer); update();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => {pointer = undefined; update();});
  button.addEventListener('keydown', event => {
    if (!['Space', 'Enter'].includes(event.code) || event.repeat || blocked()) return;
    event.preventDefault(); heldKey = event.code; update();
  });
  for (const event of ['blur', 'pagehide', 'ares-input-release', 'ares-session-reset']) window.addEventListener(event, release);
  window.addEventListener('focusin', event => { if (controlOwnsKey(event.target, code)) release(); });
  button.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => {if (document.hidden) release();});
  return {
    binding(next) {
      if (code !== next) release();
      code = next;
      button.title = `Hold to fast-forward${code ? ` (${code === 'Space' ? 'Space' : code})` : ''}`;
      if (code) button.setAttribute('aria-keyshortcuts', code === 'Space' ? 'Space' : code.replace(/^Key/, '').replace(/^Digit/, ''));
      else button.removeAttribute('aria-keyshortcuts');
    },
    release,
  };
}
