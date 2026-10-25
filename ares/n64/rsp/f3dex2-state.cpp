// Layout and code identity: matching CC0 F3DEX2 FIFO 2.04H, pinned in the fixture.
// Values are copied from actual post-operation RSP state. No CPU matrix emulator.
#include "f3dex2-profiles.hpp"
bool F3dex2MatrixCapture::refreshCode(){
  if(dirty){
    dirty=false;std::array<uint8_t,4096> bytes;for(unsigned n=0;n<bytes.size();++n)bytes[n]=rsp.imem.read<Byte>(n);
    codeHash=nall::Hash::SHA256({bytes.data(),bytes.size()}).digest().data();codeKnown=false;
    for(auto expected:F3dex2ImemHashes)if(codeHash==expected)codeKnown=true;
  }
  known=codeKnown;
  if(known)for(unsigned n=0;n<sizeof(F3dex2DispatchTables);++n)if(rsp.dmem.read<Byte>(0x2f0+n)!=F3dex2DispatchTables[n]){known=false;break;}
  if(!known)unknownCommand();
  return known;
}
void F3dex2MatrixCapture::taskChanged(){
  if(task==taskProvenance.active)return;
  task=taskProvenance.active;current.reset();pushes.clear();for(auto& v:vertices)v={};
}
auto F3dex2MatrixCapture::admit(std::shared_ptr<const F3dex2MatrixState> value)->std::shared_ptr<const F3dex2MatrixState>{
  if(!value)return {};
  if(!admitted.count(value->id)&&admitted.size()>=MaxStates){overflow=true;return {};}
  admitted.insert(value->id);return value;
}
auto F3dex2MatrixCapture::snapshot(uint64_t command,bool after)->std::shared_ptr<const F3dex2MatrixState>{
  taskChanged();if(!refreshCode()||rsp.dma.busy.read){current.reset();return {};}
  F3dex2MatrixState value;value.codeSha256=codeHash;value.task=task;value.vi=executionCoordinate.frame;value.command=command;value.after=after;
  for(unsigned n=0;n<64;++n){value.modelview[n]=rsp.dmem.read<Byte>(n);value.projection[n]=rsp.dmem.read<Byte>(0x40+n);value.combined[n]=rsp.dmem.read<Byte>(0x80+n);}
  for(unsigned n=0;n<16;++n){value.viewport[n]=rsp.dmem.read<Byte>(0xe0+n);value.segments[n]=rsp.dmem.read<Word>(0xf8+n*4);}
  value.combinedValid=rsp.dmem.read<Byte>(0x1d9)!=0;
  value.base=rsp.dmem.read<Word>(0xfe0);value.pointer=rsp.dmem.read<Word>(0xf4);
  if(base!=value.base){pushes.clear();base=value.base;}
  const uint32_t delta=value.pointer-value.base;
  value.stackValid=value.pointer>=value.base&&!(delta&63)&&delta/64<=MaxStack;
  if(value.stackValid)for(unsigned n=0;n<delta/64;++n){auto it=pushes.find((value.base+n*64)&0xffffff);value.saved.push_back(it==pushes.end()?std::optional<RspMatrixBytes>{}:it->second);}
  if(current&&current->same(value))return admit(current);
  if(admitted.size()>=MaxStates){current.reset();overflow=true;return {};}
  value.id=nextId++;current=std::make_shared<const F3dex2MatrixState>(std::move(value));return admit(current);
}
void F3dex2MatrixCapture::pushed(uint32_t address,const uint8_t* bytes){
  taskChanged();if(!refreshCode())return;
  const uint32_t stackBase=rsp.dmem.read<Word>(0xfe0);
  if(base!=stackBase){pushes.clear();base=stackBase;}
  const uint32_t physical=base&0xffffff;
  if(address<physical||address-physical>=MaxStack*64||((address-physical)&63))return;
  RspMatrixBytes copy;std::copy(bytes,bytes+64,copy.begin());pushes[address]=copy;
}
void F3dex2MatrixCapture::vertexLoaded(uint32_t word0,std::shared_ptr<const F3dex2MatrixState> state){
  const unsigned count=(word0>>12)&0xff,end=(word0>>1)&0x7f;
  if(!count||count>32||end>32||count>end){for(auto& v:vertices)v={};return;}
  for(unsigned n=end-count;n<end;++n){auto& v=vertices[n];v={};v.index=n;v.transform=state;for(unsigned b=0;b<40;++b)v.raw[b]=rsp.dmem.read<Byte>(0x420+n*40+b);}
}
auto F3dex2MatrixCapture::draw(uint32_t word0,uint32_t word1)->std::vector<F3dex2Vertex>{
  std::vector<F3dex2Vertex> result;
  for(unsigned n=0;n<((word0>>24)==5?1u:2u);++n){
    const auto word=n?word1:word0;
    for(unsigned shift:{16,8,0}){
      const unsigned encoded=(word>>shift)&255;if(encoded&1||encoded/2>=32){result.clear();return result;}
      const unsigned index=encoded/2;auto value=vertices[index];value.index=index;value.transform=admit(value.transform);
      for(unsigned b=0;b<40;++b){auto byte=rsp.dmem.read<Byte>(0x420+index*40+b);if(byte!=value.raw[b])value.modified=true;value.raw[b]=byte;}
      result.push_back(std::move(value));
    }
  }
  return result;
}
void F3dex2MatrixCapture::modified(uint32_t word0){const unsigned index=(word0&0xffff)/2;if(index<32)vertices[index].modified=true;}
