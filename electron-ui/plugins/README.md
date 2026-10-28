# Local plugins (API 1)

Open **Plugins** in the sidebar. Add a directory containing `manifest.json`, then
explicitly enable it. Fresh profiles enable the bundled memory explorer, N64
stop/register view, settings panel, ROM library and verified Kirby powers tool. Existing enable/disable choices
are preserved; use Plugins or the CLI to enable a new bundled tool in an older
profile. `ARES_DEFAULT_PLUGINS=0` suppresses these first-profile defaults for tests. Enabled roots
and IDs persist under Electron's userData/plugins; `ARES_PLUGIN_DIRS` (platform
path delimiter) explicitly enables development directories at startup. Refresh
re-reads manifests using the same replacement transaction as each plugin’s Reload
button. Enabled source directories are watched with a 180 ms debounce; dependencies,
hidden directories and declared build outputs are ignored.

Plugins are trusted renderer JavaScript, not a security sandbox. Install only
code you trust. Node integration stays disabled. Main routes declared service
capabilities and pins every SDK request to the plugin generation/session/epoch.
Disabling, renderer reload, reset or ROM switch revokes old tokens, pending
responses, resources and SDK calls, and releases only that plugin's execution
owner. Plugin commands work before any panel has mounted.

See `contracts.ts` for the manifest and bridge and `sdk.ts` for the author API.
Entries must export `activate(context, restoredState?)` and can return a disposer (including
asynchronously). Register only declared local panel/command IDs; host identities
are namespaced by plugin ID. Panels mount lazily and may return their own cleanup.
Use `scope.listen`, `scope.interval`, `scope.add` and `signal` for cleanup. SDK
listeners/timers arm only after activation succeeds. Interval callbacks run only
while the plugin has a visible panel. Disposers may return promises; cleanup is
bounded to one second and failures are reported. Raw
module side effects are the author's responsibility. `onVisibility` lets panels suspend their work.
Panels can appear in multiple workspace regions or floating windows; see [Workspace](../WORKSPACE.md).
Each mount receives a stable `instanceId` and its own abort `signal`. SDK effects
created synchronously during mounting belong to that instance and stop on removal.
Activation-time `ui.openPanel` does not modify the workspace; an explicit command
can open a panel in a persistent popup.

Capabilities: `session.read` (status), `session.control` (pause/resume and bounded
execution), `debug.read` (N64 frozen stop/register snapshots), `memory.read`
(regions/read and N64 CPU/RDRAM reads), `memory.write` (region writes and N64
single/batched writes), plus the settings capabilities described below. No general filesystem or
arbitrary service methods are exposed through the SDK. Service replies preserve
native errors; check `reply.ok`. Stale scopes reject with `stale_plugin_scope`.
Logs retain the latest 128 messages (2 KiB each). Activation/command failures show
in the manager; `log.error` records a message without disabling the plugin.
Storage is JSON, namespaced by plugin ID and storageVersion, limited to 16 KiB.

Activation systems use exact native system names. Game profiles require a verified
SHA-256 of the normalized MIA `program.rom` content, reported as `session.status`
`game`. Filename and directory never participate. Unsupported revisions stay
waiting. Disc/multifile games without program.rom have no content profile yet.
The Kirby powers tool matches the verified US revision 0 hash and offers None,
seven singles and all 28 pairs using the previously researched addresses and HUD
icons. See [power mappings and provenance](../bundled-plugins/kirby/README.md). Overlay/page/shell modes are reserved
and produce an actionable unsupported-mode message.

For plain JS copy `bundled-plugins/memory`. For TS/TSX copy
`templates/plugin-tsx`, run `npm install` then `npm run build`, and add that directory.
The host can build the template directly from its manifest `build.entry`; npm
build remains available for standalone authoring. The template bundles JSX with a tiny DOM factory; no framework is imposed. Its
`src/sdk.d.ts` re-exports the complete generated browser SDK declaration graph.
Run the host build before copying the source template, or use the CLI scaffold.
After `npm install`, `npm run typecheck` checks your plugin against all SDK and
service types. Host/CLI esbuild builds remain transpilation, not type checking.
The distributed types include settings, storage, lifecycle, UI, session identities
and the full typed service map; runtime capabilities still restrict which methods
a plugin may call.

