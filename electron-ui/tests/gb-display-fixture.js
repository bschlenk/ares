import {makeFixture} from '../fixture.cjs';
/** Original display test: striped/scrolled BG, window, one sprite; A disables LCD. */
export function makeDisplayFixture() {
  const rom=makeFixture(),code=[],labels=new Map(),fixups=[];
  const emit=(...b)=>code.push(...b),label=name=>labels.set(name,0x150+code.length);
  const jump=(opcode,name)=>{emit(opcode,0,0);fixups.push([code.length-2,name]);};
  const io=(r,v)=>emit(0x3e,v,0xe0,r),hl=address=>emit(0x21,address&255,address>>8);
  const fill=(address,count,value,name)=>{hl(address);emit(0x01,count&255,count>>8);label(name);emit(0x3e,value,0x22,0x0b,0x78,0xb1);jump(0xc2,name);};
  emit(0xf3,0x31,0xfe,0xff);label('boot');emit(0xf0,0x44,0xfe,144);jump(0xda,'boot');io(0x40,0);
  hl(0x8000);for(let row=0;row<8;row++)emit(0x3e,row%2?0x55:0xaa,0x22,0xaf,0x22);
  for(let row=0;row<8;row++)emit(0xaf,0x22,0x3e,0xff,0x22);
  for(let row=0;row<8;row++)emit(0x3e,0xff,0x22,0x22);
  hl(0x9800);emit(0x01,0,2);label('bg');emit(0xaf,0x22,0x3c,0x22,0x0b,0x78,0xb1);jump(0xc2,'bg');
  fill(0x9c00,1024,1,'window');fill(0xfe00,160,0,'oam');
  hl(0xfe00);for(const v of [48,48,2,0])emit(0x3e,v,0x22);
  io(0x47,0xe4);io(0x48,0xe4);io(0x49,0xe4);io(0x42,11);io(0x43,7);io(0x4a,64);io(0x4b,87);io(0x40,0xf3);
  label('frame');emit(0xf0,0x44,0xfe,144);jump(0xda,'frame');
  io(0,0x10);emit(0xf0,0,0xe6,1);jump(0xc2,'enabled');io(0x40,0);
  label('off');io(0,0x10);emit(0xf0,0,0xe6,1);jump(0xca,'off');io(0x40,0xf3);jump(0xc3,'frame');
  label('enabled');emit(0xf0,0,0xe6,8);jump(0xc2,'ordinary');io(0x43,15);io(0x4a,40);io(0x4b,47);jump(0xc3,'wait');
  label('ordinary');io(0x43,7);io(0x4a,64);io(0x4b,87);
  label('wait');emit(0xf0,0x44,0xfe,144);jump(0xd2,'wait');jump(0xc3,'frame');
  for(const [offset,name] of fixups){const address=labels.get(name);if(address===undefined)throw new Error(name);code[offset]=address&255;code[offset+1]=address>>8;}
  rom.fill(0,0x150);rom.set(code,0x150);return rom;
}
