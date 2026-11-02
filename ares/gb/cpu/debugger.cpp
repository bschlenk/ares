auto CPU::Debugger::load(Node::Object parent) -> void {
  string origin = Model::SuperGameBoy() ? "SGB" : "CPU";

  memory.wram = parent->append<Node::Debugger::Memory>("CPU WRAM");
  memory.wram->setSize(cpu.wram.size());
  memory.wram->setRead([&](u32 address) -> u8 {
    return cpu.wram[address];
  });
  memory.wram->setWrite([&](u32 address, u8 data) -> void {
    cpu.wram[address] = data;
  });

  memory.hram = parent->append<Node::Debugger::Memory>("CPU HRAM");
  memory.hram->setSize(cpu.hram.size());
  memory.hram->setRead([&](u32 address) -> u8 {
    return cpu.hram[address];
  });
  memory.hram->setWrite([&](u32 address, u8 data) -> void {
    cpu.hram[address] = data;
  });

  // Generic read-only execution evidence, frozen alongside other debugger ranges.
  // Stack reads bypass the CPU bus: only internal WRAM/echo and HRAM are valid.
  // A PC alone is not proof of an application's input handler.
  memory.execution = parent->append<Node::Debugger::Memory>("CPU Execution State");
  memory.execution->setFormat("ares.gb.execution.v1");
  memory.execution->setSize(0xa0);
  memory.execution->setRead([&](u32 address) -> u8 {
    if(address < 4) return "GBEX"[address];
    if(address == 4) return 1;
    if(address == 5) return u8(Model::GameBoyColor()) | (u8(cpu.status.cgbMode) << 1);
    if(address == 6) return u8(cpu.r.ime) | (u8(cpu.r.halt) << 1) | (u8(cpu.r.stop) << 2);
    if(address >= 8 && address < 20) {
      u16 values[] = {cpu.PC, cpu.SP, cpu.r.af.word, cpu.r.bc.word, cpu.r.de.word, cpu.r.hl.word};
      return values[(address - 8) >> 1] >> ((address & 1) * 8);
    }
    if(address == 20) return cpu.status.interruptFlag;
    if(address == 21) return cpu.status.interruptEnable;
    if(address == 22) return cpu.status.interruptLatch;
    if(address == 23) return cpu.status.wramBank;
    if(address >= 0x20 && address < 0xa0) {
      u32 offset = (address - 0x20) % 64;
      u32 source = u32(cpu.SP) + offset;
      bool valid = (source >= 0xc000 && source <= 0xfdff) || (source >= 0xff80 && source <= 0xfffe);
      if(address >= 0x60) return valid;
      if(!valid) return 0;
      if(source >= 0xff80) return cpu.hram[source - 0xff80];
      return cpu.wram[cpu.wramAddress(n13(source))];
    }
    return 0;
  });

  tracer.instruction = parent->append<Node::Debugger::Tracer::Instruction>("Instruction", origin);
  tracer.instruction->setAddressBits(16);

  tracer.interrupt = parent->append<Node::Debugger::Tracer::Notification>("Interrupt", origin);
}

auto CPU::Debugger::instruction() -> void {
  if(tracer.instruction->enabled() && tracer.instruction->address(cpu.PC)) {
    tracer.instruction->notify(cpu.disassembleInstruction(), cpu.disassembleContext());
  }
}

auto CPU::Debugger::interrupt(string_view type) -> void {
  if(tracer.interrupt->enabled()) {
    tracer.interrupt->notify(type);
  }
}
