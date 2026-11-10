import {readSettings, settingsTransaction} from './transaction.js';
import { validateValue, type SettingDescriptor, type SettingValue, type SettingsSnapshot } from './contracts.js';

/** The main process owns writes. Unknown values survive descriptor removal and readdition. */
export class SettingsStore {
  private inherited: Record<string, unknown> = Object.create(null);
  private values: Record<string, unknown> = Object.create(null);
  private applied = new Map<string, SettingValue>();
  private descriptors = new Map<string, SettingDescriptor>();
  private revision = 0;
  private error?: string;
  private unreadable = false;
  private queue: Promise<unknown> = Promise.resolve();
  private applyErrors = new Map<string, string>();
  private launchValues: Record<string, unknown>;
  constructor(readonly filename: string, descriptors: readonly SettingDescriptor[], private changed: (snapshot: SettingsSnapshot) => void = () => {}, private applyLive: (id: string, value: SettingValue) => Promise<void> = async () => {}, launchValues: Record<string, unknown> = {}) {
    this.launchValues = Object.assign(Object.create(null), launchValues);
    this.register(descriptors, false);
    try {
      this.values = readSettings(filename).values;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.error = `Cannot read ${filename}: ${String(error)}`;
        this.unreadable = true;
      }
    }
    for (const descriptor of this.descriptors.values()) this.applied.set(descriptor.id, this.value(descriptor));
  }
  register(descriptors: readonly SettingDescriptor[], notify = true): void {
    // Validate the entire batch before publishing any definitions.
    const ids = new Set(this.descriptors.keys());
    for (const descriptor of descriptors) {
      if (!/^[a-zA-Z][a-zA-Z0-9._:-]{0,255}$/.test(descriptor.id) || ids.has(descriptor.id) || !validateValue(descriptor, descriptor.default)) throw new Error('invalid_setting_descriptor');
      ids.add(descriptor.id);
    }
    for (const descriptor of descriptors) {
      this.descriptors.set(descriptor.id, structuredClone(descriptor));
      this.applied.set(descriptor.id, this.value(descriptor));
    }
    if (notify) { this.revision++; this.changed(this.catalog()); }
  }
  remove(ids: readonly string[]): void {
    for (const id of ids) { this.descriptors.delete(id); this.applied.delete(id); this.applyErrors.delete(id); }
    this.revision++; this.changed(this.catalog());
  }
  preview(descriptors: readonly SettingDescriptor[]): SettingsSnapshot {
    const snapshot = this.catalog();
    for (const descriptor of descriptors) {
      if (snapshot.entries.some(entry => entry.descriptor.id === descriptor.id)) continue;
      const value = this.value(descriptor);
      snapshot.entries.push({ descriptor: structuredClone(descriptor), value, applied: value, pending: false, source: validateValue(descriptor, this.values[descriptor.id]) ? 'profile' : 'default' });
    }
    return snapshot;
  }
  inherit(values: Record<string, unknown>): void {
    this.inherited = Object.assign(Object.create(null), values);
    this.revision++;
    this.changed(this.catalog());
  }
  private value(descriptor: SettingDescriptor): SettingValue {
    const launch = this.launchValues[descriptor.id];
    if (validateValue(descriptor, launch)) return launch;
    const value = this.values[descriptor.id];
    if (validateValue(descriptor, value)) return value;
    const inherited = this.inherited[descriptor.id];
    return validateValue(descriptor, inherited) ? inherited : descriptor.default;
  }
  catalog(): SettingsSnapshot {
    const invalid = [...this.descriptors.values()].filter(d => Object.hasOwn(this.values, d.id) && !validateValue(d, this.values[d.id])).map(d => d.id);
    const applyError = [...this.applyErrors.values()].join('; ') || undefined;
    return {
      revision: this.revision,
      entries: [...this.descriptors.values()].map(descriptor => {
        const value = this.value(descriptor), applied = this.applied.get(descriptor.id) ?? descriptor.default;
        return { descriptor: structuredClone(descriptor), value, applied, source: validateValue(descriptor, this.launchValues[descriptor.id]) ? 'launch' : validateValue(descriptor, this.values[descriptor.id]) ? 'profile' : validateValue(descriptor, this.inherited[descriptor.id]) ? 'imported' : 'default', pending: value !== applied };
      }),
      ...(this.error || applyError || invalid.length ? { error: this.error ?? applyError ?? `Invalid saved settings (using inherited values or defaults): ${invalid.join(', ')}` } : {}),
    };
  }
  /** Acknowledge the exact startup snapshot, even if desired values changed during load. */
  markApplied(snapshot: SettingsSnapshot, timing: 'live' | 'next-rom' | 'restart', ids?: readonly string[]): void {
    for (const entry of snapshot.entries) {
      const descriptor = this.descriptors.get(entry.descriptor.id);
      if (descriptor?.apply === timing && (!ids || ids.includes(descriptor.id)) && validateValue(descriptor, entry.value)) {
        this.applied.set(descriptor.id, entry.value);
        if (this.value(descriptor) === entry.value) this.applyErrors.delete(descriptor.id);
      }
    }
    this.revision++;
    this.changed(this.catalog());
  }
  set(id: string, value: unknown, guard: () => void = () => {}): Promise<SettingsSnapshot> {
    const operation = this.queue.then(() => { guard(); return this.write(id, value, false, guard); });
    this.queue = operation.catch(() => {});
    return operation;
  }
  reset(id: string, guard: () => void = () => {}): Promise<SettingsSnapshot> {
    const operation = this.queue.then(() => { guard(); return this.write(id, undefined, true, guard); });
    this.queue = operation.catch(() => {});
    return operation;
  }
  private async write(id: string, value: unknown, reset = false, guard: () => void = () => {}): Promise<SettingsSnapshot> {
    const descriptor = this.descriptors.get(id);
    if (!descriptor || (!reset && !validateValue(descriptor, value))) throw new Error('invalid_setting_value');
    // Never overwrite a malformed/unsupported provisioned file with partial data.
    if (this.unreadable) throw new Error(this.error);
    // Read the latest file under the cross-process lock and patch only this key.
    // Authorization is rechecked after lock acquisition, immediately before commit.
    this.values = await settingsTransaction(this.filename, (settings, commit) => {
      guard();
      if (reset) delete settings.values[id]; else settings.values[id] = value;
      commit();
      return settings.values;
    });
    delete this.launchValues[id];
    this.applyErrors.delete(id);
    if (descriptor.apply === 'live') {
      try {
        const desired = this.value(descriptor);
        await this.applyLive(id, desired);
        this.applied.set(id, desired);
      } catch (error) {
        if (this.applied.get(id) !== this.value(descriptor)) this.applyErrors.set(id, `Saved ${id}, but could not apply it: ${String(error)}`);
      }
    }
    this.revision++;
    const snapshot = this.catalog();
    this.changed(snapshot);
    return snapshot;
  }
}
