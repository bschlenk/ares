import {dismissOnBackdrop} from '../ui/dialog-dismiss.js';
import { styleModalClose } from '../ui/modal-close.js';
import type { Cleanup, PanelMount } from '../workspace/runtime.js';

interface Modal {
  title: string;
  mount: (context: PanelMount) => void | Cleanup;
  dialog?: HTMLDialogElement;
  element?: HTMLElement;
  cleanup?: Cleanup;
  visible: boolean;
  listeners: Set<(visible: boolean) => void>;
  previous?: HTMLElement;
}
const modals = new Map<string, Modal>();
function visibility(modal: Modal, visible: boolean) {
  if (modal.visible === visible) return;
  modal.visible = visible;
  for (const listener of modal.listeners) listener(visible);
}
function close(modal: Modal) {
  if (!modal.dialog?.open) return;
  modal.dialog.close(); visibility(modal, false);
  if (modal.previous?.isConnected && modal.previous.getClientRects().length && !modal.previous.closest('[inert]')) modal.previous.focus({preventScroll: true});
  else document.getElementById('screen')?.focus({preventScroll: true});
}
export function registerModalPanel(key: string, title: string, mount: Modal['mount']): Cleanup {
  if (modals.has(key)) throw new Error('duplicate_modal_panel');
  const modal: Modal = {title, mount, visible: false, listeners: new Set()};
  modals.set(key, modal);
  return async () => {
    if (modals.get(key) !== modal) return;
    modals.delete(key); close(modal);
    modal.dialog?.remove(); modal.listeners.clear(); await modal.cleanup?.();
  };
}
export function openModalPanel(key: string, automatic = false, size?: {width: number; height: number}): boolean {
  const modal = modals.get(key);
  if (!modal) return false;
  if (automatic) return true;
  if (!modal.dialog) {
    const dialog = document.createElement('dialog'); dialog.className = 'plugin-modal';
    dialog.dataset.pluginModal = key;
    const header = document.createElement('header'), title = document.createElement('h2'), button = document.createElement('button');
    title.id = `modal-${crypto.randomUUID()}`; title.textContent = modal.title;
    dialog.setAttribute('aria-labelledby', title.id);
    styleModalClose(button); button.setAttribute('aria-label', `Close ${modal.title}`);
    button.onclick = () => close(modal);
    const actions = document.createElement('div'); actions.className = 'modal-header-actions';
    actions.append(button); header.append(title, actions);
    const element = document.createElement('div'); element.className = 'plugin-modal-content';
    const parts = key.split(':'); element.dataset.pluginPanel = `${parts[1]}:${parts[2]}`;
    dialog.append(header, element); document.body.append(dialog);
    modal.dialog = dialog; modal.element = element;
    dismissOnBackdrop(dialog, () => close(modal));
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(modal); });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) { event.preventDefault(); close(modal); }
    });
    try {
      modal.cleanup = modal.mount({element, instanceId: `modal:${key}`, onVisibility(callback) {
        modal.listeners.add(callback); callback(modal.visible);
        return () => { modal.listeners.delete(callback); };
      }}) || undefined;
    } catch (error) { dialog.remove(); modal.dialog = undefined; modal.element = undefined; modal.listeners.clear(); throw error; }
  }
  const dialog = modal.dialog;
  if (size && Number.isFinite(size.width) && Number.isFinite(size.height)) {
    dialog.style.width = `${Math.max(180, Math.min(8192, size.width))}px`;
    dialog.style.height = `${Math.max(100, Math.min(8192, size.height))}px`;
  }
  if (!dialog.open) {
    modal.previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    window.dispatchEvent(new Event('ares-input-release'));
    dialog.showModal(); visibility(modal, true);
  }
  // Focus a useful control, never a structural tabindex=-1 content wrapper.
  (dialog.querySelector<HTMLElement>('[autofocus]') ?? dialog.querySelector<HTMLElement>('button, input, select, textarea'))?.focus({preventScroll: true});
  return true;
}
export function closeModalPanel(key: string): boolean {
  const modal = modals.get(key);
  if (!modal) return false;
  close(modal); return true;
}

export function openPluginModals(id: string): string[] {
  return [...modals].filter(([key, modal]) => key.startsWith(`plugin:${id}:`) && modal.dialog?.open).map(([key]) => key);
}
