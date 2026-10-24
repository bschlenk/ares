import { decode } from './decode';
export default function ({ args, emu, mem }: any) {
  return { frame: emu.frame, ...decode(mem, args.fields, args.clips) };
}
