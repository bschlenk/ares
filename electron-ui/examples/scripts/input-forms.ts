// Both spellings replace a whole port and are latched at the next VI.
export default async function ({input, frames, emu}: any) {
  input({port:1,right:true,x:20,y:0});
  await frames(1);
  const first=emu.info();
  input.set(1,{left:true},{x:-20,y:0});
  await frames(1);
  input.set(1,{});
  await frames(1);
  return {first,last:emu.info()};
}
