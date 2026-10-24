// Project-owned address/type/clip tables are supplied in args, never in the host.
export function decode(mem: any, fields: any[], clips: any[] = []) {
  return Object.fromEntries(fields.map(field => {
    const value = mem[field.type](field.address, field.view ?? 'cpu');
    if (field.clip) {
      const address = Number(value);
      const clip = clips.find(c => address >= Number(c.start) && address < Number(c.end));
      return [field.name, { pointer: address, clip: clip?.name ?? null }];
    }
    return [field.name, typeof value === 'bigint' ? `0x${value.toString(16)}` : value];
  }));
}
