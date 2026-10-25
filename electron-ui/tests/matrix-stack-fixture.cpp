#include <n64/n64.hpp>
#include "../native/matrix-service.hpp"
#include "../native/transform-service.hpp"
#include "../native/task-service.hpp"
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <filesystem>
using namespace ares::Nintendo64;
static void check(bool value,const char* message){if(!value){std::fprintf(stderr,"FAIL %s\n",message);std::exit(1);}}
static std::vector<uint8_t> readFixture(const std::filesystem::path& path){std::ifstream in(path,std::ios::binary);check(bool(in),"fixture file exists");return {std::istreambuf_iterator<char>(in),{}};}
static int32_t fixed(const RspMatrixBytes& raw,unsigned n){return int32_t((uint32_t(raw[n*2])<<24)|(uint32_t(raw[n*2+1])<<16)|(uint32_t(raw[32+n*2])<<8)|raw[33+n*2]);}
int main(int argc,char**argv){
 check(argc==2||argc==3,"fixture directory argument");const std::string yieldMode=argc==3?argv[2]:"";const bool exerciseYield=!yieldMode.empty();const auto code=readFixture(std::filesystem::path(argv[1])/"code.bin"),data=readFixture(std::filesystem::path(argv[1])/"data.bin");
 ares::Platform platform;ares::platform=&platform;auto root=std::make_shared<ares::Core::Object>("Matrix fixture");
 std::vector<uint8_t> hidden(2*1024*1024);rdram.hidden.data=hidden.data();cpu.load(root);cpu.power(false);rdram.ram.allocate(4*1024*1024);rdram.mapIdentity=1;
 #if defined(VULKAN)
 vulkan.enable=true;
 #endif
 for(bool jit:{false,true}){
  rdram.hidden.data=hidden.data();
  rsp.load(root);rsp.power(false);rsp.recompiler.enabled=jit;rdp.load(root);rdp.power(false);rdram.ram.fill();executionCoordinate.reset();taskProvenance.reset(1);commandCapture.reset();
  for(unsigned n=0;n<code.size();++n)rdram.ram.write<Byte>(0x10000+n,code[n],RBusDevice::ARES_DEBUGGER);
  for(unsigned n=0;n<0xf80;++n)rsp.imem.write<Byte>(0x80+n,code[n]);
  for(unsigned n=0;n<data.size();++n)rsp.dmem.write<Byte>(n,data[n]);
  #if defined(VULKAN)
  vulkan.load(root);check(vulkan.implementation!=nullptr,"Vulkan renderer is available");vulkan.frame();
  #endif
  auto word=[](uint32_t address,uint32_t value){rdram.ram.write<Word>(address,value,RBusDevice::ARES_DEBUGGER);};
  auto matrix=[&](uint32_t address,std::array<double,16> values){for(unsigned n=0;n<16;++n){int32_t v=int32_t(values[n]*65536);rdram.ram.write<Half>(address+n*2,uint32_t(v)>>16,RBusDevice::ARES_DEBUGGER);rdram.ram.write<Half>(address+32+n*2,uint32_t(v)&0xffff,RBusDevice::ARES_DEBUGGER);}};
  const std::array<double,16> identity{1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1};
  auto projection=identity;projection[0]=projection[5]=projection[10]=1.0/32;matrix(0x50000,projection);
  auto scale=identity;scale[0]=1.5;scale[5]=-.5;matrix(0x50040,scale);
  auto translation=identity;translation[12]=4.25;translation[13]=-2.5;translation[14]=.125;matrix(0x50080,translation);
  for(unsigned n=0;n<8;++n)rdram.ram.write<Half>(0x500c0+n*2,n==3||n==7?0:n==2||n==6?511:128,RBusDevice::ARES_DEBUGGER);
  for(unsigned v=0;v<3;++v){const int coords[3][3]={{-8,-8,0},{-8,8,0},{8,8,0}};for(unsigned n=0;n<3;++n)rdram.ram.write<Half>(0x500d0+v*16+n*2,coords[v][n],RBusDevice::ARES_DEBUGGER);word(0x500d0+v*16+12,0xffffffff);}
  auto changed=identity;changed[12]=100;matrix(0x50110,changed);auto projScale=identity;projScale[0]=projScale[5]=2;matrix(0x50150,projScale);
  auto roundA=identity,roundB=identity;roundA[0]=roundA[5]=65537.0/65536;roundB[0]=-131071.0/65536;roundB[5]=131071.0/65536;matrix(0x50190,roundA);matrix(0x501d0,roundB);
  auto list=[&](uint32_t address,std::initializer_list<std::pair<uint32_t,uint32_t>> commands){for(auto [a,b]:commands){word(address,a);word(address+4,b);address+=8;}};
  list(0x40000,{{0xff10003f,0x60000},{0xed000000,0x00100100},{0xef000000,0},{0xfcffffff,0xfffe793c},{0xd9000000,0x200004},{0xdb060004,0x50000},{0xdb060008,0x40200},{0xda380007,0x01000000},{0xda380003,0x01000040},{0xda380000,0x01000080},{0xdc080008,0x010000c0},{0xde000000,0x02000000},{0xd8380002,64},{0xda380005,0x01000150},{0xd8380002,64},{0xda380003,0x01000190},{0xda380001,0x010001d0},{0xdf000000,0}});
  list(0x40200,{{0x01003006,0x010000d0},{0xda380003,0x01000110},{0x05000204,0},{0xdf000000,0}});
  uint32_t task[16]={1,0,0,0,0x10000,0x1000,0x11000,uint32_t(data.size()),0x20000,0x800,0x30000,0x34000,0x40000,0,0x70000,0xc00};
  for(unsigned n=0;n<16;++n)rsp.dmem.write<Word>(0xfc0+n*4,task[n]);
  auto pending=translation;pending[12]=99;matrix(0x50080,pending);
  bool updatedOperand=false,updatedSaved=false,requestedYield=false,resumed=false;uint64_t yieldedTask=0,resumedTask=0;
  commandCapture.annotate=[&](CommandCapture::RspRecord& row){
    if(row.opcode==0xda&&row.word1==0x01000080){matrix(0x50080,translation);updatedOperand=true;}
    if(exerciseYield&&!requestedYield&&row.opcode==0xdc){requestedYield=true;rsp.writeWord(0x04040010,1<<10,cpu);}
    if(row.opcode==0xd8&&!updatedSaved){auto changedSaved=scale;changedSaved[0]=2;matrix(0x20000,changedSaved);updatedSaved=true;}
  };
  rsp.ipu.pc=0x80;rsp.branch.setPc(0x80);commandCapture.rspEnabled=true;commandCapture.rdpEnabled=true;rsp.writeWord(0x04040010,1,cpu);
  unsigned count=0;for(;count<1000000;++count){
    if(rsp.status.halted){
      if(!exerciseYield||!requestedYield||resumed)break;
      for(unsigned n=0;n<512&&rsp.dma.busy.any();++n)rsp.dmaTransferStep();
      yieldedTask=taskProvenance.active;const auto* yielded=taskProvenance.find(yieldedTask);
      check(yielded&&yielded->yieldVerified&&yielded->yieldBytes,"real profiled microcode writes and signals its yield context");
      if(yieldMode=="--yield-mutated")rdram.ram.write<Byte>(0x70800,rdram.ram.read<Byte>(0x70800,RBusDevice::ARES_DEBUGGER)^1,RBusDevice::ARES_DEBUGGER);
      for(unsigned n=0;n<0xc00;++n)rsp.dmem.write<Byte>(n,0xa5);
      task[1]=1;task[6]=0x70000;task[7]=0xc00;for(unsigned n=0;n<16;++n)rsp.dmem.write<Word>(0xfc0+n*4,task[n]);
      // Simulate the OS boot transfer with actual SP DMA, then run the same
      // genuine microcode entry. The OS substitutes yield data for ucode_data.
      rsp.writeWord(0x04040000,0x1080,cpu);rsp.writeWord(0x04040004,0x10000,cpu);rsp.writeWord(0x04040008,0xf7f,cpu);
      for(unsigned n=0;n<512&&rsp.dma.busy.any();++n)rsp.dmaTransferStep();
      rsp.ipu.pc=0x80;rsp.branch.setPc(0x80);rsp.writeWord(0x04040010,1|(1<<9)|(1<<11)|(1<<13),cpu);resumedTask=taskProvenance.active;
      rsp.writeWord(0x04040000,0,cpu);rsp.writeWord(0x04040004,0x70000,cpu);rsp.writeWord(0x04040008,0xbff,cpu);
      for(unsigned n=0;n<512&&rsp.dma.busy.any();++n)rsp.dmaTransferStep();
      if(yieldMode=="--yield-entry-mutated")rsp.dmem.write<Byte>(0x800,rsp.dmem.read<Byte>(0x800)^1);
      resumed=true;
    }
    rsp.instruction();rsp.dmaStep(128);
  }
  if(exerciseYield){
    const auto* current=taskProvenance.find(resumedTask);check(resumed&&current,"yield actually resumed");
    check(current->resumeVerified==(yieldMode=="--yield"),"only unmodified consumed yield context is verified");
    if(current->resumeVerified)check(current->resumeFrom==yieldedTask&&current->logicalId==yieldedTask&&taskProvenance.find(yieldedTask)->resumedBy==resumedTask,"verified dispatches retain a logical task chain");
    std::printf("YIELDED_TASK_JSON %s\n",TaskService::execute({std::to_string(yieldedTask)},1,executionCoordinate.frame).json.c_str());
    std::printf("RESUMED_TASK_JSON %s\n",TaskService::execute({std::to_string(resumedTask)},1,executionCoordinate.frame).json.c_str());
  }
  std::fprintf(stderr,"matrix executor=%s instructions=%u pc=%x records=%zu known=%d\n",jit?"jit":"interpreter",count,unsigned(rsp.ipu.pc),commandCapture.rspLive.size(),commandCapture.matrices.known);
  check(rsp.status.halted,"real microcode task finishes");
  check(updatedOperand&&updatedSaved,"just-in-time operand and saved RAM updates execute before actual DMA reads");commandCapture.annotate={};
  unsigned snapshots=0;
  for(auto& row:commandCapture.rspLive)if(!row.overhead){
   if(auto state=row.matrixAfter){++snapshots;std::printf("MATRIX_DEBUG op=%02x w1=%08x id=%llu depth=%zu mv=",row.opcode,row.word1,(unsigned long long)state->id,state->saved.size());for(unsigned n=0;n<16;++n)std::printf("%.6f,",double(fixed(state->modelview,n))/65536);std::printf(" combined=%u vertices=%zu\n",state->combinedValid,row.drawVertices.size());}
  }
  check(snapshots>10,"verified post-operation snapshots exist");
  auto find=[&](uint8_t opcode,uint32_t address){for(auto& row:commandCapture.rspLive)if(row.opcode==opcode&&row.word1==address&&row.matrixAfter)return &row;return (CommandCapture::RspRecord*)nullptr;};
  auto push=find(0xda,0x01000080);check(push&&push->matrixAfter->saved.size()==1&&push->matrixAfter->saved[0].has_value(),"observed push saves the actual pre-operation matrix");
  check(fixed(push->matrixAfter->modelview,12)==417792&&fixed(push->matrixAfter->modelview,13)==81920,"real noncommuting multiply order and negative fractions");
  check(fixed(*push->matrixAfter->saved[0],0)==98304&&fixed(*push->matrixAfter->saved[0],5)==-32768,"saved push bytes are original scale");
  auto pop=find(0xd8,64);check(pop&&pop->matrixAfter->saved.empty()&&pop->matrixAfter->pointer==0x20000&&fixed(pop->matrixAfter->modelview,12)==0&&fixed(pop->matrixAfter->modelview,0)==131072,"pop consumes the changed saved RAM rather than historical push bytes; underflow clamps");
  auto rounded=find(0xda,0x010001d0);check(rounded&&fixed(rounded->matrixAfter->modelview,0)==-131073&&fixed(rounded->matrixAfter->modelview,5)==131072,"real positive and negative 16.16 truncation");
  auto projectionRow=find(0xda,0x01000150);check(projectionRow&&fixed(projectionRow->matrixAfter->projection,0)==4096,"projection multiply has actual RSP post-state");
  for(auto& row:commandCapture.rspLive)if(row.opcode==5){check(row.drawVertices.size()==3&&row.matrixBefore&&fixed(row.matrixBefore->modelview,12)==6553600,"draw observes current changed matrix");for(auto& v:row.drawVertices)check(v.transform&&fixed(v.transform->modelview,12)==417792&&v.transform->combinedValid,"draw vertex retains the matrix actually used before later stack changes");}
  for(unsigned n=0;n<64;++n){rdram.ram.write<Byte>(0x50080+n,0xa5,RBusDevice::ARES_DEBUGGER);rdram.ram.write<Byte>(0x20000+n,0x5a,RBusDevice::ARES_DEBUGGER);}
  check(fixed(push->matrixAfter->modelview,12)==417792&&fixed(*push->matrixAfter->saved[0],0)==98304,"late source and stack RAM rewrites cannot alter frozen snapshots");
  for(auto& row:commandCapture.rspLive)if(row.opcode==5){for(auto& v:row.drawVertices)std::printf("VERTEX_JSON %s\n",MatrixService::vertex(v).c_str());}
  std::printf("RDP_DEBUG count=%zu crashed=%u end=%x current=%x\n",commandCapture.rdpLive.size(),unsigned(rdp.command.crashed),unsigned(rdp.command.end),unsigned(rdp.command.current));
  for(auto& row:commandCapture.rdpLive)std::printf("RDP_OP %02x %016llx\n",row.opcode,(unsigned long long)row.word0);
  vi.io.dramAddress=0x60000;taskProvenance.scanout(executionCoordinate.frame,executionCoordinate.originCommit,0x60000,64,64);commandCapture.afterRun();for(unsigned n=0;n<commandCapture.matrixLatest.size();n+=8)std::printf("STACK_JSON %s\n",MatrixService::execute({"0",std::to_string(n),"8"},1).json.c_str());
  std::printf("TRANSFORM_JSON %s\n",TransformService::execute({"0","0","32"},1,"fixture").json.c_str());
  #if defined(VULKAN)
  vulkan.flush();
  #endif
  ++executionCoordinate.frame;++executionCoordinate.originCommit;taskProvenance.scanout(executionCoordinate.frame,executionCoordinate.originCommit,vi.io.dramAddress,64,64);const auto commandGeneration=commandCapture.generation,previousTransformGeneration=commandCapture.transformGeneration;commandCapture.afterRun();
  check(commandCapture.generation==commandGeneration&&commandCapture.transformGeneration==previousTransformGeneration+1,"repeated origin writes get a new compact VI view without changing the address-swap viewer");
  std::printf("REPEAT_TRANSFORM_JSON %s\n",TransformService::execute({"0","0","32"},1,"fixture").json.c_str());
  unsigned pixels=0;for(unsigned n=0;n<64*64;++n)if(rdram.ram.read<Half>(0x60000+n*2,RBusDevice::ARES_DEBUGGER)&0xfffe)++pixels;
  std::printf("MATRIX_PIXELS %u\n",pixels);
  auto stable=commandCapture.matrixLatest.front();
  auto& tracker=commandCapture.matrices;tracker.pushes.clear();rsp.dmem.write<Word>(0xf4,0x20040);
  auto partial=tracker.snapshot(99999,false);check(partial&&partial->stackValid&&partial->saved.size()==1&&!partial->saved[0],"mid-task unobserved stack frame is explicit, never reread from changed RAM");
  std::printf("PARTIAL_JSON %s\n",MatrixService::state(*partial).c_str());
  rsp.dmem.write<Word>(0xf4,0x20840);auto invalid=tracker.snapshot(100000,false);check(invalid&&!invalid->stackValid,"stack depth beyond 32 is explicit");
  rsp.dmem.write<Word>(0xf4,0x20000);
  for(unsigned n=0;n<600;++n){rsp.dmem.write<Half>(0x18,n);tracker.snapshot(100001+n,false);}
  check(tracker.overflow&&tracker.admitted.size()<=512,"matrix state capture quota is bounded");
  auto table=rsp.dmem.read<Byte>(0x2f0);rsp.dmem.write<Byte>(0x2f0,table^1);
  check(!tracker.snapshot(199999,false)&&!tracker.known,"modified dispatch tables invalidate authoritative layout");
  rsp.dmem.write<Byte>(0x2f0,table);check(tracker.refreshCode(),"matching tables restore profile recognition");
  check(MatrixService::execute({std::to_string(commandCapture.generation+1),"0","4"},1).error=="stale_capture","matrix paging rejects stale generations");
  auto byte=rsp.imem.read<Byte>(0x800);rsp.imem.write<Byte>(0x800,byte^1);tracker.dirty=true;
  check(!tracker.snapshot(200000,false)&&!tracker.known,"one unsupported instruction invalidates authoritative layout");
  check(stable->id==commandCapture.matrixLatest.front()->id,"retained supported snapshots survive later unsupported code");
  check(pixels>20,"real RDP rasterizes the transformed triangle");
  check((rdram.ram.read<Half>(0x60000+(32*64+32)*2,RBusDevice::ARES_DEBUGGER)&0xfffe)==0xfffe,"known interior pixel matches transformed geometry");
  check(rdram.ram.read<Half>(0x60000+(1*64+1)*2,RBusDevice::ARES_DEBUGGER)==0,"outside pixel stays clear");
  auto retainedGeneration=commandCapture.transformGeneration;
  const auto retainedPage=TransformService::execute({std::to_string(retainedGeneration),"0","32"},1,"fixture").json;
  for(unsigned n=0;n<4;++n){vi.io.dramAddress=0x61000+n*0x1000;++executionCoordinate.frame;commandCapture.afterRun();if(n<3)check(TransformService::execute({std::to_string(retainedGeneration),"0","32"},1,"fixture").json==retainedPage,"retained transform pages are immutable while live capture advances");}
  check(TransformService::execute({std::to_string(retainedGeneration),"0","32"},1,"fixture").error=="stale_capture","transform retention evicts beyond four generations");
  commandCapture.transformBatches.clear();
  for(unsigned n=0;n<300;++n){commandCapture.segment={};commandCapture.segment.opcode=0xda;commandCapture.segment.word0=0xda380003;commandCapture.segment.seq=n;commandCapture.segment.taskId=taskProvenance.active;commandCapture.segmentOpen=true;commandCapture.rspFlush(false);}
  check(commandCapture.transformBatches.back().entries.size()==256&&commandCapture.transformBatches.back().observed>=300,"compact transforms have an independent bounded quota");
  vi.io.dramAddress=0x66000;++executionCoordinate.frame;auto* syntheticTask=taskProvenance.find(taskProvenance.active);syntheticTask->stoppedFrame=executionCoordinate.frame;syntheticTask->targets.push_back({0x66000,64,2,executionCoordinate.frame,0,1});taskProvenance.scanout(executionCoordinate.frame,executionCoordinate.originCommit,0x66000,64,64);commandCapture.afterRun();std::printf("TRANSFORM_LIMIT_JSON %s\n",TransformService::execute({"0","0","32"},1,"fixture").json.c_str());
  if(exerciseYield&&yieldMode=="--yield"){
    for(unsigned n=0;n<16;++n)rsp.dmem.write<Word>(0xfc0+n*4,task[n]);
    rsp.ipu.pc=0x80;rsp.branch.setPc(0x80);rsp.writeWord(0x04040010,1|(1<<9)|(1<<11)|(1<<13),cpu);const auto replay=taskProvenance.active;
    rsp.writeWord(0x04040000,0,cpu);rsp.writeWord(0x04040004,0x70000,cpu);rsp.writeWord(0x04040008,0xbff,cpu);for(unsigned n=0;n<512&&rsp.dma.busy.any();++n)rsp.dmaTransferStep();
    check(!taskProvenance.find(replay)->pendingResume&&!taskProvenance.find(replay)->resumeVerified,"a consumed yield context cannot be replayed into a second logical resumption");
    std::printf("REPLAY_TASK_JSON %s\n",TaskService::execute({std::to_string(replay)},1,executionCoordinate.frame).json.c_str());rsp.writeWord(0x04040010,2,cpu);
  }
  #if defined(VULKAN)
  vulkan.unload();
  #endif
  rsp.unload();rdp.unload();
 }
 std::puts("MATRIX_STACK_FIXTURE_PASS");
}
