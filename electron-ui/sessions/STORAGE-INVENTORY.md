# Native persistent-storage inventory

Task 2 audit of the active loaders and MIA persistence, based on `972498009`.

## Cartridge and system persistence

Each row below names the actual MIA calls. Manifest-driven `load(node, extension)` /
`save(node, extension)` use the memory content/type/architecture to select the VFS
file. The destination is calculated by `Pak::saveLocation`, not a ROM hash.

| Loader | Persistent calls |
| --- | --- |
| `mia/medium/arcade.cpp` | `Pak::load("dips.bml", ".dip");`<br>`Pak::load("dips.bml", ".dip");`<br>`Pak::load("dips.bml", ".dip");`<br>`Pak::save("dips.bml", ".dip");` |
| `mia/medium/atari-2600.cpp` | `Pak::load(name, extension);`<br>`if(board == "Chetiry" \|\| board == "EFF") return Pak::save("save.eeprom", ".eeprom", location);`<br>`if(board == "FA2") return Pak::save("save.flash", ".flash", location);` |
| `mia/medium/bs-memory.cpp` | `Pak::load("program.flash", ".sav");`<br>`Pak::save("program.flash", ".sav");` |
| `mia/medium/famicom-disk-system.cpp` | `Pak::load("disk1.sideA", ".d1a");`<br>`Pak::load("disk1.sideB", ".d1b");`<br>`Pak::load("disk2.sideA", ".d2a");`<br>`Pak::load("disk2.sideB", ".d2b");`<br>`Pak::save("disk1.sideA", ".d1a");`<br>`Pak::save("disk1.sideB", ".d1b");`<br>`Pak::save("disk2.sideA", ".d2a");`<br>`Pak::save("disk2.sideB", ".d2b");` |
| `mia/medium/famicom.cpp` | `Pak::load("program.flash", ".flash");`<br>`Medium::load(node, ".ram");`<br>`Medium::load(node, ".eeprom");`<br>`Medium::load(node, ".chr");`<br>`Medium::save(node, ".ram");`<br>`Medium::save(node, ".eeprom");`<br>`Pak::save("program.flash", ".flash");` |
| `mia/medium/game-boy-advance.cpp` | `Medium::load(node, ".ram");`<br>`Medium::load(node, ".eeprom");`<br>`Medium::load(node, ".flash");`<br>`Medium::load(node, ".rtc");`<br>`Medium::save(node, ".ram");`<br>`Medium::save(node, ".eeprom");`<br>`Medium::save(node, ".flash");`<br>`Medium::save(node, ".rtc");` |
| `mia/medium/game-boy.cpp` | `Medium::load(node, ".ram");`<br>`Medium::load(node, ".eeprom");`<br>`Medium::load(node, ".flash");`<br>`Medium::load(node, ".rtc");`<br>`Medium::save(node, ".ram");`<br>`Medium::save(node, ".eeprom");`<br>`Medium::save(node, ".flash");`<br>`Medium::save(node, ".rtc");` |
| `mia/medium/game-gear.cpp` | `Medium::load(node, ".ram");`<br>`Medium::save(node, ".ram");` |
| `mia/medium/master-system.cpp` | `Medium::load(node, ".ram");`<br>`Medium::save(node, ".ram");` |
| `mia/medium/medium.cpp` | `Pak::save("program.tape", ".sav");` |
| `mia/medium/mega-32x.cpp` | `Pak::load(node, ".ram");`<br>`Pak::load(node, ".eeprom");`<br>`Pak::save(node, ".ram");`<br>`Pak::save(node, ".eeprom");` |
| `mia/medium/mega-drive.cpp` | `Medium::load(node, ".ram");`<br>`Medium::load(node, ".eeprom");`<br>`Medium::save(node, ".ram");`<br>`Medium::save(node, ".eeprom");` |
| `mia/medium/neo-geo-pocket.cpp` | `Pak::load("program.flash", ".sav");`<br>`Pak::save("program.flash", ".sav");` |
| `mia/medium/neo-geo.cpp` | `Pak::save("dips.bml", ".dip");` |
| `mia/medium/nintendo-64.cpp` | `Medium::load(node, ".ram");`<br>`Medium::load(node, ".eeprom");`<br>`Medium::load(node, ".flash");`<br>`Medium::load(node, ".rtc");`<br>`Medium::save(node, ".ram");`<br>`Medium::save(node, ".eeprom");`<br>`Medium::save(node, ".flash");`<br>`Medium::save(node, ".rtc");` |
| `mia/medium/nintendo-64dd.cpp` | `Pak::load("program.disk", ".disk");`<br>`Pak::save("program.disk", ".disk");` |
| `mia/medium/pc-engine.cpp` | `Medium::load(node, ".ram");`<br>`Medium::load(node, ".dram");`<br>`Medium::load(node, ".wram");`<br>`Medium::save(node, ".ram");` |
| `mia/medium/sg-1000.cpp` | `Medium::load(node, ".ram");`<br>`Medium::save(node, ".ram");` |
| `mia/medium/sufami-turbo.cpp` | `Medium::load(node, ".ram");`<br>`Medium::save(node, ".ram");` |
| `mia/medium/super-famicom.cpp` | `Medium::load(node, ".ram");`<br>`Medium::load(node, ".iram");`<br>`Medium::load(node, ".bsx");`<br>`Medium::load(node, ".rtc");`<br>`Medium::load(node, ".dram");`<br>`Medium::save(node, ".ram");`<br>`Medium::save(node, ".iram");`<br>`Medium::save(node, ".bsx");`<br>`Medium::save(node, ".rtc");`<br>`Medium::save(node, ".dram");` |
| `mia/medium/wonderswan.cpp` | `Pak::load("program.flash", ".flash");`<br>`Medium::load(node, ".ram");`<br>`Medium::load(node, ".eeprom");`<br>`Medium::load(node, ".rtc");`<br>`Medium::save(node, ".ram");`<br>`Medium::save(node, ".eeprom");`<br>`Medium::save(node, ".rtc");`<br>`Pak::save("program.flash", ".flash");` |
| `mia/medium/zx-spectrum.cpp` | `return Pak::save("program.tape", ".sav");` |
| `mia/system/atari-2600.cpp` | `Pak::save("savekey.eeprom", ".eeprom");`<br>`Pak::save("atarivox.eeprom", ".eeprom");` |
| `mia/system/mega-cd-32x.cpp` | `Pak::load("backup.ram", ".bram");`<br>`Pak::save("backup.ram", ".bram");` |
| `mia/system/mega-cd.cpp` | `Pak::load("backup.ram", ".bram");`<br>`Pak::save("backup.ram", ".bram");` |
| `mia/system/mega-ld.cpp` | `Pak::load("backup.ram", ".bram");`<br>`Pak::save("backup.ram", ".bram");` |
| `mia/system/msx2.cpp` | `Pak::load("time.rtc", ".rtc");` |
| `mia/system/neo-geo-mvs.cpp` | `Pak::load("time.rtc", ".rtc");`<br>`Pak::save("time.rtc", ".rtc");` |
| `mia/system/neo-geo-pocket-color.cpp` | `Pak::load("cpu.ram", ".cram");`<br>`Pak::load("apu.ram", ".aram");`<br>`Pak::save("cpu.ram", ".cram");`<br>`Pak::save("apu.ram", ".aram");` |
| `mia/system/neo-geo-pocket.cpp` | `Pak::load("cpu.ram", ".cram");`<br>`Pak::load("apu.ram", ".aram");`<br>`Pak::save("cpu.ram", ".cram");`<br>`Pak::save("apu.ram", ".aram");` |
| `mia/system/nintendo-64dd.cpp` | `Pak::load("time.rtc", ".rtc");`<br>`Pak::save("time.rtc", ".rtc");` |
| `mia/system/pc-engine-ld.cpp` | `Pak::load("backup.ram", ".bram");`<br>`Pak::save("backup.ram", ".bram");` |
| `mia/system/pc-engine.cpp` | `Pak::load("backup.ram", ".bram");`<br>`Pak::save("backup.ram", ".bram");` |
| `mia/system/supergrafx.cpp` | `Pak::load("backup.ram", ".bram");`<br>`Pak::save("backup.ram", ".bram");` |
| `mia/system/wonderswan-color.cpp` | `Pak::load("save.eeprom", ".eeprom");`<br>`Pak::save("save.eeprom", ".eeprom");` |
| `mia/system/wonderswan.cpp` | `Pak::load("save.eeprom", ".eeprom");`<br>`Pak::save("save.eeprom", ".eeprom");` |

