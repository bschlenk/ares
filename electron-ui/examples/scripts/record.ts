import { decode } from './decode';
export default async function ({ args, emu, mem, input, frames }: any) {
  const state = args.state ? await emu.loadState(args.state) : null;
  for (const write of args.setup ?? []) mem.writeHex(write.address, write.hex, write.view ?? 'cpu');
  await frames(args.settle ?? 0);
  const rows = [];
  for (let frame = 0; frame < args.frames; frame++) {
    const state = [...(args.inputs ?? [])].reverse().find(change => change.frame <= frame);
    if (state) input(state.state);
    await frames(1);
    rows.push({ frame: emu.frame, ...decode(mem, args.fields, args.clips) });
  }
  return { metadata: {...emu.info(), state_sha256:state?.state_sha256??null}, rows };
}
