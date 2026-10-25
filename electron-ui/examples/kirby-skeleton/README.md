# Kirby skeleton overlay

Canonical source for the migrated `local.kirby-skeleton` plugin. Copy this folder's manifest, plugin.js, skeleton.js and style.css to the external Kirby project's `ares-plugins/kirby-skeleton` directory, then reload the plugin. Requires the native `n64.capture.transforms` service and the host overlay SDK.

The plugin pages immutable matrix-command records from a VI scanout candidate view. The native feed retains four VI generations, up to 256 matrix commands per task and eight task batches, independently of the verbose command viewer's cap. Task candidates include compatible VI source ranges, since Kirby starts scanout one source scanline into its color target. Reused targets prefer recent tasks. Every view has the actual VI and origin-write identity; source command VIs and task IDs remain distinct. Reset invalidates these captures. A stopped task and address/range association are candidates, not proof of complete pixel authorship or verified yield/resume.

All modelview/projection values come from hash-verified F3DEX2 FIFO 2.04H RSP state. There is no display-list memory walker or JavaScript matrix-stack emulator. Bones/object grouping are inferred from actual stack depth and model segment 4; they are not a generic GPU bone ABI. Kirby is identified using his CPU-view slot position sampled at that VI. Camera parameters and projected joint origins are derived visualizations; when available, the projection uses the actual combined matrix/viewport captured at vertex load. Otherwise the export explicitly labels the point `derived_from_rsp_matrices`. Unsupported microcode, missing states, quota overflow and missing scanout linkage are not silently reconstructed.

The canvas lives in `registerOverlay`'s div and uses its DPR backing size. It is painted only through `overlay.present` with the matching frozen frame sample. The tested Kirby display path is 320×240 logical / 640×240 native output, without screen-canvas rotation or crop. Other display geometries hide this overlay rather than guessing an RSP/VI coordinate transform. The core's generic canvas crop transform alone does not reconstruct VI filtering/source coordinates.

Clipboard and JSON saves use the gesture-scoped SDK APIs. Exports include frame and capture references, task/state IDs, raw fixed-point bytes, decoded matrices, camera, inferred hierarchy and partial/projection metadata. Live callbacks may coalesce; this is not a lossless sequence recorder.

Run acceptance from electron-ui:

    ARES_PLUGIN_TEST_ROM='/path/to/Kirby.z64' \
    ARES_PLUGIN_TEST_STATE='/path/to/Kirby.bs1' npm run test:skeleton

Tests copy media, isolate profile/saves, mock clipboard/save destination and check live rendering, pause, resize/DPR, floating viewport, Settings, scoped exports, reload during an exclusive script, epoch changes and capture/overlay disposal.

Candidate selection is conservative: a source task must have stopped no more than two VIs before the view. This supports Kirby's 30-fps graphics on a 60-VI clock without relabeling an indefinitely old matrix set as current data. Views with missing/older captures remain empty. The strict observer/presentation match uses VI and origin-write identity even when the origin address repeats.

The export preserves `frame`, `screen`, camera `persp`/`view`/`viewport` and joint `node`/`parent`/`world`/`matrix`/`screen: [x,y]` fields used for camera solving. `screen_point` adds depth and provenance is explicit. `mesh` is null: a vertex load alone does not prove a visible mesh draw. Filled UI markers indicate vertex loads, not pixel contribution.
