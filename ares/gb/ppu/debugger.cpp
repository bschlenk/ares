auto PPU::Debugger::load(Node::Object parent) -> void {
  if(ppu.screen) {
    // One generic debugger region can be frozen by a host at Screen::frame().
    // It has no write handler and never uses the CPU bus or advances the core.
    memory.displayState = parent->append<Node::Debugger::Memory>("PPU Display State");
    memory.displayState->setFormat("ares.gb.ppu-display.v1");
    memory.displayState->setSize(0xf700);
    memory.displayState->setRead([&](u32 address) -> u8 {
      if(address < 4) return "GBDS"[address];
      if(address == 4) return 1;
      if(address == 5) return u8(Model::GameBoyColor()) | (u8(cpu.status.cgbMode) << 1);
      if(address == 6) return ppu.status.mode;
      if(address == 7) return ppu.status.displayEnable;
      if(address == 8) return u16(ppu.status.lx);
      if(address == 9) return u16(ppu.status.lx) >> 8;
      if(address == 10) return ppu.status.ly;
      if(address == 11) return ppu.px;
      if(address == 12) return ppu.vram.size();
      if(address == 13) return ppu.vram.size() >> 8;
      if(address == 14) return 160;
      if(address == 16) return 144;
      if(address == 18) return ppu.latch.displayEnable;
      if(address == 19) return ppu.latch.windowDisplayEnable;
      if(address == 20) return ppu.latch.wx;
      if(address == 21) return ppu.latch.wy;
      // CPU-readable register semantics (STAT includes its hardware delay).
      // readIO() is side-effect-free; palette indexes are never incremented.
      if(address >= 0x40 && address < 0x80) return ppu.readIO(2, 0xff00 + address, 0xff);
      if(address >= 0x100 && address < 0x4100) return address - 0x100 < ppu.vram.size() ? u8(ppu.vram[address - 0x100]) : 0;
      if(address >= 0x4100 && address < 0x41a0) return ppu.oam[address - 0x4100];
      if(address >= 0x41a0 && address < 0x41a4) return ppu.bgp[address - 0x41a0];
      if(address >= 0x41a4 && address < 0x41ac) return ppu.obp[address - 0x41a4];
      if(address >= 0x41b0 && address < 0x4230) {
        if(!Model::GameBoyColor()) return 0;
        u32 offset = address - 0x41b0;
        return offset < 64 ? ppu.bgpd[offset >> 1].byte(offset & 1) : ppu.obpd[(offset - 64) >> 1].byte(offset & 1);
      }
      // Raw submitted pixels preserve raster effects which final registers cannot
      // reconstruct. Read at frame submission, before Screen swaps its buffers.
      if(address >= 0x4300 && address < 0xf700 && ppu.screen) {
        u32 offset = address - 0x4300;
        return ppu.screen->pixels()[offset >> 1] >> ((offset & 1) * 8);
      }
      return 0;
    });
  }

  memory.vram = parent->append<Node::Debugger::Memory>("PPU VRAM");
  memory.vram->setSize(ppu.vram.size());
  memory.vram->setRead([&](u32 address) -> u8 {
    return ppu.vram[address];
  });
  memory.vram->setWrite([&](u32 address, u8 data) -> void {
    ppu.vram[address] = data;
  });

  memory.oam = parent->append<Node::Debugger::Memory>("PPU OAM");
  memory.oam->setSize(ppu.oam.size());
  memory.oam->setRead([&](u32 address) -> u8 {
    return ppu.oam[address];
  });
  memory.oam->setWrite([&](u32 address, u8 data) -> void {
    ppu.oam[address] = data;
  });

  memory.bgp = parent->append<Node::Debugger::Memory>("PPU BGP");
  memory.bgp->setSize(ppu.bgp.size());
  memory.bgp->setRead([&](u32 address) -> u8 {
    return ppu.bgp[address];
  });
  memory.bgp->setWrite([&](u32 address, u8 data) -> void {
    ppu.bgp[address] = data;
  });

  memory.obp = parent->append<Node::Debugger::Memory>("PPU OBP");
  memory.obp->setSize(ppu.obp.size());
  memory.obp->setRead([&](u32 address) -> u8 {
    return ppu.obp[address];
  });
  memory.obp->setWrite([&](u32 address, u8 data) -> void {
    ppu.obp[address] = data;
  });

  if(!Model::GameBoyColor()) return;

  memory.bgpd = parent->append<Node::Debugger::Memory>("PPU BGPD");
  memory.bgpd->setSize(ppu.bgpd.size() << 1);
  memory.bgpd->setRead([&](u32 address) -> u8 {
    return ppu.bgpd[address >> 1].byte(address & 1);
  });
  memory.bgpd->setWrite([&](u32 address, u8 data) -> void {
    ppu.bgpd[address >> 1].byte(address & 1) = data;
  });

  memory.obpd = parent->append<Node::Debugger::Memory>("PPU OBPD");
  memory.obpd->setSize(ppu.obpd.size() << 1);
  memory.obpd->setRead([&](u32 address) -> u8 {
    return ppu.obpd[address >> 1].byte(address & 1);
  });
  memory.obpd->setWrite([&](u32 address, u8 data) -> void {
    ppu.obpd[address >> 1].byte(address & 1) = data;
  });
}
