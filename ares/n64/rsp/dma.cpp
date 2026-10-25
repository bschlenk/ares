auto RSP::dmaQueue(u32 clocks, Thread& thread) -> void {
  dma.clock = (Thread::clock - thread.clock) - clocks;
}

auto RSP::dmaStep(u32 clocks) -> void {
  if(debugControl.active) {
    // A slow gated interpreter must not strand the SP_DMA_FULL wait loop.
    // Two queue slots, at most 256 rows each: finite synchronous debug progress.
    if(!dma.busy.any() && dma.full.any()) dmaTransferStart(*this);
    for(unsigned rows = 0; dma.busy.any() && rows < 512; ++rows) dmaTransferStep();
    return;
  }
  if(dma.busy.any()) {
    dma.clock += clocks;
    if(dma.clock >= 0) {
      dmaTransferStep();
    }
  }
}

auto RSP::dmaTransferStart(Thread& thread) -> void {
  if(dma.busy.any()) return;
  if(dma.full.any()) {
    dma.current = dma.pending;
    taskProvenance.dmaCurrentTask=taskProvenance.dmaPendingTask;
    dma.busy    = dma.full;
    dma.full    = {0,0};
    dmaQueue((dma.current.length+8) / 8 * 3, thread);
  }
}

auto RSP::dmaTransferStep() -> void {
  if(dma.busy.read) {
    const uint32_t provenanceDram=dma.current.dramAddress,provenancePbus=dma.current.pbusAddress;
    const bool restoreYield=!dma.current.pbusRegion&&provenancePbus==0&&dma.current.length+8==0xc00&&dma.current.count==0;std::vector<uint8_t> restoredYield;if(restoreYield)restoredYield.resize(0xc00);
    const bool captureMatrix=!dma.current.pbusRegion&&dma.current.length+8==64&&dma.current.count==0&&commandCapture.wantsMatrixOperand();uint8_t consumedMatrix[64];
    commandCapture.rspDma(dma.current.length + 8, false);
    if constexpr(Accuracy::RSP::Recompiler) {
      if(dma.current.pbusRegion) {
        recompiler.invalidate(dma.current.pbusAddress, dma.current.length + 8);
      }
    }
    for(u32 i = 0; i <= dma.current.length; i += 8) {
      if(dma.current.pbusRegion) {
        u64 data = rdram.ram.read<Dual>(dma.current.dramAddress, RBusDevice::SP_DMA);
        imem.write<Dual>(dma.current.pbusAddress, data);
      } else {
        u32 dataLo = rdram.ram.read<Word>(dma.current.dramAddress + 0, RBusDevice::SP_DMA);
        u32 dataHi = rdram.ram.read<Word>(dma.current.dramAddress + 4, RBusDevice::SP_DMA);
        if(restoreYield)for(unsigned b=0;b<4;++b){restoredYield[uint32_t(i)+b]=dataLo>>(24-b*8);restoredYield[uint32_t(i)+4+b]=dataHi>>(24-b*8);}
        if(captureMatrix)for(unsigned b=0;b<4;++b){consumedMatrix[uint32_t(i)+b]=dataLo>>(24-b*8);consumedMatrix[uint32_t(i)+4+b]=dataHi>>(24-b*8);}
        dmem.write<Word>(dma.current.pbusAddress + 0, dataLo);
        dmem.write<Word>(dma.current.pbusAddress + 4, dataHi);
      }
      if(system.homebrewMode) {
        rsp.debugger.dmaReadWord(dma.current.dramAddress, dma.current.pbusRegion, dma.current.pbusAddress);
      }
      dma.current.dramAddress += 8;
      dma.current.pbusAddress += 8;
    }
    if(!dma.current.pbusRegion&&dma.current.count==0&&(restoreYield||(provenancePbus==0x920&&dma.current.length+8==0xa8)))taskProvenance.yieldDma(false,taskProvenance.dmaCurrentTask,provenanceDram,provenancePbus,dma.current.length+8,restoreYield?restoredYield.data():nullptr);
    if(captureMatrix)commandCapture.rspMatrixOperand(provenanceDram,provenancePbus,consumedMatrix);
    if(dma.current.pbusRegion){
      taskProvenance.imemDma(provenanceDram,provenancePbus,dma.current.length+8);
      commandCapture.rspCodeChanged();
    }
  }
  if(dma.busy.write) {
    const uint32_t stackDram=dma.current.dramAddress;
    const bool saveYield=!dma.current.pbusRegion&&dma.current.pbusAddress==0&&dma.current.length+8==0xc00&&dma.current.count==0;std::vector<uint8_t> savedYield;if(saveYield)savedYield.resize(0xc00);
    const bool stackWrite=!dma.current.pbusRegion&&dma.current.pbusAddress==0&&dma.current.length+8==64&&dma.current.count==0&&commandCapture.rspEnabled&&commandCapture.matrices.refreshCode();
    uint8_t stackBytes[64];
    commandCapture.rspDma(dma.current.length + 8, true);
    for(u32 i = 0; i <= dma.current.length; i += 8) {
      if(dma.current.pbusRegion) {
        u64 data = imem.read<Dual>(dma.current.pbusAddress);
        rdram.ram.write<Dual>(dma.current.dramAddress, data, RBusDevice::SP_DMA);
      } else {
        u32 dataLo = dmem.read<Word>(dma.current.pbusAddress + 0);
        u32 dataHi = dmem.read<Word>(dma.current.pbusAddress + 4);
        if(saveYield)for(unsigned b=0;b<4;++b){savedYield[uint32_t(i)+b]=dataLo>>(24-b*8);savedYield[uint32_t(i)+4+b]=dataHi>>(24-b*8);}
        if(stackWrite)for(unsigned b=0;b<4;++b){stackBytes[uint32_t(i)+b]=dataLo>>(24-b*8);stackBytes[uint32_t(i)+4+b]=dataHi>>(24-b*8);}
        rdram.ram.write<Word>(dma.current.dramAddress + 0, dataLo, RBusDevice::SP_DMA);
        rdram.ram.write<Word>(dma.current.dramAddress + 4, dataHi, RBusDevice::SP_DMA);
      }
      dma.current.dramAddress += 8;
      dma.current.pbusAddress += 8;
    }
    if(saveYield)taskProvenance.yieldDma(true,taskProvenance.dmaCurrentTask,stackDram,0,0xc00,savedYield.data());
    if(stackWrite)commandCapture.matrices.pushed(stackDram,stackBytes);
  }

  if(dma.current.count) {
    dma.current.count -= 1;
    dma.current.dramAddress += dma.current.skip;
    dmaQueue((dma.current.length+8) / 8 * 3, *this);
  } else {
    dma.busy = {0,0};
    dma.current.length = 0xFF8;
    dmaTransferStart(*this);
  }
}
