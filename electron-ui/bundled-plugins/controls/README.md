# Controller mapping

Bundled, optional API 1 plugin. Open Settings → Input; enable **Controller mapping**
in Plugins for profiles that predate this plugin. Fresh profiles enable it automatically.
Choose a system and a keyboard or connected gamepad. Click a controller hotspot or
binding, then press an input. Map all advances through the controls; Escape cancels,
Backspace/Delete unbinds, and the reset arrow restores the default. Stick directions
capture axes and inversion. Gamepads must return to neutral between assignments.

The plugin owns artwork, coordinates, capture, sequencing and presentation. It
uses only the public SDK, browser keyboard/Gamepad APIs, and `settings.read` /
`settings.write`. No special bundled-plugin identity or host DOM access is needed.
Another plugin can implement an entirely different editor using:

```json
"contributes": {
  "panels": [{"id":"mapping", "title":"My controller editor", "placement":"input-settings"}]
}
```

Register it with `context.ui.registerPanel('mapping', mount)`. Settings → Input
provides an editor selector when multiple plugins contribute. Panel mount signals,
scoped listeners/timers and cleanup follow the same lifecycle as workspace panels.
This placement is a settings surface; `ui.openPanel` applies to workspace panels.
Use `context.settings.catalog/set/reset/changed` for bindings. Input IDs and values
are defined in `settings/input.ts`; no private bridge is required. Closing Input,
switching editors, disabling or reloading disposes the mounted editor. Raw controls
remain under Advanced input settings even with all plugins disabled.

Current backend bindings apply to virtual port 1 and are shared across systems.
Selecting a system changes labels/artwork, not the binding namespace. N64 keyboard
A/B use the existing dedicated overrides; C buttons use the right-stick axes.
This plugin configures the existing input mapper; it does not introduce a plugin
hook into per-frame input execution or additional player ports. Systems without
artwork and unusual peripherals remain configurable through Advanced settings.

Artwork and coordinates come from OpenEmu's SystemPlugins at the revision recorded
in `assets/NOTICE.txt`. `layouts.ts` translates OpenEmu control positions (bottom-left
origin) to percentages (top-left origin), and maps labels to Ares's native virtual
port assignments. A `{0,0}` OpenEmu position means a list-only control. Credits and
redistribution notices are retained in `assets/CREDITS.md` and `assets/NOTICE.txt`.

Run `npm run test:controls` from electron-ui for the Electron integration checks.

The system dropdown includes transparent pixel-art icons extracted from the supplied
sheet. They use 144×144 canvases with the artwork at its original size. See
`assets/systems/README.md` for provenance and extraction instructions.