Validation: `npm test` includes manifest/registry and real N64/GBA scoped memory
checks; `npm run test:plugins` runs the real Electron UI test. Optional Kirby test:
`ARES_PLUGIN_TEST_ROM=/path/to/verified.z64 node --test tests/plugins-game-live.test.cjs`.
It uses disposable renamed and byte-swapped copies and saves, never the originals.

## Watched replacement

Plain-JS entries and optional `build: {entry:"src/plugin.tsx", jsxFactory:"h"}`
inputs are bundled by the host's esbuild into immutable content-addressed artifacts
under userData/plugins/artifacts. Relative imports and assets are captured; files
are limited to 2 MiB each, snapshots to 16 MiB / 256 files. Build/import errors keep
the current scope, DOM and styles intact. Host bundles include esbuild; no external
npm/watch process is required. Installing a plugin's dependencies remains an author
step; package scripts are never executed by the host.

Replacement imports the candidate under a fresh module identity and may call
`export function prepare()` for pure validation. No SDK is supplied during this
stage; manifest contributions are validated but not published. Raw top-level module
side effects remain the trusted author's responsibility. Avoid side effects during
import/prepare. Import, prepare and activation each have a two-second deadline.

Before activation, main revokes the old token and confirms native release of only
its owner. The host aborts its SDK effects and invokes cleanup in reverse order,
then activates the candidate with registrations detached and listeners/timers inert.
Reads are available during activation; writes, pause/resume, execution and storage
mutations reject with `plugin_not_ready`. Put patches and other mutations behind
explicit commands. Restoring an open panel cannot implicitly replay a patch.

If activation fails, the candidate is disposed and the previous immutable artifact
is remounted under a fresh token. Failed rollback is shown explicitly and the
plugin can recover through another valid edit/Reload. Already executed commands
are never undone or replayed. Session/epoch changes invalidate an in-flight reload.
The emulator is never reset/restarted for a source/CSS change; an external MCP
operation retains its owner. Releasing an old plugin-owned run cancels that run.

Optional transient state:

```js
export const stateVersion = 1;
let selection = 0;
export function saveState() { return {selection}; }
export function activate(ctx, restoredState) {
  selection = restoredState?.selection ?? 0;
  // Register panels/commands using this selection.
}
```

State must serialize as JSON under 16 KiB and is restored only when both artifacts
opt into the same stateVersion. Durable data stays in namespaced storage. Stable
panel IDs retain workspace placements. Hidden popups retain their mounted view,
with polling suspended; plugin reload restores compatible serialized state.

The plugin manager in Settings shows build/reload errors. Diagnostic effect counts
remain available as DOM data attributes for the integration harness. `npm run test:reload` exercises repeated reloads, polling, stale writes,
invalid edits, failed activation/rollback, hanging cleanup, real MCP ownership,
plugin-owned operation release, rapid edits and a session switch during preparation.
Artifact pruning retains current/previous/candidate snapshots, rather than every
edit. Chromium caches imported ESM modules until renderer teardown; the checks here
prove SDK effect/request cleanup, not that Chromium unloads individual modules.

## Startup recovery

Quit the app using the affected profile (force quit if its renderer is stuck),
then launch the same profile with plugins disabled:

```sh
ARES_PROFILE=play npm start -- --disable-plugins --services
```

From the repository root, use `npm start --prefix electron-ui --` before those
flags. Copied apps accept `--disable-plugins --services` on their bundled
`Contents/MacOS/Ares` executable. `ARES_DISABLE_PLUGINS=1` is the environment
equivalent. The profile lock still permits only one process per profile.

This bypasses persisted enabled plugins, bundled defaults and ARES_PLUGIN_DIRS
auto-enablement for the whole launch. Main reads bounded manifest metadata for
the recovery manager, but does not build/import plugin code, grant SDK leases or
start plugin watchers. It preserves startup selections until an explicit repair.
The manager shows the stored choices and lets you uncheck a plugin; enabling,
adding and reloading remain blocked until restart without the recovery flag.
Renderer reload cannot leave recovery mode.

