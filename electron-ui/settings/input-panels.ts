import type { Cleanup, PanelMount } from '../workspace/runtime.js';

// A generic settings slot: plugins own the complete editor and binding policy.
const root = document.getElementById('settings-input')!;
const label = document.createElement('label'), select = document.createElement('select');
label.textContent = 'Controller mapping editor '; label.append(select);
const body = document.createElement('div'), empty = document.createElement('p');
empty.textContent = 'Enable a controller mapping plugin in Plugins, or use Advanced input settings.';
root.append(label, empty, body);
const panels = new Map<string, { title: string; mount(context: PanelMount): void | Cleanup }>();
let mounted: string | undefined, cleanup: void | Cleanup, sequence = 0;
const visibility = new Set<(visible: boolean) => void>();
const visible = () => !!document.querySelector('#settings-dialog[open] [data-page="input"]:not([hidden])');
function refresh(): void {
  const previous = select.value;
  select.replaceChildren();
  for (const [key, panel] of panels) {
    const option = document.createElement('option'); option.value = key; option.textContent = panel.title; select.append(option);
  }
  if (panels.has(previous)) select.value = previous;
  empty.hidden = panels.size > 0; label.hidden = panels.size === 0;
  const selected = visible() ? select.value : undefined;
  if (selected === mounted) return;
  mounted = selected; ++sequence;
  for (const callback of visibility) callback(false);
  visibility.clear();
  const oldCleanup = cleanup; cleanup = undefined;
  if (oldCleanup) void Promise.resolve(oldCleanup()).catch(console.error);
  body.replaceChildren();
  if (!selected) return;
  const element = document.createElement('div'); body.append(element);
  cleanup = panels.get(selected)!.mount({ instanceId: `input-settings-${sequence}`, element,
    onVisibility(callback) { visibility.add(callback); callback(true); return () => { visibility.delete(callback); }; } });
}
select.onchange = refresh;
const observer = new MutationObserver(refresh);
observer.observe(document.getElementById('settings-dialog')!, { attributes: true, attributeFilter: ['open'] });
observer.observe(document.querySelector('[data-page="input"]')!, { attributes: true, attributeFilter: ['hidden'] });
export function registerInputSettingsPanel(key: string, title: string, mount: (context: PanelMount) => void | Cleanup): Cleanup {
  panels.set(key, { title, mount }); refresh();
  return () => { panels.delete(key); refresh(); };
}
