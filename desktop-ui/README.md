# Upstream frontend code used by the Electron runtime

This directory keeps upstream ares paths so upstream edits, additions and
deletions arrive where our build and reviewers expect them. Its historical name
does not mean this fork builds the upstream desktop application.

- `emulator/` contains the system registry, loaders, firmware, peripheral setup,
  save/media routing and per-system input definitions.
- `input/input.*` contains virtual devices and mapping support. Electron supplies
  physical input; desktop hotkeys, assignment windows and icon helpers are retired.
- `settings/settings.*` contains BML data and bindings used by the native host.
- `desktop-ui.hpp` is the headless runtime's shared header, without Hiro widgets
  or the upstream desktop `Program` global.

The Electron CMake target compiles these sources directly. Electron-specific
execution ownership, services and integration remain under `electron-ui/`;
`electron-ui/native/runtime/runtime.cpp` defines `FrontendRuntime` and applies
palette settings. The native emulation thread owns loading and core mutation;
input updates share the runtime input mutex.

These sources were extracted at `b9f42e052`, then returned to their upstream
paths to reduce merge maintenance. See the
[retirement inventory](../electron-ui/DESKTOP-RETIREMENT.md) for removed features
and the [merge guide](../scripts/UPSTREAM.md) for handling upstream changes.

Preserve upstream paths for upstream-derived code. Do not restore retired GUI
dependencies just to make a merge clean. Review new files in this directory:
some are runtime improvements; others serve only the upstream desktop UI.
Automatic deletion rules deliberately exclude active emulator/input/settings
paths, and must be updated when a subsystem is retired or restored.