For broken/missing manifests or a corrupt startup configuration, select the
reported service connection file and instance explicitly with the CLI:

```sh
npm run plugin -- disable local.broken --connection /absolute/instance.json --instance INSTANCE_ID
npm run plugin -- reset-startup --connection /absolute/instance.json --instance INSTANCE_ID
```

`disable` removes that ID from saved startup choices, even if its manifest cannot
load. `reset-startup` is available only during recovery and clears enabled IDs and
remembered local directories. It preserves plugin storage, saves, source files and
browser preferences. Restart normally after repair; reset leaves bundled tools
disabled until you choose to enable them. A first-ever recovery launch does not
create saved selections, so an untouched fresh profile still gets normal defaults
on its first ordinary launch. `ARES_DEFAULT_PLUGINS=0` only suppresses fresh-profile
defaults and is not a recovery mechanism.

## Bundled tools and agent commands

The former renderer-owned inspector is now `ares.examples.memory`, using the same
scoped SDK as other plugins. It supports generic debugger regions on N64/GBA,
validated offsets/lengths, whitespace-tolerant hex writes and hot-reload UI state.
`ares.tools.debugger` displays the native immutable last stop and its captured
registers; live registers are used only when no stop exists. Neither tool writes
or changes emulation while opening/restoring a panel.

Build the checkout, start the app with services enabled, and explicitly select its
connection file and instance ID (reported by main). In a copied macOS app use
`Ares.app/Contents/Resources/ares-plugin` instead of `node dist/plugins/cli.js`.
The launcher uses bundled Node/compiler/templates and needs no developer runtime.

```sh
node dist/plugins/cli.js scaffold /tmp/my-tool --id local.my-tool
node dist/plugins/cli.js build /tmp/my-tool
node dist/plugins/cli.js list --connection "$CONNECTION_FILE" --instance "$INSTANCE_ID"
node dist/plugins/cli.js add /tmp/my-tool --connection "$CONNECTION_FILE" --instance "$INSTANCE_ID"
node dist/plugins/cli.js enable local.my-tool --connection "$CONNECTION_FILE" --instance "$INSTANCE_ID"
node dist/plugins/cli.js open local.my-tool hello --connection "$CONNECTION_FILE" --instance "$INSTANCE_ID"
node dist/plugins/cli.js reload local.my-tool --connection "$CONNECTION_FILE" --instance "$INSTANCE_ID"
node dist/plugins/cli.js command ares.examples.kirby power-14 --connection "$CONNECTION_FILE" --instance "$INSTANCE_ID"
```

`enable ID --disabled` disables a plugin. `open` may omit the panel name to select
the first declared panel. `command` requires a declared command ID. `--token`
allows explicitly pinning an existing generation; otherwise the CLI obtains the
current token immediately before sending an action. Stale tokens reject rather
than binding to a replacement/game. Reload waits for the new active generation
and reports build/activation errors; it never retries a command. `build --output`
selects the artifact cache; the default `.ares-plugin-build` is ignored by watchers.
The list is paged without log bodies; `--page-size 1` reduces response size and the
CLI automatically reduces oversized pages.

Management shares the authenticated, private local endpoint's instance selection,
replay protection, bounded requests and no-replay reconnect behavior. Commands
invoke registered SDK handlers directly, with main-frame acknowledgement; no UI
scraping/eval is used. Timeouts mean the action was not replayed, not proof that an
already accepted effect was undone. The existing MCP registry remains 68 tools.

`npm run test:plugin-tools` demonstrates an MCP watch stop matching the panel,
CLI scaffold/build/add/enable/open/reload, the loaded session surviving edits,
external-run busy exclusion and human pause. `npm run test:kirby` requires
`ARES_PLUGIN_TEST_ROM`; it verifies all 36 buttons/icons/readbacks using disposable
ROM/settings/saves, and leaves originals unchanged. `ARES_BACKGROUND_TEST=1`
hides test windows while retaining unthrottled rendering.


