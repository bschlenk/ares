auto TaskProvenance::started(uint64_t pc) -> void {
  const auto began=std::chrono::steady_clock::now();
  Task task;task.id=nextId++;task.frame=executionCoordinate.frame;task.originCommit=executionCoordinate.originCommit;task.cpuPc=pc;task.rspPc=rsp.ipu.pc;
  for(unsigned n=0;n<64;++n)task.header[n]=rsp.dmem.read<Byte>(0xfc0+n);
  uint8_t code[4096];for(unsigned n=0;n<4096;++n)code[n]=rsp.imem.read<Byte>(n);
  task.bootHash=XXH64(code,sizeof(code),0);
  // Repeated/yielded submissions retain distinct IDs. This link is byte identity,
  // not an assertion that the OS resumed the same logical task.
  for(auto it=tasks.rbegin();it!=tasks.rend();++it)if(it->header==task.header){task.previousDescriptor=it->id;break;}
  if(tasks.size()==MaxTasks){tasks.erase(tasks.begin());++dropped;}
  active=task.id;tasks.push_back(std::move(task));
  const auto ns=std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now()-began).count();totalNs+=ns;maxNs=std::max<uint64_t>(maxNs,ns);++captures;
}
auto TaskProvenance::imemDma(uint32_t dram,uint32_t pbus,uint32_t bytes) -> void {
  auto* task=find(active);if(!task||task->stopped)return;
  if(task->code.size()==MaxCode){task->codeOverflow=true;return;}
  const auto began=std::chrono::steady_clock::now();
  uint8_t code[4096];for(unsigned n=0;n<4096;++n)code[n]=rsp.imem.read<Byte>(n);
  task->code.push_back({nextCode++,XXH64(code,sizeof(code),0),executionCoordinate.frame,dram,pbus,bytes});
  const auto ns=std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now()-began).count();totalNs+=ns;maxNs=std::max<uint64_t>(maxNs,ns);++captures;
}
auto TaskProvenance::stopped(uint32_t signals) -> void {
  if(auto* task=find(active)){task->stopped=true;task->stoppedFrame=executionCoordinate.frame;task->signalBits=signals;}
}
auto TaskProvenance::consume(uint8_t opcode,uint64_t word,uint64_t taskId) -> void {
  if(opcode==0x3f){colorAddress=uint32_t(word)&0x3ffffff;colorWidth=((word>>32)&0x3ff)+1;colorDepth=(word>>51)&3;haveColor=true;}
  if(!haveColor)return;
  if(opcode!=0x3f&&opcode!=0x36&&opcode!=0x24&&opcode!=0x25&&(opcode<8||opcode>15))return;
  auto* task=find(taskId);if(!task)return;
  auto found=std::find_if(task->targets.begin(),task->targets.end(),[&](auto& target){return target.address==colorAddress&&target.width==colorWidth&&target.depth==colorDepth;});
  if(found==task->targets.end()){
    if(task->targets.size()==MaxTargets){task->targetOverflow=true;return;}
    task->targets.push_back({colorAddress,colorWidth,colorDepth,executionCoordinate.frame,executionCoordinate.originCommit,0});found=task->targets.end()-1;
  }
  if(opcode!=0x3f)++found->draws;
}
