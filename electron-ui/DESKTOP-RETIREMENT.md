# Desktop frontend retirement inventory

Reviewed against `b9f42e052` (the last checkpoint before extraction), 2026-10-21.
The user approved replacement of the desktop frontend and retaining reference
material in Git. This inventory is a scope disposition, not a claim of feature
parity. Source can be recovered with `git show b9f42e052:desktop-ui/<path>`.

| Desktop implementation | Disposition in the Electron product |
| --- | --- |
| `emulator/` registry, all core-specific constructors/loaders, firmware, region selection, peripheral setup, media/save routing and keyboard mappings | Extracted, now kept at upstream path `../desktop-ui/emulator/`. All 40 compiled variants retain their registry entries. Core options and saved peripheral selection still import from explicit BML configuration. |
| `input/input.*` virtual ports, direct/inherited bindings, digital/analog/relative mapping, trigger ranges and rumble forwarding | Runtime mappings extracted, now kept at upstream path `../desktop-ui/input/`; input mutex and capture flags belong to `FrontendRuntime`. Existing Electron virtual-device defaults stay in the host until task 13. No new physical-device/multiplayer/rumble support is claimed. |
| `settings/settings.*` data model and BML binding process | Extracted without the windows, write-on-load or import/export UI. Profile settings and explicitly selected BML files are read only until task 13 provides owned settings. No migration or implicit import of the desktop user's configuration. |
| `program/utility.cpp` palette application | Extracted as `updatePalette`; screen luminance/saturation/gamma continue to apply after loading. |
| `program/platform.cpp`, drivers and emulator loop | Replaced by the existing host platform, SDL audio, copied video and single execution coordinator. Cores, native services and Ruby remain intact. Desktop event-loop/thread guards were inactive in the Electron host; emulation-thread ownership remains authoritative, with the cross-thread input mutex retained. |
| `emulator/` Hiro menu hooks and disc-insert/tray timers | Retired GUI callbacks. Startup primary/companion media loading remains. Runtime disc/tape changes, per-device menus, orientation/color/phosphor menus and interactive controller-pak switching are deferred UI features; they were not called by Electron. Core settings/device implementations are retained. |
| `presentation/` windows, menus, status, file/system dialogs, scaling and fullscreen | Existing Electron shell handles loading/system choice, status, controls, presentation and plugin docks. Native menus, recent library/start screen, fullscreen/hotkey parity and shader-browser integration are deferred. |
| `game-browser/` arcade metadata/search/list window | Window retired. Registry/category metadata and Arcade/Neo Geo loader/database support retained; a library browser is deferred. |
| `program/states.cpp`, rewind/run-ahead, auto-save timer and hotkeys | Desktop slots/undo UI, rewind, run-ahead and periodic-save policy are deferred. Existing native state services/MCP remain supported with their documented serializer/ownership limits. Shutdown save flushing is preserved; periodic saving is not newly promised. |
| `tools/` memory, trace, properties, graphics, audio streams, cheats, manifest and tape windows | Desktop windows retired. Existing generic memory/debugger plugins and 68 MCP services retain their supported capabilities. Generic graphics/properties/manifest/stream viewers, cheat-file UI and tape controls are deferred, not declared equivalent to N64 tools. |
| `settings/` firmware scan, paths, core/video/audio/input/hotkey editors, home and import/export pages | Task 13 owns real settings and configurable input. Firmware can already be supplied through an explicit settings file. No physical-device/audio-output gate is closed by removing these editors. |
| `resource/`, `desktop-ui.cpp`, desktop CMake/platform launch, icons, font, entitlements and JIT window fixes | Retired with the desktop executable; none is needed by the extracted runtime. Core/MIA embedded firmware resources and media databases remain. Development macOS packaging remains the existing Electron pipeline; public releases/notarization and other OS frontends remain deferred. |
| `.github` desktop build/archive/sign/release workflows, wrappers and `scripts/macos-make-universal.sh` | Retired because their desktop target/artifact paths no longer exist. The fixture-only macOS Electron acceptance lane now replaces the automated frontend checks. No replacement public-release workflow is promised. |
| `hiro/` toolkit | Initially retained for MIA/genius; removed in issue #21 along with those standalone GUIs (see follow-up audit below). |