## Profile settings contributions

`settings.read` reads all registered settings; `settings.write` with read permits
editing them (including plugin sections) and using host file pickers. The bundled
`ares.tools.settings` panel uses these same APIs. `settings.register` permits
registering, reading and editing only the plugin's own declared sections without
granting access to other profile settings. Capabilities govern the supported SDK;
plugins remain trusted same-renderer code, not isolated extensions.

Declare sections in the manifest:

```json
{
  "capabilities": ["settings.register"],
  "contributes": { "settings": [{ "id": "display", "title": "Display" }] }
}
```

Register fields during activation, then use a command or shared form for edits:

```ts
export async function activate(context: PluginContext) {
  await context.settings.registerSection('display', [
    { id: 'accent', title: 'Accent', type: 'enum',
      options: ['blue', 'green'], default: 'blue' }
  ]);
  context.ui.registerPanel('settings', ({ element }) => context.settings.mount(element));
}
```

That panel must also be declared in `contributes.panels`. A field's stable profile
key is `plugin:<plugin ID>:<section ID>:<field ID>`. Provision it in the same
`preferences.json` as host settings. Registration stages metadata without writing
defaults or publishing controls until activation succeeds. Reload, disable,
renderer replacement and session/epoch changes revoke definitions and writers;
saved values remain for the next registration. Queued writes recheck the lease
before touching the file. Activation/restore cannot write settings.

`catalog()`, `set(id, value)`, `reset(id)`, `chooseFile(id)` and `changed(callback)`
share the host settings model. `mount(element)` renders the shared scoped form.
Subscriptions and returned disposers belong to the plugin scope. Plugin fields
currently support live, profile-scoped booleans, bounded numbers, enums and
strings (including key controls); arbitrary native bindings and file descriptors
are host-owned. Limit: eight declared sections, 32 fields per section, 128 fields
per plugin. The complete profile file is bounded to 1 MiB. Renaming IDs or changing
value semantics needs an explicit migration; moving sections visually or removing
fields leaves saved data readable. Changing a registered section ID changes its
field namespace; changing only its title or display position does not. See [settings behavior](../SETTINGS.md).

### Admission and diagnostics (Kirby feedback implementation)

Each plugin has one admission bound of **8 concurrent service/settings requests**.
The renderer and registry enforce the same bound, with no queue or replay.
Excess SDK calls reject with `code: request_overload`, `pending`, and `limit: 8`;
stale scopes reject with `code: stale_plugin_scope`. Native service failures remain
resolved `ok: false` replies. `busy` continues to mean execution contention.
Always clear refresh latches with `finally`, including around `Promise.all`:

```js
if (refreshing) return
refreshing = true
try {
  const reply = await ctx.services.request('memory.readMany', { reads })
  if (!reply.ok) throw new Error(reply.error)
  render(reply.result)
} finally {
  refreshing = false
}
```

`memory.readMany` accepts 1–64 region-offset ranges and 64 KiB total, preserves
order/overlaps, and validates all ranges before invoking callbacks. One native
safe-point dispatch copies the entire sample without guest execution between
ranges. A paused read does not advance a frame. Results carry epoch, frame kind,
frame, `sample_id` and `at_frame_boundary`. Separate `n64.memory.readMany` ranges
use `{address, view, length}` with existing CPU/cache-aware translation.

Use `ares-plugin logs <id> --connection FILE --instance UUID` for up to 32 log
entries, or `--cursor N --generation TOKEN --limit N` to continue. The response
contains dropped/missed counts; a changed generation rejects a stale cursor.
`ares-plugin screenshot --output /absolute/new.png [--panel plugin.id:panel]`
uses the same explicit selection and captures the app UI rather than framebuffer.
A hidden/closed panel reports `panel_not_open`; existing files are not replaced.
MCP exposes the same operations as `plugin_logs` and `ui_screenshot`.

