import {CHECKPOINT_FORMAT_PRESETS,formatCheckpoint,validateCheckpointFormat} from '../services/checkpoint-format.js';
import type { PreferencesBridge, SettingEntry, SettingsSnapshot } from './contracts.js';

/** Descriptor-driven controls; reusable by a settings plugin with the same API. */
export function mountSettingsForm(element: HTMLElement, bridge: PreferencesBridge, include = (_entry: SettingEntry) => true, expandSections = false): () => void {
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  const sections = document.createElement('div');
  element.append(sections, message);
  type Row = { entry: SettingEntry; input: HTMLInputElement | HTMLSelectElement; preview?: () => void; note: HTMLElement; slider?: HTMLInputElement; dirty: boolean; busy: boolean; timer?: ReturnType<typeof setTimeout>; finished?: Promise<void> };
  const rows = new Map<string, Row>();
  let disposed = false, revision = -1, signature = '';
  const value = (row: Row) => row.entry.descriptor.type === 'boolean' ? (row.input as HTMLInputElement).checked
    : row.entry.descriptor.type === 'number' ? Number(row.input.value) : row.input.value;
  const run = async (row: Row, action: () => Promise<SettingsSnapshot>) => {
    clearTimeout(row.timer);
    row.timer = undefined;
    if (row.busy) { await row.finished; if (!disposed) await run(row, action); return; }
    let finish!: () => void;
    row.finished = new Promise(resolve => { finish = resolve; });
    row.busy = true;
    row.input.disabled = true; if (row.slider) row.slider.disabled = true;
    try {
      const snapshot = await action();
      if (disposed) return;
      row.dirty = false;
      update(snapshot);
    } catch (error) { if (!disposed) message.textContent = String(error); }
    finally { row.busy = false; row.input.disabled = false; if (row.slider) row.slider.disabled = false; finish(); }
  };
  const save = (row: Row) => {
    clearTimeout(row.timer);
    row.timer = undefined;
    if (!row.dirty || row.busy || !row.input.checkValidity()) return;
    if (row.entry.descriptor.type === 'number' && row.input.value.trim() === '') return;
    const nextValue = value(row);
    void run(row, () => bridge.set(row.entry.descriptor.id, nextValue));
  };
  const edit = (row: Row) => {
    row.dirty = true;
    clearTimeout(row.timer);
    if (row.entry.descriptor.type === 'boolean' || row.entry.descriptor.type === 'enum') save(row);
    else row.timer = setTimeout(() => save(row), 400);
  };
  const update = (snapshot: SettingsSnapshot) => {
    if (disposed || snapshot.revision < revision) return;
    revision = snapshot.revision;
    const entries = snapshot.entries.filter(include);
    const nextSignature = JSON.stringify(entries.map(entry => entry.descriptor));
    if (signature !== nextSignature) {
      signature = nextSignature;
      for (const row of rows.values()) clearTimeout(row.timer);
      sections.replaceChildren(); rows.clear();
      const groups = new Map<string, HTMLElement>();
      for (const entry of entries) {
        const descriptor = entry.descriptor;
        let group = groups.get(descriptor.section);
        if (!group) {
          const details = document.createElement('details'), summary = document.createElement('summary');
          summary.textContent = descriptor.section;
          details.open = expandSections;
          details.append(summary); sections.append(details); groups.set(descriptor.section, details); group = details;
        }
        const field = document.createElement('div'), label = document.createElement('label');
        field.className = 'setting-field'; field.dataset.setting = descriptor.id;
        label.textContent = descriptor.title;
        let input: HTMLInputElement | HTMLSelectElement;
        if (descriptor.type === 'enum') {
          input = document.createElement('select');
          for (const option of descriptor.options) {
            const element = document.createElement('option'); element.value = option; element.textContent = option; input.append(element);
          }
        } else {
          input = document.createElement('input');
          input.type = descriptor.type === 'boolean' ? 'checkbox' : descriptor.type === 'number' ? 'number' : 'text';
          if (descriptor.type === 'number') { input.min = String(descriptor.min); input.max = String(descriptor.max); input.step = descriptor.integer ? '1' : 'any'; }
        }
        const controls = document.createElement('div'), note = document.createElement('p');
        controls.className = 'setting-controls';
        let slider: HTMLInputElement | undefined;
        if (descriptor.control === 'slider' && descriptor.type === 'number') {
          slider = document.createElement('input'); slider.type = 'range';
          slider.min = String(descriptor.min); slider.max = String(descriptor.max); slider.step = 'any';
          slider.setAttribute('aria-label', descriptor.title);
          input.setAttribute('aria-label', `${descriptor.title} value`); input.classList.add('setting-range-value');
          label.append(slider); controls.append(label, input);
        } else { label.append(input); controls.append(label); }
        field.append(controls);
        const row: Row = { entry, input, note, slider, dirty: false, busy: false }; rows.set(descriptor.id, row);
        let preview:HTMLElement|undefined;
        const datePreview=()=>{if(preview){const error=validateCheckpointFormat(input.value);input.setCustomValidity(error||'');preview.textContent=error||formatCheckpoint(new Date(),input.value)}};
        if(descriptor.id==='states.dateFormat'){
          preview=document.createElement('p');preview.setAttribute('aria-live','polite');
          const presets=document.createElement('select');presets.setAttribute('aria-label','Date format presets');
          const placeholder=document.createElement('option');placeholder.textContent='Date format presets…';placeholder.value='';presets.append(placeholder);
          for(const format of CHECKPOINT_FORMAT_PRESETS){const option=document.createElement('option');option.value=format;option.textContent=formatCheckpoint(new Date(),format);presets.append(option)}
          presets.onchange=()=>{if(presets.value){input.value=presets.value;datePreview();edit(row);save(row)}};
          controls.append(presets);field.append(preview);
          const help=document.createElement('p');help.textContent='Supported: %% %Y %y %m %B %b %d %e %H %I %M %S %p %a %z. Changes labels only.';field.append(help);
        }
        row.preview=datePreview;
        input.oninput = () => {datePreview(); if (slider && input.checkValidity() && input.value !== '') slider.value = input.value; edit(row); };
        if (slider) {
          slider.oninput = () => { input.value = slider!.value; edit(row); };
          slider.onchange = slider.onblur = () => save(row);
        }
        input.onchange = () => save(row);
        input.onblur = () => save(row);
        if (descriptor.control === 'key') {
          const record = document.createElement('button'); record.textContent = 'Record key';
          let recording = false;
          record.onclick = () => { recording = true; record.textContent = 'Press a key (Esc cancels)'; input.focus(); };
          input.onkeydown = event => {
            if (!recording) return;
            event.preventDefault(); event.stopPropagation();
            recording = false; record.textContent = 'Record key';
            if (event.code !== 'Escape') { input.value = event.code; edit(row); save(row); }
          };
          input.onblur = () => { recording = false; record.textContent = 'Record key'; save(row); };
          controls.append(record);
        }

        if (descriptor.file) {
          const browse = document.createElement('button'); browse.textContent = descriptor.file.directory ? 'Choose folder…' : 'Choose file…';
          browse.onclick = () => { void run(row, () => bridge.chooseFile(descriptor.id)); };
          controls.append(browse);
        }
        input.addEventListener('focus',datePreview);
        const reset = document.createElement('button'); reset.textContent = 'Reset';
        reset.className = 'setting-reset';
        reset.setAttribute('aria-label', `Reset ${descriptor.title}`);
        reset.onclick = () => { void run(row, () => bridge.reset(descriptor.id)); };
        controls.append(reset); field.append(note); group.append(field);
      }
    }
    for (const entry of entries) {
      const row = rows.get(entry.descriptor.id)!; row.entry = entry;
      if (!row.dirty) {
        if (entry.descriptor.type === 'boolean') (row.input as HTMLInputElement).checked = entry.value === true;
        else { row.input.value = String(entry.value); if (row.slider) row.slider.value = String(entry.value); }
      }
      row.preview?.();
      row.note.textContent = `${entry.source} · ${entry.pending ? `Saved; applies ${entry.descriptor.apply === 'next-rom' ? 'on next ROM load' : entry.descriptor.apply === 'restart' ? 'after restart' : 'when applied'}` : entry.descriptor.apply === 'next-rom' ? 'Next ROM load' : entry.descriptor.apply === 'restart' ? 'Restart required' : 'Live'}`;
      row.note.dataset.pending = String(entry.pending);
    }
    message.textContent = snapshot.error ?? '';
  };
  const unsubscribe = bridge.changed(update);
  void bridge.catalog().then(update).catch(error => { if (!disposed) message.textContent = String(error); });
  return () => { for (const row of rows.values()) save(row); disposed = true; unsubscribe(); element.replaceChildren(); };
}
