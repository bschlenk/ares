# Embedded native video

Declare `video.read` in the plugin manifest and mount a host-owned view
inside a live panel’s DOM. Give its container a nonzero width and height.
The host owns the canvas, transport, rendering, frame references and cleanup.

```js
export function activate(ctx) {
  ctx.ui.registerPanel('dashboard', ({element}) => {
    const picture = document.createElement('div');
    picture.style.cssText = 'width:100%;height:100%;min-height:180px';
    element.append(picture);
    const view = ctx.video.mount(picture, {
      fit: 'contain',          // or 'cover' (center crop)
      filtering: 'nearest',    // or 'linear'
      integerScale: true,
    });
    // Optional: view.setVisible(false), view.status, view.dispose().
    // Disposal also happens automatically with this panel instance/plugin.
  });
}
```

See [the complete example](../examples/native-video/plugin.js) and its manifest.
React effects can call `ctx.video.mount(ref.current, options)` after attaching
a container inside a live panel; return `() => view.dispose()` from the effect.
The host resolves ownership from the panel DOM, so asynchronous mounts still
inherit that panel's visibility and disposal. React can own surrounding layout;
leave the mounted container's children to Ares. Calls outside a live panel or
from an old plugin scope fail explicitly.

## Pixels and transport

The primary canvas and embedded canvases use the same `VideoCanvas` renderer and
consume the existing native binary RGBA packet stream. Source pixels include
native rendering, raster effects, configured native color adjustments, rotation
and crop already performed by the core's Screen path. Frontend fit, filtering
and integer scaling are separate view options. A view does not reconstruct PPU
state or apply Pokémon-specific transformations. Audio remains in the native
host; creating views adds no audio stream and no input, debugger or game-control
authority. The plugin may lay out commentary, party, polls and other UI normally.

This is the existing copied binary IPC pipeline, not zero-copy GPU texture
sharing. There is one retained latest packet, and no per-view IPC stream or
frame queue. Each visible view uploads that packet to its own WebGL texture at
most once per source revision and renders on requestAnimationFrame. A slow view
skips obsolete packets; it does not hold native frame credit. The primary view
continues to own the existing one-credit transport. Views and trusted plugins
share the renderer thread, so a plugin blocking that thread can still interrupt
all renderer presentation; native emulation remains independently owned.

Limits: eight mounted embedded views globally, four per plugin, and 4,194,304
backing pixels / 8,192 pixels per dimension per view. Larger destinations retain
CSS aspect/fit and reduce backing resolution; diagnostics report `backingLimited`.
Integer scaling applies in device pixels when at least one aspect-correct native
picture fits; sub-1x destinations use fit scaling. Nonsquare pixel aspect can
prevent an integer horizontal native-pixel scale. Nearest is the default.

## Identity and health

`view.status` is an immutable snapshot. It reports `waiting`, `live`,
`suspended`, `unavailable`, or `disposed`, plus a reason, native packet dimensions,
aspect, geometry, submitted/skipped counters, and the current frame reference.
It never exposes the pixel payload or a mutable native buffer. Frame references
identify native session/epoch, native boundary and packet sequence plus this
view's renderer submission (`presentation.surface` identifies the surface). They are not OS compositor timestamps. Different
views may legitimately show different packet sequences.

Hidden panels, offscreen elements, zero-size containers and hidden documents
suspend embedded rendering without pausing the game. Visibility restoration
renders the latest packet. Explicit `setVisible(false)` combines with, and cannot
override, host panel visibility. Suspended/unavailable views have no current
frame reference and display a host status instead of an old game's image.

ROM changes, reset/state-load epochs, plugin replacement/unload and renderer
recreation invalidate old scopes. The new plugin/panel mount reconnects to the
current stream. Late packets from a previous native session/epoch are rejected.
A native disconnect clears video immediately. A running feed with no packet for
two seconds reports `frame_stalled`; a known paused core can retain a valid
`live` still frame indefinitely. WebGL context loss is explicit and restoration
recreates graphics resources. Disposing frees observers, callbacks, WebGL objects
and the Chromium context slot.

`ares-plugin video-status` and the shared CLI/MCP `video_surfaces` tool return
bounded metadata and per-view geometry. Select the connection file and app
instance explicitly as for the other plugin CLI operations. A missing renderer
returns an explicit unavailable reason. These tools carry no streaming pixel data.

## Overlays and screenshots

`view.overlay` uses the existing `OverlayContext`: append optional DOM/canvas
content to `overlay.element`, subscribe with `onResize`, and use its DPR backing
sizes / `canvasToCss` / `canvasToPixels`. It is aligned to this view's actual
picture and clipped with cover. It is noninteractive by default and aborts with
the surface. Up to 32 resize subscriptions are admitted per view.

`overlay.present(sample, paint)` only displays/paints when the frozen observer
sample matches this view's submitted frame; subsequent mismatching frames hide
it. `overlay.frame` describes this view, not the primary canvas. Native read-only
observation still requires its own `memory.read` grant. Video grants do not add
observation bindings. Without `present`, static overlay content is supported.

Normal panel/window capture includes these canvases and overlays. `ui_screenshot`
and `ares-plugin screenshot` briefly hold presentation, while native execution
and frame credit continue. Capture leases hide marked app chrome (titles,
playback controls, session/access banners and approval prompts) for the full
capture interval, including slow and nested captures. The final release restores
chrome in `finally`, including cancellation/errors. Navigation destroys the scope;
a capture crossing renderer recovery is rejected before publication. Legitimate
game and plugin overlays remain visible. Native presented/framebuffer screenshots,
AVI recordings and managed checkpoint previews use native pixels, independent of
DOM chrome; plugin frame exports contain native observer data. Before/after metadata must match; otherwise the response omits the frame
reference. `video_surfaces[]` reports each intersecting visible surface, its own
`frame`, picture/container rectangles in window CSS coordinates, options and
overlay geometry. The existing top-level `frame_reference` describes the primary
canvas only. Capture does not force independent views onto a common frame.

## Validation

Run `npm run test:video` with normal macOS graphics access. The isolated test uses
original GB/NES ROMs and a temporary profile. It covers normal-speed scrolling,
primary/embedded pixel agreement at a matched paused frame, duplicate views,
capture provenance, permission refusal, hidden panels, resize/DPR, frame-matched
overlays, reset/ROM switch, repeated plugin reloads, WebGL context restoration,
native disconnect, and deliberate renderer crash/recovery preserving native
session/epoch. It logs actual native/view frame deltas rather than using timers
as an emulation clock. Node tests cover latest-value ownership, stale epochs,
paused/stalled feed distinctions, layout, capture bounds and lease expiry.

This does not claim acceptance for every core, Pokémon-specific window/sprite/
fade scenarios, packaging/signing, or a full unattended run of the companion.