Stable targeting: launch the app with `--instance-name kirby` and select it with
`--service-dir /absolute/private/services --instance-name kirby`. Names are
opt-in, case-sensitive, 1–48 ASCII alphanumeric/underscore/hyphen characters and
must begin alphanumeric. No newest-instance discovery is performed. Each launch
still has fresh credentials; reconnect never replays in-flight requests. A native
kernel claim lock serializes publication/recovery; its `.lock` inode intentionally
remains after exit. Connection records are private, atomically published and
removed only by the launch that owns them.

The Generic memory plugin includes a RAM diff panel with native before/after
snapshots, typed comparison pages and game-specific labels. Labels can be
imported/exported with ROM and region-map provenance. Native candidate narrowing, changed-run maps and recorded-frame navigation are
available as described below.

RAM diff continuation: Find candidates performs a bounded native query; Narrow
retained candidates reuses its native set with fresh snapshots. Adjacent run,
line and page content views fetch only the visible page. Frame recording keeps
capacity separate from duration and never resumes a paused game. Refresh recording
shows sequence/frame identity, overwrites and native copy measurements; use a
retained sequence as before/after to freeze it for analysis. Expired handles clear
the local samples with an actionable recapture message. Labels survive reload;
recording/snapshot/query resources are released with the plugin owner. Large
candidate or byte budgets fail explicitly rather than silently truncating a set.

Host admission errors cross IPC/contextBridge as plain internal failure data and
are reconstructed into SDK Error objects in the renderer. This preserves code,
pending and limit even when the renderer has not itself hit its admission bound.
The internal window bridge is not the public SDK; native ok:false service replies
remain ordinary resolved SDK replies. Live unload tests settle pending calls and
verify both zero host bookkeeping and a working replacement plugin generation.

## Controller mapping editors

Panels may declare `"placement": "input-settings"` to appear in Settings → Input's
editor selector. Register them with the ordinary `ui.registerPanel` API. The host
mounts the selected editor while the Input page is open, and disposes it on close,
selection change or plugin revocation. Scoped timers/listeners and mount signals
work as for workspace panels. These panels are not workspace panels, so do not use
`ui.openPanel` for them. Use `settings.read` / `settings.write` and the public
`context.settings` API to configure host input bindings. The optional bundled
[controller editor](../bundled-plugins/controls/README.md) demonstrates artwork,
keyboard/Gamepad capture and remapping without special host access. Advanced
input fields remain available independently of plugins.

### Screen overlays and frozen frame callbacks

`ctx.ui.registerOverlay(id, mount, options?)` mounts into a host-owned div sized
and positioned exactly over the displayed screen rectangle. The div moves with
the viewport, including a floating workspace viewport. Settings uses the DOM top
layer and appears above it. Overlay order is explicit (`order`, -100..100); input
passes through unless `interactive: true`. Registration, child DOM, resize hooks
and native frame subscriptions are removed on plugin disposal/replacement.
`mode: "overlay"` is supported; registration also works from an ordinary panel
plugin. Up to 16 overlay layers may be mounted.

`overlay.size` / `overlay.onResize` distinguish CSS `width`/`height`, `dpr`, canvas
backing-store `pixelWidth`/`pixelHeight`, and `logicalWidth`/`logicalHeight`. `sourceWidth`/`sourceHeight` describe native video pixels.
The logical picture describes the submitted picture, rather than the narrower
active VI register range. Kirby's logical 320×240 picture is independent of its
640×240 native video output and its aspect-corrected CSS rectangle.

```ts
ctx.ui.registerOverlay('points', overlay => {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  overlay.element.append(canvas);
  return overlay.onResize(s => {
    canvas.width = s.pixelWidth;
    canvas.height = s.pixelHeight;
    const c = canvas.getContext('2d')!;
    if (s.logicalWidth && s.logicalHeight)
      c.setTransform(s.pixelWidth / s.logicalWidth, 0,
                     0, s.pixelHeight / s.logicalHeight, 0, 0);
    // Draw using logical coordinates; the canvas backing store follows DPR.
  });
});
```

