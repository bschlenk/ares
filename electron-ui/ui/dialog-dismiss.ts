/** Dismiss only a click that both starts and ends on the native dialog backdrop. */
export function dismissOnBackdrop(dialog: HTMLDialogElement, close: () => void): void {
  let startedOutside = false;
  const outside = (event: MouseEvent) => {
    const rect = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom);
  };
  dialog.addEventListener('pointerdown', event => { startedOutside = outside(event); });
  dialog.addEventListener('pointercancel', () => { startedOutside = false; });
  dialog.addEventListener('click', event => {
    const dismiss = startedOutside && outside(event); startedOutside = false;
    if (dismiss) close();
  });
  dialog.addEventListener('close', () => { startedOutside = false; });
}
