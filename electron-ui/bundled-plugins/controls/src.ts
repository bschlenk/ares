import { controllerLayouts, type ControllerControl } from './layouts';
import type { PluginContext, PanelContext, SettingsSnapshot, SettingValue } from '../../plugins/sdk';

export function activate(context: PluginContext) {
  context.ui.registerPanel('controls', panel => mount(context, panel));
}
function mount(context: PluginContext, panel: PanelContext) {
  const root = panel.element;
  root.classList.add('controls-editor');
  root.innerHTML = `<div class="controls-toolbar"><label>System <select data-system></select></label><label>Input <select data-device><option value="keyboard">Keyboard</option><option value="first-standard">First standard gamepad</option></select></label></div><p class="controls-help">Select a button on the controller or in the list, then press the key or gamepad button to assign. Esc cancels; Backspace clears.</p><div class="controls-layout"><div class="controls-picture"><img draggable="false"><div data-points></div></div><div class="controls-bindings"></div></div><div class="controls-footer"><button data-map>Map all buttons</button><button data-cancel hidden>Cancel</button><label><input type="checkbox" data-next checked> Advance to next button</label></div><p role="status" aria-live="polite"></p><p class="controls-help">Virtual port 1 · Bindings are shared across systems. Advanced input settings includes additional controls and device options.</p><small>Controller illustrations from OpenEmu. Illustrations by the OpenEmu contributors. Keyboard art: <a href="https://www.vecteezy.com/" target="_blank" rel="noopener noreferrer">Vecteezy.com</a>.</small>`;
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const system = get<HTMLSelectElement>('[data-system]'), device = get<HTMLSelectElement>('[data-device]');
  const status = get('[role=status]'), image = get<HTMLImageElement>('.controls-picture img'), points = get('[data-points]'), bindings = get('.controls-bindings');
  const cancel = get<HTMLButtonElement>('[data-cancel]');
  const deviceButton = document.createElement('button'); deviceButton.type = 'button';
  deviceButton.append(document.createElement('selectedcontent')); device.prepend(deviceButton);
  function deviceOption(title: string, value: string): HTMLOptionElement {
    const option = new Option('', value), icon = document.createElement('img');
    icon.className = 'system-icon'; icon.alt = ''; icon.width = 36; icon.height = 36;
    icon.src = new URL(`./assets/devices/${value === 'keyboard' ? 'keyboard' : 'gamepad'}.png`, import.meta.url).href;
    const text = document.createElement('span'); text.textContent = title;
    option.append(icon, text); return option;
  }
  for (const option of [...device.options]) option.replaceWith(deviceOption(option.textContent ?? '', option.value));
  const icons: Record<string, string> = {
    'Game Boy': 'game-boy', 'Game Boy Color': 'game-boy-color', 'Game Boy Advance': 'game-boy-advance',
    Famicom: 'nes', 'Super Famicom': 'snes', 'Nintendo 64': 'n64',
    'Mega Drive': 'mega-drive', 'Master System': 'master-system', 'Game Gear': 'game-gear',
  };
  // Chromium's customizable native select preserves built-in keyboard, focus,
  // selection and accessibility behavior while allowing images in options.
  const selectedButton = document.createElement('button'); selectedButton.type = 'button';
  selectedButton.append(document.createElement('selectedcontent')); system.append(selectedButton);
  for (const layout of controllerLayouts) {
    const option = new Option('', layout.name);
    if (icons[layout.name]) {
      const icon = document.createElement('img'); icon.className = 'system-icon'; icon.alt = '';
      icon.width = 144; icon.height = 144;
      icon.src = new URL(`./assets/systems/${icons[layout.name]}.png`, import.meta.url).href;
      option.append(icon);
    }
    const title = document.createElement('span'); title.textContent = layout.name; option.append(title);
    system.add(option);
  }
  system.value = controllerLayouts.some(l => l.name === context.system) ? context.system : 'Game Boy';
  let layout = controllerLayouts.find(l => l.name === system.value)!;
  let snapshot: SettingsSnapshot | undefined, active = -1, saving = false, disposed = false, revision = -1;
  let previousButtons = new Set<number>(), previousAxes = new Set<number>(), armed = false;
  const values = () => new Map(snapshot?.entries.map(e => [e.descriptor.id, e.value]));
  const gamepad = () => device.value === 'first-standard'
    ? [...navigator.getGamepads()].find(p => p?.connected && p.mapping === 'standard')
    : navigator.getGamepads()[Number(device.value)];
  function id(control: ControllerControl) {
    let key = control.key;
    if (device.value !== 'keyboard') {
      if (key === 'n64A') key = 'south'; if (key === 'n64B') key = 'west';
      key = key.replace(/\.(negative|positive)$/, '.axis');
    }
    return `input.${device.value === 'keyboard' ? 'keyboard' : 'gamepad'}.${key}`;
  }
  function label(control: ControllerControl): string {
    const value = values().get(id(control));
    if (value === undefined) return 'Unavailable';
    if (device.value === 'keyboard') return String(value).split(',').map(k => k.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '')).join(' / ') || 'Unassigned';
    if (value === -1) return 'Unassigned';
    return `${control.key.includes('.') ? 'Axis' : 'Button'} ${value}`;
  }
  function paint() {
    const scroll = bindings.scrollTop;
    bindings.replaceChildren(); points.replaceChildren();
    system.disabled = saving; device.disabled = saving; cancel.disabled = saving;
    layout.controls.forEach((control, index) => {
      const row = document.createElement('div'); row.className = 'controls-binding'; row.dataset.control = control.key;
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = `${control.label} · ${active === index ? saving ? 'Saving…' : 'Press an input…' : label(control)}`;
      button.setAttribute('aria-pressed', String(active === index)); button.disabled = saving || !values().has(id(control));
      button.onclick = () => start(index);
      const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = '↺'; reset.title = `Reset ${control.label}`; reset.setAttribute('aria-label', reset.title); reset.disabled = saving;
      reset.onclick = () => { stop(); void perform(async () => {
        const setting = id(control);
        if (setting.endsWith('.axis')) { await context.settings.reset(setting.replace(/\.axis$/, '.invert')); checkAlive(); }
        return context.settings.reset(setting);
      }); };
      row.append(button, reset); bindings.append(row);
      const point = document.createElement('button'); point.type = 'button'; point.className = 'controls-point'; point.style.left = `${control.x}%`; point.style.top = `${control.y}%`;
      point.title = `Map ${control.label}`; point.setAttribute('aria-label', point.title); point.setAttribute('aria-pressed', String(active === index)); point.disabled = saving;
      point.onclick = () => start(index);
      const preview = (highlighted: boolean) => { point.dataset.preview = String(highlighted); };
      row.onpointerenter = () => preview(true);
      row.onpointerleave = () => preview(row.contains(document.activeElement));
      row.addEventListener('focusin', () => preview(true));
      row.addEventListener('focusout', event => preview(row.matches(':hover') || row.contains(event.relatedTarget as Node | null)));
      if (control.x > 0 && control.y < 100) points.append(point);
    });
    bindings.scrollTop = scroll;
    const selected = bindings.children[active] as HTMLElement | undefined;
    if (selected && active >= 0) {
      if (selected.offsetTop < bindings.scrollTop) bindings.scrollTop = selected.offsetTop;
      else if (selected.offsetTop + selected.offsetHeight > bindings.scrollTop + bindings.clientHeight) bindings.scrollTop = selected.offsetTop + selected.offsetHeight - bindings.clientHeight;
    }
    cancel.hidden = active < 0;
    get<HTMLButtonElement>('[data-map]').disabled = saving || !snapshot;
  }
  function update(next: SettingsSnapshot) { if (disposed || next.revision < revision) return; snapshot = next; revision = next.revision; paint(); }
  function stop() { active = -1; armed = false; status.textContent = ''; paint(); }
  function start(index: number) {
    if (saving) return;
    active = index; armed = false;
    const pad = gamepad(); previousButtons = new Set(pad?.buttons.flatMap((b, i) => b.pressed ? [i] : []) ?? []);
    previousAxes = new Set(pad?.axes.flatMap((v, i) => Math.abs(v) > 0.5 ? [i] : []) ?? []);
    status.textContent = `Mapping ${layout.controls[index].label}. ${device.value === 'keyboard' ? 'Press a key.' : pad ? 'Press a button or move the indicated stick.' : 'Connect the selected gamepad to continue.'}`;
    window.dispatchEvent(new Event('ares-input-release')); paint(); cancel.focus({ preventScroll: true });
  }
  function checkAlive() { if (disposed || panel.signal.aborted) throw new Error('Controller editor closed'); }
  async function perform(action: () => Promise<SettingsSnapshot>) {
    saving = true; paint();
    try { const next = await action(); if (!disposed) { update(next); status.textContent = next.error ?? 'Binding saved.'; } return true; }
    catch (error) { if (!disposed) status.textContent = String(error); return false; }
    finally { saving = false; if (!disposed) paint(); }
  }
  async function assign(value: SettingValue, invert?: boolean) {
    if (active < 0 || saving) return;
    const index = active, control = layout.controls[index], setting = id(control);
    const ok = await perform(async () => {
      // Device selection and bindings both use the public, scoped settings API.
      if (device.value !== 'keyboard') { await context.settings.set('input.gamepad.device', device.value); checkAlive(); }
      if (invert !== undefined) { await context.settings.set(setting.replace(/\.axis$/, '.invert'), invert); checkAlive(); }
      return context.settings.set(setting, value);
    });
    if (disposed || !ok) return;
    if (get<HTMLInputElement>('[data-next]').checked && index + 1 < layout.controls.length) start(index + 1);
    else { active = -1; paint(); status.textContent = 'Mapping saved.'; }
  }
  function showLayout() { stop(); layout = controllerLayouts.find(l => l.name === system.value)!; image.src = new URL(`./assets/${layout.image}`, import.meta.url).href; image.alt = `${layout.name} controller`; paint(); }
  system.onchange = showLayout; device.onchange = stop; cancel.onclick = stop;
  get<HTMLButtonElement>('[data-map]').onclick = () => start(0);
  const keydown = (event: KeyboardEvent) => {
    if (active < 0 || disposed || panel.signal.aborted || !root.checkVisibility()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat || saving) return;
    if (event.code === 'Escape') stop();
    else if (event.code === 'Backspace' || event.code === 'Delete') void assign(device.value === 'keyboard' ? '' : -1);
    else if (device.value === 'keyboard' && event.code) void assign(event.code);
  };
  context.scope.listen(window, 'keydown', keydown as EventListener);
  context.scope.listen(window, 'blur', stop);
  function devices() {
    const selected = device.value;
    while (device.options.length > 2) device.remove(2);
    for (const pad of navigator.getGamepads()) if (pad) device.add(deviceOption(`${pad.index + 1}: ${pad.id}`, String(pad.index)));
    if ([...device.options].some(o => o.value === selected)) device.value = selected;
    else if (selected !== 'keyboard') { device.add(deviceOption(`Disconnected gamepad ${Number(selected) + 1}`, selected)); device.value = selected; }
  }
  context.scope.listen(window, 'gamepadconnected', devices); context.scope.listen(window, 'gamepaddisconnected', devices);
  context.scope.interval(() => {
    if (active < 0 || saving || !root.checkVisibility() || device.value === 'keyboard' || !document.hasFocus()) return;
    const pad = gamepad(); if (!pad) return;
    const buttons = new Set(pad.buttons.flatMap((b, i) => b.pressed ? [i] : []));
    const axes = new Set(pad.axes.flatMap((v, i) => Math.abs(v) > 0.6 ? [i] : []));
    // Require neutral input between steps so one held input cannot fill the list.
    if (!armed) { armed = buttons.size === 0 && axes.size === 0; previousButtons = buttons; previousAxes = axes; return; }
    const control = layout.controls[active];
    if (control.key.includes('.')) {
      const axis = [...axes].find(i => !previousAxes.has(i));
      if (axis !== undefined) void assign(axis, (pad.axes[axis] > 0) === control.key.endsWith('.negative'));
    } else {
      const button = [...buttons].find(i => !previousButtons.has(i));
      if (button !== undefined) void assign(button);
    }
    previousButtons = buttons; previousAxes = axes;
  }, 50);
  const unsubscribe = context.settings.changed(update);
  devices(); showLayout();
  void context.settings.catalog().then(update).catch(error => { if (!disposed) status.textContent = String(error); });
  return () => { disposed = true; active = -1; unsubscribe(); root.replaceChildren(); };
}