`ctx.scope.onFrame({source, args?, every?, boundary?}, callback)` registers a read-only native
VI-boundary script. It is inert during candidate activation and starts when the
scope publishes. It requires `memory.read`. Each callback gets a deeply frozen
`{observerId, sequence, frame, value, skipped}`. All memory reads occur inside the
native script at that boundary; delayed renderer callbacks receive serialized
frozen values and cannot reread the past. `emu.info().frame_reference` exposes
boundary identity and current VI origin without another transport request.

Use `overlay.present(sample, synchronousPaint)` to draw sampled data: the host
matches native session, epoch, VI and origin-write identity against the submitted
video packet. Unmatched data is hidden and marked stale. `overlay.frame` provides
the matching packet and its renderer-submit acknowledgement. This acknowledgement
reports submitted WebGL work, not an OS-compositor presentation timestamp.
`ui_screenshot` includes overlay DOM; its frame reference is null if the submitted
frame changes during capture. Framebuffer screenshots remain a separate service.

Native observers are bounded to eight globally / four per owner, 16 MiB per
runtime, 64 KiB read bytes per callback, 8 KiB JSON results, 2 ms callback budgets
and a rotating 6 ms aggregate scheduler budget. Push subscriptions last until
stop, reset or lease disposal. Live delivery keeps one outstanding callback and
one latest replacement per observer; `skipped` includes native scheduling and
transport coalescing. It does not promise lossless recording. Exclusive scripts
suspend observers. Stopping a handle cannot stop another subscription. Legacy
`scripts.observe` retains its lower-rate polling interface and uses explicit native
handles internally. Default `boundary: 'vi'` samples completed VIs. N64 also
supports `boundary: 'vi_origin'`, executed synchronously after each VI-origin
write, including repeated values. `every` counts origin-write identities in that
mode. Values freeze before the CPU proceeds to later stores; frame references
label this boundary explicitly. The same rotating 6-ms aggregate budget is shared
across VI and origin callbacks in each VI. Skipped origin writes are counted.
Origin samples remain unmatched until video linkage is proven; an origin write
alone does not prove which subsequent packet contains its pixels.

See `examples/overlay` for a complete DPR canvas and matched-frame crosshair.

### Clipboard and exports

Declare `clipboard.write` for `ctx.clipboard.writeText(text)` and `files.export`
for `ctx.exports.saveText({suggestedName, text, overwrite?})`. Call these directly
from a real user click or key event. Synthetic DOM clicks and background scripts
cannot authorize them. Clipboard text is limited to 64 KiB; saved text to 1 MiB.
The host picker grants one destination; plugins supply a filename, never a path.
Cancellation returns a cancelled status. Existing files require explicit
`overwrite: true`; a destination changed during the operation is preserved.
Publication is atomic, with byte count and SHA-256 in the committed artifact.
Plugin unload, reset and session changes revoke outstanding grants, including
while the picker is open. `app_health` exposes outstanding save-dialog waits.

`ctx.exports.recordFrames({suggestedName, source, args?, every?, maxFrames?,
maxBytes?, maxSeconds?, boundary?, overwrite?})` also requires `memory.read`. Its source is
a confined native read-only observer, using the same frozen values and frame
references as `scope.onFrame`. It returns a recording handle with `jobId`,
`stop()` and `cancel()`. Stop publishes the complete bounded prefix; cancel
discards it. Scope disposal cancels the job. A cancelled picker returns a terminal
status instead of a recording handle.

Defaults are 600 frames, 8 MiB and 60 seconds; maximums are 3,600 frames, 16 MiB
and 600 seconds. One recording per plugin and two globally are admitted, subject
to native observer admission and runtime budgets. The main-process writer receives
samples before live renderer coalescing, with a 32-record / 1-MiB queue. Native
sample gaps, queue overflow, byte exhaustion and observer errors fail publication
and discard the temporary output. Frame/time limits and explicit stop publish a
versioned JSONL header, ordered frame records and a complete summary with its
termination reason. This promises a complete selected boundary sequence only
when publication succeeds. `plugin_exports` exposes bounded status pages to
CLI/MCP, including the committed artifact hash. Status history is bounded to 32
jobs and expires after 15 minutes when admitting new jobs.

### Graphics task provenance