## Runtime adapters and direct paths

- `desktop-ui/emulator/nintendo-64{,dd}.cpp`: game RAM/EEPROM/RTC, `.pak` controller storage, companion Game Boy transfer cartridge saves, optional DD disk and system RTC. All selected media and peripheral settings must be present during preparation.
- `desktop-ui/emulator/super-famicom.cpp`: companion BS Memory, Sufami Turbo and Super Game Boy media have separate persistent resources.
- `desktop-ui/emulator/playstation.cpp`: per-game `.card`; expansion EEPROM is shared across games at `saves/PlayStation/<device>.eeprom` plus `.firmware`. Both files form one save group. Firmware identity is computed from original firmware.
- `desktop-ui/emulator/emulator.cpp`: direct `load(Pak&, name)` / `save(Pak&, name)` concatenate `node.location` and name. These paths require the same hooks as Pak helpers, even where current consumers use Pak methods.
- `mia/system/atari-2600.cpp`: direct conditional reads for Save Key and AtariVox EEPROM must be inventoried even when files do not exist. Their current configured save root may collapse both names onto one `.eeprom` destination; ownership follows that actual collision. Kid Vid WAV/ZIP assets are read-only firmware.
- `mia/medium/{msx,sc-3000,zx-spectrum}.cpp` and `Tape` in `medium.cpp`: writable WAV source media, converted WAV outputs and pak tapes. Modified-only save branches must be prepared before modification.
- VFS disk handles in MIA (`cd.rom`, `program.tape`, Supercharger streams) are opened with `vfs::read`. Writable cartridge/disk/pak contents are memory-backed and flushed through save helpers. There is no active `vfs::write` disk open in MIA or desktop loaders.
- `mia::import` writes exported/imported pak directories; the Electron host does not call it. Explicit save-state/capture exports are outside in-game persistence.
- Loader `System::locate`, `Emulator::locate`, and host save-root setup currently create directories; preparation must suppress those effects.

All resources in a prepared load are one snapshot/flush group, including companion
media, firmware persistence and peripherals. Future dynamic attachments must fail
closed if their resources were not prepared.

The other active adapters (Atari 5200, ColecoVision, My Vision, Pocket Challenge
V2, Saturn, and read-only CD/LD media) add no direct disk persistence beyond the
shared helpers above. Their save entry points are still wrapped at the runtime
boundary, so adding a persistent helper cannot evade the group barrier.

The implementation routes writable WAV through memory PCM decoding/encoding;
converted TAP/TZX/TSX/CAS/BIT inputs keep their original media decoder and overlay
the persisted WAV output. Original WAV saves use a descriptor for the actual
source filename. Preparation substitutes an empty in-memory tape without reading
that save. All VFS disk handles remain read-only; writable backing remains memory
until a guarded flush. Future dynamic attachment of an unprepared resource fails
closed on its first persistence read/write.
