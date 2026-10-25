#include <n64/n64.hpp>
#include "../native/task-service.hpp"
#include "../native/viewer-service.hpp"
#include <cstdio>
#include <cstdlib>
using namespace ares::Nintendo64;
static void check(bool value,const char* name){if(!value){std::fprintf(stderr,"FAIL %s\n",name);std::exit(1);}}
int main(){
  ares::Platform quiet;ares::platform=&quiet;
  auto root=std::make_shared<ares::Core::Object>("Task fixture");
  std::vector<uint8_t> hidden(2*1024*1024);rdram.hidden.data=hidden.data();
  cpu.load(root);cpu.power(false);
  rdram.ram.allocate(4*1024*1024);rdram.ram.fill();rdram.mapIdentity=1;
  for(bool jit:{false,true}){
    rsp.load(root);rsp.power(false);rdp.load(root);rdp.power(false);rsp.recompiler.enabled=jit;
    commandCapture.rspEnabled=false;executionCoordinate.reset();taskProvenance.reset(7);
    const uint32_t code[]={0x34080002,0x40885800,0x34080300,0x40884000,0x34080310,0x40884800,0x34080400,0x40882000,0x0000000d};
    for(unsigned n=0;n<sizeof(code)/4;++n)rsp.imem.write<Word>(n*4,code[n]);
    for(unsigned n=0;n<64;++n)rsp.dmem.write<Byte>(0xfc0+n,0);
    rsp.dmem.write<Word>(0xfc0,1);rsp.dmem.write<Word>(0xff0,0x12345678);rsp.dmem.write<Word>(0xff4,0x80);
    rsp.dmem.write<Dual>(0x300,0xff10013f00002000ull);rsp.dmem.write<Dual>(0x308,0xf600000000000000ull);
    rsp.ipu.pc=0;rsp.branch.setPc(0);rsp.writeWord(0x04040010,1,cpu);
    const auto first=taskProvenance.active;check(first!=0,"SP halt-clear assigns ID");
    check(taskProvenance.find(first)->field(12)==0x12345678,"dispatch descriptor copied");
    rsp.dmem.write<Word>(0xff0,0xdeadbeef);
    // Actual IMEM DMA completion mutates a remote code region while this task lives.
    for(unsigned n=0;n<10;++n){
      rdram.ram.write<Dual>(0x8000,0x0123456789abcdefull+n,RBusDevice::ARES_DEBUGGER);
      rsp.writeWord(0x04040000,0x1f00,cpu);rsp.writeWord(0x04040004,0x8000,cpu);rsp.writeWord(0x04040008,7,cpu);rsp.dmaTransferStep();
    }
    check(taskProvenance.find(first)->code.size()==8&&taskProvenance.find(first)->codeOverflow,"IMEM history bounded with overflow");
    for(unsigned n=0;n<100&&!rsp.status.halted;++n)rsp.instruction();
    if(jit)check(rsp.recompiler.context[0]!=nullptr,"JIT actually emitted the executed block");
    const auto frozen=*taskProvenance.find(first);
    check(rsp.status.halted&&frozen.stopped,"actual RSP break records stop");
    check(frozen.signalBits==1,"yield-relevant signals recorded without inferred resume");
    check(frozen.field(12)==0x12345678,"late descriptor rewrite cannot change snapshot");
    check(frozen.targets.size()==1&&frozen.targets[0].address==0x2000&&frozen.targets[0].draws==1,"consumed RSP-submitted RDP target and draw linked");
    check(!commandCapture.rspEnabled&&rsp.recompiler.enabled==jit&&!rsp.debugControl.active,"capture does not acquire interpreter gate");
    taskProvenance.scanout(1,5,0x2000);check(taskProvenance.scanouts.back().candidates==std::vector<uint64_t>{first},"scanout records address candidate");
    auto result=TaskService::execute({},7,1);check(result.error.empty()&&result.json.find("candidate_only")!=std::string::npos,"service labels mapping non-authoritative");
    std::printf("TASK_JSON %s\n",result.json.c_str());
    rsp.dmem.write<Word>(0xff0,0x12345678);rsp.ipu.pc=0;rsp.branch.setPc(0);rsp.writeWord(0x04040010,1,cpu);
    const auto repeated=taskProvenance.active;check(repeated!=first&&taskProvenance.find(repeated)->previousDescriptor==first,"identical descriptor gets distinct dispatch with identity link");
    for(unsigned n=0;n<70;++n){rsp.writeWord(0x04040010,2,cpu);rsp.writeWord(0x04040010,1,cpu);}
    check(taskProvenance.tasks.size()==64&&taskProvenance.dropped>0,"task retention bounded");check(TaskService::execute({std::to_string(first)},7,1).error=="stale_task","evicted task is explicit");
    const auto old=taskProvenance.active;taskProvenance.reset(8);rsp.writeWord(0x04040010,2,cpu);rsp.writeWord(0x04040010,1,cpu);check(taskProvenance.active>old,"reset cannot alias IDs retained in renderer queues");
    check(TaskService::execute({std::to_string(old)},8,0).error=="stale_task","reset invalidates retained task");
    std::printf("TASK_PROVENANCE_%s_PASS max_ns=%llu\n",jit?"JIT":"INTERPRETER",(unsigned long long)taskProvenance.maxNs);
    // Original signature-compatible dispatch/DMA program. This verifies the
    // consumed-input hook, not Nintendo microcode's matrix arithmetic.
    rsp.power(false);rsp.recompiler.enabled=jit;taskProvenance.reset(9);executionCoordinate.reset();
    auto instruction=[&](uint32_t address,uint32_t word){rsp.imem.write<Word>(address,word);};
    instruction(0x14,0x8c190000);instruction(0x18,0x8c180004);instruction(0x1c,0);
    instruction(0x20,0x00196603);instruction(0x24,0x000c5840);instruction(0x28,0x24080060);instruction(0x2c,0);instruction(0x30,0);instruction(0x34,0x01000008);instruction(0x38,0);
    const uint32_t handler[]={0x34090100,0x40890000,0x34098000,0x40890800,0x3409003f,0x40891000,0x400a3000,0x1540fffe,0,0x0000000d};
    for(unsigned n=0;n<sizeof(handler)/4;++n)instruction(0x60+n*4,handler[n]);
    std::array<uint8_t,64> expected;for(unsigned n=0;n<64;++n){expected[n]=n;rdram.ram.write<Byte>(0x8000+n,n,RBusDevice::ARES_DEBUGGER);}
    rsp.dmem.write<Word>(0,0xda000001);rsp.dmem.write<Word>(4,0x01008000);rsp.ipu.pc=0x14;rsp.branch.setPc(0x14);
    // Real boot ordering: dispatch begins before the graphics code is DMA-loaded.
    for(unsigned n=0;n<256;++n)rdram.ram.write<Byte>(0x9000+n,rsp.imem.read<Byte>(n),RBusDevice::ARES_DEBUGGER);
    rsp.imem.fill();
    ViewerService viewer;check(viewer.execute("n64.capture.control",{"1","0"},"matrix",9,true,false).error.empty(),"matrix capture explicitly enabled");
    check(commandCapture.sigPc<0,"boot code has no graphics dispatch signature");
    rsp.writeWord(0x04040010,1,cpu);
    auto codeDma=[&](uint32_t source,uint32_t target,uint32_t length){
      rsp.writeWord(0x04040000,0x1000|target,cpu);rsp.writeWord(0x04040004,source,cpu);rsp.writeWord(0x04040008,length-1,cpu);
      for(unsigned n=0;n<512&&rsp.dma.busy.any();++n)rsp.dmaTransferStep();
      check(!rsp.dma.busy.any(),"code DMA finishes");
    };
    codeDma(0x9000,0,256);check(commandCapture.matrixSignatureSupported(),"late IMEM DMA discovers graphics microcode");
    bool preservedOverlay=false;
    for(unsigned n=0;n<1000&&!rsp.status.halted;++n){
      if(!preservedOverlay&&commandCapture.wantsMatrixOperand()&&!rsp.dma.busy.any()){
        rdram.ram.write<Dual>(0x9800,0,RBusDevice::ARES_DEBUGGER);codeDma(0x9800,0x300,8);
        check(commandCapture.wantsMatrixOperand(),"handler overlay preserves current command when dispatch remains valid");preservedOverlay=true;
      }
      const auto beforeCycles=rsp.pipeline.clocksTotal;
      rsp.instruction();rsp.dmaStep(128);
      check(uint32_t(rsp.pipeline.clocksTotal-beforeCycles)<10000,"reused JIT blocks preserve the live elapsed clock");
    }
    check(preservedOverlay,"both executors exercised a mid-command handler overlay");
    auto& capture=commandCapture;auto matrix=std::find_if(capture.rspLive.begin(),capture.rspLive.end(),[](auto& record){return record.matrixCandidate;});
    check(rsp.status.halted&&matrix!=capture.rspLive.end(),"signature-gated matrix dispatch captured");
    check(matrix->matrixDmaCount==1&&matrix->matrixOperand==expected&&matrix->matrixDram==0x8000&&matrix->matrixDmem==0x100,"exact consumed DMA bytes and resolved addresses");
    for(unsigned n=0;n<64;++n){rdram.ram.write<Byte>(0x8000+n,0xff,RBusDevice::ARES_DEBUGGER);rsp.dmem.write<Byte>(0x100+n,0xee);}
    check(matrix->matrixOperand==expected,"later source and DMEM rewrites do not alter consumed input");
    vi.io.dramAddress=0x9000;capture.afterRun();auto page=viewer.execute("n64.capture.rsp",{"0","0","64"},"matrix",9,true,false);check(page.error.empty(),"matrix capture pages bounded native records");std::printf("MATRIX_JSON %s\n",page.json.c_str());
    instruction(0x20,0);capture.detectRsp();check(!capture.matrixSignatureSupported(),"unsupported microcode disables operand gate");viewer.reset();
    rsp.unload();rdp.unload();
  }
  TaskProvenance candidates;
  for(unsigned n=1;n<=12;++n){TaskProvenance::Task t;t.id=n;t.targets.push_back({0x1000,320,2,0,0,1});candidates.tasks.push_back(t);}
  candidates.scanout(1,1,0x1280,320,240);
  check(candidates.scanouts.back().candidates.size()==8&&candidates.scanouts.back().candidates.front()==12&&candidates.scanouts.back().overflow,"scanout range handles a skipped source scanline and retains newest candidate tasks");
  candidates.scanout(2,2,0x1280,640,240);check(candidates.scanouts.back().candidates.empty(),"incompatible VI width does not infer a source range");
  candidates.scanout(3,3,0x1000+320*2*240,320,240);check(candidates.scanouts.back().candidates.empty(),"source range bound is exclusive");
  candidates.scanout(4,4,0x1000,0,0);check(!candidates.scanouts.back().candidates.empty(),"exact address remains a candidate without geometry");
  return 0;
}
