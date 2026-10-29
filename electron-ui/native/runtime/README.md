# Electron runtime integration

Upstream-derived loaders, input and settings have returned to their original
`desktop-ui/` paths to simplify upstream merges. See
[desktop-ui/README.md](../../../../desktop-ui/README.md) for ownership and scope.

`runtime.cpp` remains here because it defines the Electron-specific
`FrontendRuntime` global and palette integration. The shared headless header is
`desktop-ui/desktop-ui.hpp`. Core mutation/loading stays on the native emulation
thread; input updates share its input mutex. This layout does not restore Hiro,
the desktop application, native hardware polling or GUI timers.
