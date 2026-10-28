const navigation = new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown']);
/** Give native editors and control activation/navigation their normal keys first. */
export function controlOwnsKey(target: EventTarget | null, code: string): boolean {
  if (code === 'Tab' || code === 'Escape') return true;
  if (!(target instanceof Element)) return false;
  const control = target.closest('input,textarea,select,button,summary,a[href],[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"],[role="listbox"],[role="slider"],[role="spinbutton"],[role="radio"],[role="checkbox"],[role="button"],[role="menu"]');
  if (!control) return false;
  if (control.matches('textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"],[role="listbox"],[role="spinbutton"]')) return true;
  if (control instanceof HTMLInputElement) {
    if (control.type === 'range') return navigation.has(code);
    if (control.type === 'radio') return code === 'Space' || navigation.has(code);
    if (control.type === 'checkbox') return code === 'Space';
    if (!['button','submit','reset','file','color','hidden'].includes(control.type)) return true;
  }
  if (control.matches('[role="slider"],[role="radio"],[role="menu"]') && navigation.has(code)) return true;
  return code === 'Space' || code === 'Enter';
}
