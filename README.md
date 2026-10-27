<img src="ares/ares/resource/logo@2x.png" width="350"/>

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

**ares** is a multi-system emulator that began development on October 14th, 2004.
It is a descendant of [higan](https://github.com/higan-emu/higan) and [bsnes](https://github.com/bsnes-emu/bsnes/), and focuses on accuracy and preservation.

It's worth noting that ares takes some uncommon design approaches that essentially trade speed for code clarity. We avoid state machines and bitmasks (when possible). Most cores end up being half the amount of code, but slower. The code is clearer and less spaghettified, especially for systems with lots of processors. C bitfields being non-portable incurs a speedhit. Windows also has a speedhit over Linux due to its ABI needing more instructions to switch contexts.

The Electron frontend lives in [electron-ui/](electron-ui/README.md).
For ongoing frontend work, start with [the handoff](electron-ui/RESUME.md).

Official Releases
-----------------

Official releases are available from
[the ares website](https://ares-emu.net).

Nightly Builds
--------------

Automated, untested builds of ares are available for Windows and macOS as a [pre-release](https://github.com/ares-emulator/ares/releases/tag/nightly). 
Only the latest nightly build is kept.

Building this fork
------------------

This fork uses [Ares Workbench's Electron frontend](electron-ui/README.md).
On macOS Apple Silicon, build a runnable app from the repository root:

```sh
./scripts/build-macos-app.sh
open build_macos/Ares.app
```

The command builds the native host and UI, installs npm dependencies if missing,
and packages a self-contained app. It replaces the previous output only after
packaging and signing succeed. `ARES_BUILD_JOBS` controls parallelism (default 8);
`ARES_NATIVE_BUILD_DIR` can reuse another native build directory. The default
native build directory is `build_macos/workbench`. This is an ad-hoc-signed local
app; release notarization remains separate.

For UI development, run `npm run dev` (or `pnpm run dev`) from the repository root. It uses the
existing native build, watches frontend sources, and reloads the interface after
successful builds while keeping the emulator session running. Run `npm run build:mac`
once first if the native host is missing. Main-process/preload changes require
restarting the development command; C++ changes require rebuilding the native host.
`npm start` launches without watching, `npm run build` compiles the frontend,
and `npm test` runs frontend/service tests. `npm run package:mac -- /path/to/Ares.app`
packages an existing native build into a fresh destination; `npm run build:mac`
does the complete build and safely replaces `build_macos/Ares.app`.

Enable access in **Settings → Agent Integration → Enable MCP and CLI access**,
then copy the MCP configuration. Recording N64 DMA provenance is a separate,
default-off live setting. CLI helpers can be installed from the packaged app.

The native host is the default CMake frontend target; emulation remains native
C++. Build/run instructions, tested macOS arm64 prerequisites, isolated profiles
and development/package checks are in that README. For ongoing implementation,
start with [the handoff](electron-ui/RESUME.md).

The superseded desktop frontend has been retired after extracting its loaders,
firmware, save routing, input and configuration support. The
[retirement inventory](electron-ui/DESKTOP-RETIREMENT.md) records preserved
behavior and deferred desktop features. Windows/Linux frontend distribution and
public-release packaging remain separate projects. Release links above describe
upstream ares, not releases of this fork's Electron frontend.

High-level Components
---------------------

* __ares__:       emulator cores and component implementations
* __electron-ui__: Electron frontend, native host, tools and shared services
* __nall__:       Near's alternative to the C++ standard library
* __ruby__:       SDL audio output for the native host
* __mia__:        internal ROM database and ROM/image loader
* __libco__:      cooperative multithreading library

Contributing
------------

Please join our discord to chat with other ares developers: https://discord.com/invite/gz2quhk2kv
