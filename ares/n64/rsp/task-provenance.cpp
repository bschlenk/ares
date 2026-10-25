auto TaskProvenance::started(uint64_t pc) -> void {
  const auto began=std::chrono::steady_clock::now();
  Task task;task.id=nextId++;task.frame=executionCoordinate.frame;task.originCommit=executionCoordinate.originCommit;task.cpuPc=pc;task.rspPc=rsp.ipu.pc;
  for(unsigned n=0;n<64;++n)task.header[n]=rsp.dmem.read<Byte>(0xfc0+n);
  task.logicalId=task.id;if(task.field(1)&1)task.resumeReason="no_observed_yield_restore";
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
auto TaskProvenance::stopped(uint32_t signals,bool architecturalBreak) -> void {
  if(auto* task=find(active);task&&!task->stopped){task->stopped=true;task->stoppedFrame=executionCoordinate.frame;task->signalBits=signals;task->breakObserved=architecturalBreak;task->yieldVerified=architecturalBreak&&(signals&6)==6&&bool(task->yieldBytes);}
}
auto TaskProvenance::knownYieldProfile()const -> bool {
  for(unsigned n=0;n<sizeof(F3dex2DispatchTables);++n)if(rsp.dmem.read<Byte>(0x2f0+n)!=F3dex2DispatchTables[n])return false;
  std::array<uint8_t,4096> code;for(unsigned n=0;n<code.size();++n)code[n]=rsp.imem.read<Byte>(n);
  const auto hash=nall::Hash::SHA256({code.data(),code.size()}).digest();
  for(auto expected:F3dex2ImemHashes)if(hash==expected)return true;
  return false;
}
auto TaskProvenance::resumeEntry() -> void {
  auto* task=find(active);if(!task||!(task->field(1)&1)||!task->restoreBytes||!task->pendingResume||task->resumeEntrySeen)return;
  if(!(rsp.dmem.read<Word>(0xfc4)&1)){task->resumeReason="resume_flag_not_consumed";task->pendingResume=0;return;}
  for(unsigned n=0;n<task->restoreBytes->size();++n)if(rsp.dmem.read<Byte>(n)!=(*task->restoreBytes)[n]){task->resumeReason="restored_dmem_rewritten";task->pendingResume=0;return;}
  task->resumeEntrySeen=true;
}
auto TaskProvenance::yieldDma(bool write,uint64_t taskId,uint32_t dram,uint32_t pbus,uint32_t length,const uint8_t* bytes) -> void {
  auto* task=find(taskId);if(!task)return;
  auto word=[](const auto& data,unsigned offset){return uint32_t(data[offset])<<24|uint32_t(data[offset+1])<<16|uint32_t(data[offset+2])<<8|data[offset+3];};
  if(write&&pbus==0&&length==0xc00&&bytes){
    if(task->field(0)!=1||!knownYieldProfile())return;
    std::array<uint8_t,64> header;for(unsigned n=0;n<header.size();++n)header[n]=rsp.dmem.read<Byte>(0xfc0+n);
    if((word(header,0x38)&0xffffff)!=dram||word(header,0x3c)<0xc00||(word(header,0x10)&0xffffff)!=(word(bytes,0xbfc)&0xffffff))return;
    auto saved=std::make_shared<YieldBytes>();std::copy(bytes,bytes+saved->size(),saved->begin());task->yieldBytes=saved;task->yieldHeader=header;task->yieldAddress=dram;
    task->yieldSha256=nall::Hash::SHA256({saved->data(),saved->size()}).digest().data();task->yieldVerified=task->breakObserved&&(task->signalBits&6)==6;
    if(commandCapture.rspEnabled&&commandCapture.matrices.task==taskId){auto context=std::make_shared<YieldMatrices>();context->base=commandCapture.matrices.base;context->pushes=commandCapture.matrices.pushes;context->vertices=commandCapture.matrices.vertices;task->yieldMatrices=context;}
    return;
  }
  if(write||!(task->field(1)&1))return;
  if(pbus==0&&length==0xc00&&bytes&&(task->field(14)&0xffffff)==dram&&(task->field(6)&0xffffff)==dram&&task->field(7)>=0xc00){
    auto restored=std::make_shared<YieldBytes>();std::copy(bytes,bytes+restored->size(),restored->begin());task->restoreBytes=restored;task->pendingResume=0;
    unsigned matches=0;
    for(auto& prior:tasks){
      if(prior.id==taskId||!prior.yieldVerified||prior.resumedBy||prior.yieldAddress!=dram||!prior.yieldBytes||*prior.yieldBytes!=*restored)continue;
      bool same=prior.field(12)==task->field(12);for(unsigned field:{0,2,3,5,8,9,10,11,13,14,15})if(word(prior.yieldHeader,field*4)!=task->field(field))same=false;
      if((word(*restored,0xbfc)&0xffffff)!=(task->field(4)&0xffffff))same=false;
      if(same){++matches;task->pendingResume=prior.id;}
    }
    if(matches!=1){task->pendingResume=0;task->resumeReason=matches?"ambiguous_yield_context":"no_matching_yield_dma";}else task->resumeReason="awaiting_profiled_command_dma";
  }
  if(pbus==0x920&&length==0xa8&&task->pendingResume&&task->resumeEntrySeen&&task->restoreBytes){
    if(dram!=(word(*task->restoreBytes,0xbf8)&0xffffff)){task->resumeReason="resumed_command_pointer_mismatch";return;}
    if(!knownYieldProfile()){task->resumeReason="unsupported_resume_microcode";return;}
    auto* prior=find(task->pendingResume);if(!prior||prior->resumedBy){task->resumeReason="stale_yield_context";return;}
    task->resumeFrom=prior->id;task->logicalId=prior->logicalId;task->resumeVerified=true;task->resumeReason.clear();prior->resumedBy=task->id;
    if(commandCapture.rspEnabled&&prior->yieldMatrices){auto& matrices=commandCapture.matrices;matrices.unknownCommand();matrices.task=task->id;matrices.base=prior->yieldMatrices->base;matrices.pushes=prior->yieldMatrices->pushes;matrices.vertices=prior->yieldMatrices->vertices;}
  }
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
