// Real RDP fills through RSP DPC submission, with capture disabled. Address
// candidates deliberately survive full overwrites: they are not pixel ownership.
static void verifyTaskTargets(bool jit){
  commandCapture.rspEnabled=false;commandCapture.rdpEnabled=false;
  taskProvenance.reset(2);executionCoordinate.reset();
  auto pixel=[](uint32_t address){return uint16_t(rdram.ram.read<Half>(address+(32*64+32)*2,RBusDevice::ARES_DEBUGGER));};
  auto submit=[&](uint32_t address,uint16_t color){
    rsp.power(false);rsp.recompiler.enabled=jit;
    const uint32_t program[]={0x34080002,0x40885800,0x34080300,0x40884000,0x34080328,0x40884800,0x0000000d};
    for(unsigned n=0;n<sizeof(program)/4;++n)rsp.imem.write<Word>(n*4,program[n]);
    rsp.dmem.write<Word>(0xfc0,1);rsp.dmem.write<Word>(0xff0,0x90000);
    const uint64_t commands[]={0xff10003f00000000ull|address,0xed00000000100100ull,0xef30000000000000ull,0xf700000000000000ull|(uint64_t(color)<<16)|color,0xf60fc0fc00000000ull};
    for(unsigned n=0;n<5;++n)rsp.dmem.write<Dual>(0x300+n*8,commands[n]);
    rsp.ipu.pc=0;rsp.branch.setPc(0);rsp.writeWord(0x04040010,1,cpu);
    const auto id=taskProvenance.active;
    for(unsigned n=0;n<100&&!rsp.status.halted;++n)rsp.instruction();
    check(rsp.status.halted,"target writer reaches actual BREAK");
    #if defined(VULKAN)
    vulkan.flush();
    #endif
    check(pixel(address)==color,"RDP fill produces expected actual pixel");
    const auto* t=taskProvenance.find(id);check(t&&t->targets.size()==1&&t->targets[0].address==address&&t->targets[0].draws==1,"actual writer has consumed target/draw evidence");
    rsp.dmem.write<Word>(0xff0,0xdeadbeef);check(t->field(12)==0x90000,"late task descriptor writes cannot alter consumed submission");
    return id;
  };
  const auto a=submit(0x80000,0xf801),b=submit(0x82000,0x07c1),c=submit(0x84000,0x003f);
  for(auto address:{0x80000u,0x82000u,0x84000u,0x80000u}){
    ++executionCoordinate.frame;++executionCoordinate.originCommit;
    taskProvenance.scanout(executionCoordinate.frame,executionCoordinate.originCommit,address,64,64);
    const auto expected=address==0x80000?a:address==0x82000?b:c;
    check(taskProvenance.scanouts.back().candidates==std::vector<uint64_t>{expected},"triple/reused buffers select matching dispatch candidate");
  }
  const auto overwrite=submit(0x80000,0xffff);
  taskProvenance.scanout(executionCoordinate.frame,++executionCoordinate.originCommit,0x80000,64,64);
  check(taskProvenance.scanouts.back().candidates==std::vector<uint64_t>({overwrite,a}),"same-frame full overwrite retains multiple candidates instead of claiming old pixels contributed");
  rdram.ram.write<Half>(0x80000+(32*64+32)*2,0x07c1,RBusDevice::ARES_DEBUGGER);
  check(pixel(0x80000)==0x07c1,"CPU-origin write actually changes the displayed source");
  taskProvenance.scanout(executionCoordinate.frame,++executionCoordinate.originCommit,0x80000,64,64);
  auto page=TaskService::execute({},2,executionCoordinate.frame);
  check(page.error.empty()&&page.json.find("address_match_does_not_prove_displayed_pixel_contribution")!=std::string::npos,"CPU pixel rewrite cannot turn candidate matching into authoritative contribution");
  taskProvenance.scanout(executionCoordinate.frame,++executionCoordinate.originCommit,0xa0000,64,64);
  check(taskProvenance.scanouts.back().candidates.empty(),"unobserved target is explicitly unmapped");
  std::printf("TARGETS_JSON %s\n",TaskService::execute({},2,executionCoordinate.frame).json.c_str());
  std::printf("TASK_TARGETS_%s_PASS\n",jit?"JIT":"INTERPRETER");
}