The extraction is licensed under the repository's ISC license. Loader, mapping
and BML behavior derive from the existing ares frontend at the checkpoint above;
this is relocation and removal of unused UI coupling, not replacement core code.

Resource ownership is explicit: Electron passes the selected native runtime's
resource root with `--resource-dir`; MIA uses a narrow optional resolver callback.
Without that callback, standalone MIA retains its existing resource lookup policy.
The Electron host no longer embeds source-tree paths or falls back to desktop
resources/configuration. Default profile settings are `<profile>/settings.bml`;
`ARES_SETTINGS` remains an explicit read-only override. Native standalone tests
resolve default resources alongside their built/copied runtime.

## Follow-up audit: issue #21

Recovery reference before this cleanup: commit
`1f56ca14f1365955e7ae92d5729d8f41b17556a1`. Future Electron versions of the
MIA import/manifest manager and genius BML database editor are tracked in
[issue #24](https://github.com/bschlenk/ares/issues/24). Their former sources are
`mia/program/`, `tools/genius/` and the standalone entry point in `mia/mia.cpp`.

Removed:

- Standalone MIA/genius GUIs, packaging assets and build targets; Hiro and its
  GTK finder; the unused Qt preset and Hiro maintenance-script references.
- Ruby's Video API, Metal/CGL/GLX/WGL/Direct3D/OpenGL presentation code, Metal debug
  script, librashader headers, shader finders and presentation dependencies.
- Ruby's hardware-input backends (SDL joypads, Quartz/Cocoa, Xlib and Windows Raw
  Input), unused native polling/capture methods, the uninitialized Ruby input
  singleton and the redundant external-input toggle.
- Unused desktop video-driver/window/shader settings and audio/input driver fields.

The active input path was already Electron DOM keyboard/mouse events and the
browser Gamepad API, through IPC/host commands to virtual HID devices. The host
never initialized or polled Ruby's hardware-input backend. Its old rumble calls
also reached only an uninitialized stub; the retained core rumble mapping is
explicitly a no-op until an Electron output transport is implemented. This
cleanup does not change input transport, polling cadence or supported rumble.

Retained code with live consumers:

| Code | Consumer |
| --- | --- |
| Ruby SDL audio | Native host audio playback. Ruby no longer requires native GUI/input frameworks or Objective-C compilation. |
| Runtime input mappings and virtual HID device types | Translate Electron input into per-system core controls, including relative mouse movement. |
| Core graphics backends and MoltenVK | Emulation/rendering, independent of the retired frontend. |
| MIA media library, databases and firmware resources | Media identification/loading, firmware discovery, saves and core options; no standalone GUI entry point remains. |
| Core video settings | Color emulation, overscan, luminance/saturation/gamma and pixel accuracy. |

Historical migration plans and execution logs retain old paths as provenance;
they are not current build dependencies. This cleanup does not implement the
previously deferred frontend features listed above. Source can be retrieved, for
example, with `git show 1f56ca14f1365955e7ae92d5729d8f41b17556a1:tools/genius/genius.cpp`.

Validation on macOS arm64:

- Configured the default all-core Electron build with optional targets both off
  and on; remaining supplemental tools/tests still configure.
- Built `ares-electron-host` with SDL audio as ordinary C++.
- Passed 13 tests across runtime-settings, input-settings, input-clips,
  audio-live, session-live and n64-live. Socket-based integration tests required
  execution outside the sandbox because it denied local Unix socket listeners.
- Passed synthetic 640x480/1080p and Game Boy/Famicom frame-transport smoke checks
  with input echo, pause/resume and SDL dummy-audio playback enabled.
- Checked linked dependencies and Ruby symbols: no Hiro, librashader, native
  video/input backend, Carbon or Metal/MetalKit presentation dependency remains.
  Cocoa remains a separate nall dependency. Physical audio/gamepads and
  Windows/Linux builds were not tested on this machine.

## Upstream layout restoration

Active emulator, input and settings sources now retain their original
`desktop-ui/` paths, with a headless `desktop-ui.hpp` shared header. This reverses
only the organizational relocation; retired GUI code stays retired. Electron
compiles those sources directly. See [desktop-ui/README.md](../desktop-ui/README.md).
