# Upstream integration notes

Integration of upstream `b6890c9effdf5fa6d6d905533820c8167af466ae` on 2026-10-29,
from common ancestor `9408cb43d4948fc3ea6e152a307a34348df3fe04` (18 upstream
commits). Merge tooling and restoration of upstream source paths were committed
separately before this merge.

## Resolutions

- Retained intentional desktop GUI/CI deletions using the merge script's rules.
  Active emulator/input/settings sources stay at upstream paths.
- Removed both retired genius/Hiro and upstream-obsolete native mame2bml CMake
  entries. Upstream's replacement Python database tooling is retained.
- Kept upstream arcade input construction, per-game input mappings, the System E
  implementation and Neo Geo improvements. MVS now uses Arcade instead of its
  separate loader; saved explicit `Neo Geo MVS` launch selections map to Arcade.
- Combined upstream input dispatch with `FrontendRuntime::inputMutex` and the
  host's single execution owner. Removed desktop `Program::Guard` and assignment
  window calls; retained runtime mapping helpers and their inline `assigned()`.
- Retained settings data/bindings and new per-game helpers, while preserving
  Electron-owned persistence, firmware-key discovery and the removal of Hiro
  settings classes. Normalize parentheses in newly added firmware keys.
- Exposed deinterlacing, PlayStation expansion-device selection and Neo Geo BIOS
  filenames in Electron settings. AES looks for `aes.zip`; MVS uses `neogeo.zip`,
  following upstream's archive location policy in `locateArcadeBios`.
- Kept PlayStation expansion loading, EEPROM persistence and firmware validation
  metadata. Checkpoint compatibility includes expansion type and the original
  firmware hash, rather than mutable saved EEPROM contents.
- Kept both presentation geometry and upstream deinterlacing accessors. Upstream
  now rotates the viewport crop, so geometry reports the actual rotated crop
  used in the video callback. Retained the cleanly merged N64 JIT PC-commit fix
  and this fork's instrumentation.

## Presentation/input backends and menu integration

No emulator core was removed by these resolutions. Ruby's old native window,
video-presentation and hardware-input drivers were retired before this merge;
Electron handles presentation and device input, and SDL handles native audio.
Core rendering code, including N64 paraLLEl-RDP/Vulkan, remains built. These are
different uses of the word "backend"; removing a window driver is not removing
an emulated system or its renderer.

Upstream PlayStation menu code mixes device operations, dialogs and GUI timers.
The runtime expansion feature is retained, but disc-change and cartridge-switch
menu actions still need an Electron-to-native action bridge, tracked in
[issue #34](https://github.com/bschlenk/ares/issues/34). This merge does not
claim that existing deferred desktop-menu behavior is now implemented. A future
bridge should invoke runtime operations on the emulation thread, preserve the
tray-open interval, and update mounted-media/checkpoint identities on disc
changes; avoid directly calling the core from Electron's event thread.

## Validation

On macOS arm64:

- Built all configured cores and `ares-electron-host`, plus
  `ares-electron-cpu-fixture`, in `build_macos/workbench`.
- Configured with `ARES_BUILD_OPTIONAL_TARGETS` both on and off; restored off.
- Built Electron sources and passed 35 targeted tests: merge-script fixtures,
  settings, input mappings, live settings/session/checkpoints, N64/MCP integration,
  rotated-crop geometry and the new upstream integration tests.
- The PlayStation test uses a generated executable, synthetic BIOS and expansion
  image. It checks native startup and EEPROM saving, not real-game accuracy.
- N64/MCP's temporary Unix socket listener required execution outside the
  filesystem sandbox. No private ROM/firmware gameplay, physical-device tests,
  Windows/Linux builds or full Electron acceptance run were performed.

See [scripts/UPSTREAM.md](../scripts/UPSTREAM.md) for the reusable procedure.
