# Profile settings

The main process owns `<profile>/preferences.json`. You can provision this file
before launching Ares Workbench:

```json
{
  "version": 1,
  "values": {
    "presentation.theme": "green",
    "presentation.scale": "integer"
  }
}
```

Presentation preferences, the imported BML selection (`paths.importBml`) and
firmware paths for all compiled systems currently use the service. Open **Settings** with Cmd+, and use **General** or **Firmware** to edit a path or choose a
file. Save persists immediately; pending changes apply on the next ROM load.
Reset removes the profile override and restores the imported value or default.
The running game is never restarted by a settings edit.

Firmware descriptors come from the native emulator registry. For example, a
provisioned GBA firmware override is:

```json
{
  "version": 1,
  "values": {
    "firmware.GameBoyAdvance.BIOS.World": "/absolute/path/to/boot.rom"
  }
}
```

Precedence is explicit launch override, profile value, imported BML, then default.
`ARES_SETTINGS` overrides the saved import-file selection for the current launch
without rewriting the profile; explicitly choosing another file saves the new
selection. Native overrides are written to a separate immutable launch snapshot
under `<profile>/runtime-settings/` and removed after host acknowledgement or
exit. Imported BML is never rewritten. Missing/invalid firmware is reported by
the existing loader when a ROM is opened. No firmware is downloaded.

Audio volume/mute and video luminance/saturation/gamma apply live. Native
acknowledgement determines applied state; during controlled execution a change
is saved and reported as pending rather than interrupting or replaying the run.
Save again when idle, or load the next ROM. Speaker mute keeps audio pacing;
debugger PCM capture remains before speaker mute but reflects the volume control.

Supported loader options are available under Core and system sections and apply
on the next ROM load. GPU quality/supersampling controls appear only when the
native host reports GPU support. The old forced boot, quality, supersampling and
interpreter overrides have been removed; fast boot remains the default.

Input settings configure the frontend's virtual port 1. Keyboard values use
browser key codes (for example `KeyZ` or `ArrowUp`), optionally up to four codes
separated by commas. An empty value unbinds the control. Record key captures one
code; Save persists it. The Nintendo 64 A/B keyboard overrides preserve the old
N64 defaults while allowing separate customization.

Gamepads support the first standard device or an explicit browser device index,
button/axis indices (`-1` disables), axis inversion, deadzone and app/canvas focus.
Mapping changes clear held keyboard/native input before the next poll. Default
bindings match the previous frontend. Imported native direct-keyboard/peripheral
bindings remain separate and read-only. Physical hardware acceptance remains a
manual gate; virtual mapping tests are not a physical keyboard/gamepad pass.

