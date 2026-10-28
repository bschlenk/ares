/** Drawn at its native 32px size, shared by settings and plugin modals. */
export function styleModalClose(button: HTMLButtonElement): void {
  button.classList.add('modal-close');
  button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false"><path d="M11 11L21 21M21 11L11 21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
}