With `debug.read`, `ctx.bridge.call('n64.rsp.lastTask', {})` returns the latest
conventionally declared graphics-task candidate; `{taskId}` selects a retained
ID. `rsp_last_task` exposes the same service through CLI/MCP. It freezes the
conventional DMEM 0xfc0 descriptor at SP HALT-clear, rather than rereading an
assumed RDRAM task location. Arbitrary microcode need not use this convention.
Task IDs, IMEM DMA fingerprints, stop signals and RSP-submitted RDP target
transitions are retained without forcing interpreter execution or full command
capture. Retention is 64 tasks, eight code revisions and 16 targets per task;
overflow is explicit. Reset invalidates retained tasks.

`scanouts` and boundary `task_candidates` match target addresses to VI origins.
They are explicitly candidates: DPC submission identifies the submitting task,
not every author of command memory or proof of displayed pixel contribution.
Repeated descriptor bytes link identities but do not prove yield/resume.
For the verified F3DEX2 FIFO 2.04H profile, `resume_mapping` can instead be
`verified_f3dex2_yield_dma`: an actual 3072-byte DMEM yield DMA, architectural
BREAK/signals, byte-identical restore DMA, unchanged entry context and matching
resumed command DMA were observed. `logical_task_id`, `resume_from` and
`resumed_by` link the distinct dispatch IDs; `yield_capture` preserves the
profile, address and SHA-256. `resume_reason` explains unverified submissions.
A consumed yield cannot be reused as proof for another dispatch. Altered, evicted,
ambiguous or unsupported contexts stay unverified. Retention is 64 dispatches;
each retains at most two 3072-byte contexts and one bounded matrix/vertex shadow.
These links do not strengthen the scanout's candidate-only pixel association. Both
RSP executors are covered by generated submission/DMA fixtures. Snapshot timing
reports only descriptor/IMEM capture cost, not total graphics overhead.

Plugins with `debug.read` can page `n64.capture.rsp` and
`n64.capture.matrices`. Enabling capture with `n64.capture.control` additionally
requires `session.control`. Matrix snapshots are supported for full IMEM hashes
and static dispatch tables matching F3DEX2 FIFO 2.04H. Other microcode yields no
invented state. `matrix_before_id`, `matrix_after_id` and each draw vertex's
`transform_state_id` join to immutable matrix entries in the same generation.
Page matrices with `{generation: null, offset: 0, limit: 4}`, then reuse the
returned generation and `next_offset`; a replaced generation returns
`stale_capture`. Finish both captures before the next origin-swap commit.

Each state contains actual RSP modelview, projection, valid combined matrix,
viewport, segment table and stack pointer, with original bytes and exact signed
16.16 values. A cached vertex retains the state from vertex transformation even
if later commands change the current matrix. `draw_vertices` includes actual
clip coordinates and quarter-pixel screen coordinates; `modified` marks changes
after transformation. This does not prove that a draw contributed displayed pixels.

Stack `saved` entries are historical bytes observed at RSP DMA writes, not
current RAM. Unobserved ancestors are null and `complete` is false; an invalid
or excessive depth is null. Subsequent pops are captured from actual RSP state.
Retention is bounded to 512 states per generation and 32 saved levels; `overflow`
and null references expose capacity loss. `command_complete: false` means no
verified post-operation state. Snapshots are interned, so their source boundary
identifies the first identical state rather than every referencing command.

The separate `consumed_matrix` operand remains labeled
`consumed_dma_operand_only`, with `rsp_matrix_stack: null`; use the state IDs
above for verified post-operation data.

`memory.sample` / `memory_sample` accepts `view: 'cpu'` for N64 RDRAM region
ranges. Offsets remain physical region offsets; CPU view uses the corresponding
cached KSEG0 mapping. Resident dirty DCache bytes take priority over raw RDRAM;
misses read raw backing bytes without cache fill, writeback, guest timing or
chip-initialization RNG effects. Other regions reject this view explicitly.
Default `view: 'physical'` retains the original raw-region semantics. Both views
share the existing 256-range / 1-MiB / 5-ms limits and immutable page behavior.
Capture metadata and frozen copies retain the selected view.