The bundled Settings plugin uses the same scoped SDK and shared form as local
plugins. Fresh profiles enable it; existing profiles can enable it in Plugins.
Local plugins declare/register sections and retain their values in this profile
file under `plugin:<plugin ID>:<section>:<field>`. See
[plugin settings API](plugins/README.md#profile-settings-contributions). The temporary side checkbox and dock-position settings have been removed.
Workspace layout lives in a separate provisionable [workspace.json](WORKSPACE.md).

Settings are profile scoped. Defaults, types, validation, UI grouping and apply
timing are defined in `settings/builtins.ts`, `settings/native.ts` and
`settings/input.ts`, or registered through the plugin SDK. Stable IDs are independent of labels
and UI sections. Moving or relabeling a setting requires no file migration.
Removing a descriptor makes its saved value inactive; it remains in the file so
older/newer configurations remain usable. Unknown keys are preserved on writes.
Changing an ID or the meaning/format of its value requires an explicit migration.

Known invalid values use the descriptor default and produce a diagnostic. The
original value stays intact until explicitly changed. Malformed, oversized and
unsupported-version files are reported and never overwritten by UI changes;
repair the file and restart. Writes use a sibling temporary file and atomic
rename. The application reads provisioning at startup; live external file
watching is not implemented. Edit while the profile is closed.

The sandbox bridge exposes `preferences.catalog()`, `set(id, value)` and
`changed(callback)`. Entries distinguish saved `value` from `applied`, with
`pending` and the descriptor's `apply` timing. Failed application keeps the saved
value and reports the error. Native settings explicitly acknowledge their
application through this service. Plugin access is gated by settings capabilities and the current lease.

Validation: `npm run test:settings` exercises real Electron controls and reload;
`tests/settings.test.cjs` covers persistence across reconstructed stores, unknown
keys, descriptor removal/readdition, validation, malformed files and failed or
deferred application.

## Agent Integration

Agents can use MCP `provenance_control` with `{"enabled":true}` before loading a
ROM and `{"enabled":false}` when finished. Omitting `enabled` queries the state.
It controls the same setting as the checkbox and applies to subsequent ROM loads.

Settings → Agent Integration controls live MCP/CLI access, independently of the
current ROM. Access defaults off and persists per profile. `--services` /
`--no-services` override the initial state without changing the profile; the last
flag wins. A Settings edit can override that initial choice during the run.
An optional stable instance name allows copied MCP configuration to survive app
restarts. Copy MCP configuration uses the selected name or exact current UUID.
Packaged apps can install `ares`, `ares-mcp` and `ares-plugin` wrappers in
`~/.local/bin`; reinstall after moving the app.

Record N64 DMA provenance defaults off. Enable it before the transfers of interest;
turning it off stops recording and frees its bounded history. Reading `overlay_log`
does not enable it. Screenshots share the existing video packet rather than
copying a separate debug image every frame. Video recording captures only while
its explicit recording operation is active.

The visible MCP configuration preview and Copy button use `/bin/sh` to expand
`~/.local/bin/ares-mcp` at launch
when an executable Ares-managed helper is installed, so reinstalling helpers
from a moved app preserves the configured command. Before helper installation,
it falls back to the current bundle path. Install helpers before copying the
configuration for a stable setup. Choose a stable instance name as well to keep
the connection selection valid across app restarts.

## Playback controls

Settings → General → Emulation includes **Pause when the window loses focus**
(`emulation.pauseOnFocusLoss`, off by default). Focus loss pauses ordinary play;
focus return resumes only a pause introduced by this policy. Explicit Pause stays
paused across focus changes. MCP pause/resume and bounded execution take control
of playback and suspend focus pausing until the user explicitly pauses/resumes
from the UI or loads another ROM. Session status reports the actual `paused` state,
with `manual_paused` and `focus_paused` describing the separate UI/policy state.

**Hold to fast-forward** (`emulation.fastForwardKey`, default `Space`) supports
Record key and can be cleared to disable the keyboard binding. Hold that key while
the video has focus, or hold the fast-forward toolbar button, to run without normal
speed limiting. This takes priority over a controller binding using the same key.
Audio is muted during fast-forward. Releasing the key/button, changing bindings,
opening a modal, losing focus, or reloading the renderer restores normal speed.
Fast-forward does not unpause the game or change bounded MCP execution.

## Video effects

Luminance, saturation, and gamma use linked sliders and numeric inputs; their
values still apply through the native core's live video configuration. The old
`presentation.scanlines` demo switch and its hard-coded WebGL darkening pass have
been removed. Existing profiles may retain that obsolete key, but it has no effect.
Real shader-preset support is not implemented in the Electron frontend yet.
Upstream ares uses libretro Slang presets through librashader; those multi-pass
presets need a compatible renderer/backend integration rather than a synthetic
scanline checkbox.

## Window title and workspace chrome

The macOS native traffic lights remain in use. A custom title bar shows the game
name and system artwork while editing a workspace, in side-by-side layouts, when
video is below another panel, or with an open floating popup. Video-only layouts
and full-width top-video vertical layouts keep video behind the transparent drag
region. Fullscreen reserves no title-bar space. Outside layout editing, docked
panel headers stay hidden and the resize dividers remain available.

Keyboard gameplay does not require canvas focus. Native text fields and dropdowns
keep their keys; sliders/radios keep navigation keys, and buttons keep their native
activation keys. Other keys can reach the game from anywhere in the main window.
Modal dialogs and layout editing block gameplay input. Clicking a dialog backdrop
dismisses it and restores focus. Both playback toolbar and cursor hide after five
seconds of pointer inactivity over the viewport.

## Save-state preferences

- `states.root`: absolute managed-library directory; defaults to
  `<profile userData>/states`. Changes apply to browsing and future writes without
  moving/deleting the previous collection. The picker chooses a directory.
- `states.dateFormat`: display-only format, default `%b %e, %Y @ %I:%M %p`.
  Presets fill the editable field; preview and unsupported-directive errors appear
  inline. Supported directives: `%%` percent, `%Y` year, `%y` two-digit year,
  `%m` month number, `%B`/`%b` English month/full abbreviation, `%d` padded day,
  `%e` unpadded day, `%H` 24-hour, `%I` padded 12-hour, `%M` minute, `%S` second,
  `%p` AM/PM, `%a` abbreviated weekday, `%z` numeric local offset. Labels use local
  time; filenames, stored capture instants, identity and ordering are unaffected.
