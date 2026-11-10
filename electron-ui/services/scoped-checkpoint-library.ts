import {CheckpointLibrary, type CheckpointGame, type CheckpointEntry} from './checkpoint-library.js';

import type {ScopedCheckpointEntry} from './checkpoint-contracts.js';
/** Source qualification is enforced here, never inferred from timestamp IDs. */
export class ScopedCheckpointLibrary {
  constructor(private local: CheckpointLibrary, private personal?: CheckpointLibrary) {}
  private qualify(entry: CheckpointEntry, inherited = false): ScopedCheckpointEntry {
    const origin = inherited || !this.personal ? 'personal' : 'session';
    const reference = `${origin}:${entry.id}`;
    return {...entry, id: reference, reference, origin, writable: !inherited};
  }
  private source(reference: string, write = false) {
    const match = /^(personal|session):(.+)$/.exec(reference);
    if (!match) throw new Error('invalid_checkpoint_reference');
    const inherited = !!this.personal && match[1] === 'personal';
    if (write && inherited) throw new Error('inherited_checkpoint_read_only');
    if (!this.personal && match[1] !== 'personal') throw new Error('invalid_checkpoint_reference');
    return {library: inherited ? this.personal! : this.local, id: match[2]!};
  }
  async list(game: CheckpointGame, screenshots = false): Promise<ScopedCheckpointEntry[]> {
    const local = (await this.local.list(game, screenshots)).map(entry => this.qualify(entry));
    const personal = this.personal ? (await this.personal.list(game, screenshots)).map(entry => this.qualify(entry, true)) : [];
    return [...local, ...personal];
  }
  async publish(...args: Parameters<CheckpointLibrary['publish']>) { return this.qualify(await this.local.publish(...args)); }
  read(game: CheckpointGame, reference: string) { const {library,id} = this.source(reference); return library.read(game,id); }
  rename(game: CheckpointGame, reference: string, name: string) { const {library,id} = this.source(reference,true); return library.rename(game,id,name); }
  delete(game: CheckpointGame, reference: string) { const {library,id} = this.source(reference,true); return library.delete(game,id); }
  revealPath(game: CheckpointGame, reference: string) { const {library,id} = this.source(reference); return library.revealPath(game,id); }
}