Overlay resize snapshots also expose `geometry`, `canvasToCss` and
`canvasToPixels`. These describe the core's screen canvas **before rotation and
its final viewport crop**. They are frozen with each video packet, including the
actual crop after the core refresh. `canvasToCss` maps its pixel-edge coordinates
to overlay-local CSS pixels; `canvasToPixels` maps to the DPR backing store. Both
use Canvas/DOMMatrix order `[a,b,c,d,e,f]`. For example:

```ts
overlay.onResize(s => {
  canvas.width = s.pixelWidth;
  canvas.height = s.pixelHeight;
  const c = canvas.getContext('2d')!;
  if (s.canvasToPixels) c.setTransform(...s.canvasToPixels);
  // Draw in native screen-canvas coordinates, with crop and rotation applied.
});
```

Use `logicalWidth` / `logicalHeight` for the existing nominal logical-picture
coordinate system. Screen-canvas geometry is separate: on Kirby, a 320×240
logical picture can be carried in a 640×240 packet backed by a larger core screen
canvas. These transforms do not reconstruct N64 VI filtering, source-RDRAM
coordinates, subpixels or interlace history. Unsupported/missing geometry is
`null`, including older video protocols; no transform is guessed. Resets clear it.

`ui_screenshot` includes `overlay_geometry` with these overlay-local matrices, the screen's
separately labeled window-CSS rectangle and the optional capture rectangle. Frame and geometry must
both remain stable across capture, otherwise both provenance fields are null.
This remains a renderer-submit observation, not an OS-compositor timestamp.

Graphics dispatch detection also runs after IMEM DMA, so a task can boot before
loading its graphics microcode. Handler overlays preserve the current command
when the dispatch signature remains intact. A replaced signature is rediscovered
before later instructions can acquire its labels. The actual Kirby acceptance
now exercises this load order and retained consumed DMA bytes with the JIT; an
interpreter run starts from power-on to avoid assuming cross-executor saved-state
compatibility. Generated fixtures cover the same late load and handler overlays
under both RSP executors. JIT blocks preserve the live elapsed clock rather than
restoring their compile-time value on reuse. This removes wrapped command-cycle
counts; it does not establish authoritative matrix arithmetic or stack state.

`n64.capture.transforms` is a compact plugin feed for matrix-driven overlays:
`{generation: null, offset: 0, limit: 32}` selects the latest VI view. Reuse its
`generation` for subsequent pages. Four immutable VI views are retained; older
ones return `stale_capture`. Up to 256 matrix commands per task and eight source
task batches are retained independently of the verbose 4,096-row RSP viewer.
The view selects a recent stopped scanout task candidate that has matrix data;
it does not claim all contributors. Compatible source-range matching handles a
VI origin inside a color target. Unknown or missing state is null, and command
loss/matrix quota loss are explicit. This read requires `debug.read`.

`emu.info().capture_generation` gives that VI's compact-view generation inside a
frame observer. The view's frame reference must match the observer's native
session, epoch, VI and origin-write identity before using `overlay.present`.
Raw post-matrix bytes and optional vertex-load state avoid reconstructing a
matrix stack from live RAM. See `examples/kirby-skeleton` for the full consumer
and its explicitly derived joint/camera visualization.

## ROM opening plugins

The bundled [ROM Library](../bundled-plugins/library/README.md) replaces the Open ROM
command through `library.browser`. Plugins can use the scoped `context.library` API
with `library.read` / `library.launch`; the host retains filesystem access and native
launch control. `ui.openPanel` accepts optional initial popup dimensions, and
`ui.closePanel` hides floating instances.

Panels with `"placement": "modal"` use a native HTML modal dialog instead of a
workspace region or floating window. Opening releases game input and blocks
background interaction; closing restores focus. An `autofocus` control receives
initial focus. The host supplies a title, close button and Escape handling. Modal
contents survive closing and receive visibility callbacks; disabling/reloading the
plugin disposes them. Modal panels are omitted from workspace placement pickers.
