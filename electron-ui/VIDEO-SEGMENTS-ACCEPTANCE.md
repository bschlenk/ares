# Sequential script video recording

This follow-up implements original Kirby feedback item 5 and supersedes its
segmentation deferral in `KIRBY-FEEDBACK-2026-10-28-ACCEPTANCE.md`.

## Behavior

Scripts now have awaited `emu.video.start(options?)`, `stop(path)`, `status()` and
`cancel()` methods. A successful stop publishes the AVI and frees the native
recording slot for the next start. Destinations use existing `--artifact` grants;
overwrite is disabled. A failed save retains the stopped clip for retry. Published
files survive later script failure; script exit cancels its current unsaved clip.
Explicit controls cannot replace automatic `--video` capture in the same script.

A state load by the recording owner preserves all previously captured pixels,
dimensions, cumulative limits and the disk spool. This applies to explicit script
clips, automatic `--video`, and same-owner MCP `video_start`. Frames before and
after the load are appended in capture order. There is no need for overlapping
recordings or additional live video sinks.

Metadata includes up to 64 `segments`, with native epoch/start/end coordinates,
zero-based AVI `first_frame` offsets and frame counts. Thus a stitched recording
does not falsely claim a single continuous native VI timeline. Dimensions must
remain consistent within an AVI; a change stops capture while retaining its
prefix. Existing eight-artifact and 64-host-request script quotas remain in force;
only successful video stops consume artifact slots, not start/status/cancel.

See [the script API and example](mcp/README.md#multiple-videos-from-one-script).

## Source and build

Product changes: `8d13bfb5d` and `074a95be4`. Tested source commit:
`074a95be405221f64d5e06348af524ad4690ffa6`.

Actual packaged app:
`electron-ui/artifacts/video-segments-2026-10-28/Ares.app`.
Actual packaged `build_info`:

- commit: `074a95be405221f64d5e06348af524ad4690ffa6`
- build ID: `1cbf03ca7b0a5054`
- schema ID: `ff7f606e5caa20ff1d10fa4fe29d594779c916dc826f4811dbc3f983f7f638db`
- built at: `2026-10-29T00:29:40.179Z` (October 28 in Detroit)

## Verification

- Rebuilt both `ares-electron-host` and `ares-electron-cpu-fixture` from source.
  The older native fixture was updated from vector indexing to sealed spool reads;
  its full run reports `CPU_DEBUG_FIXTURE_PASS`.
- Full suite against those rebuilt binaries: **229 tests, 228 passed, one private
  profile test skipped, zero failures**. Log:
  `/tmp/ares-video-segments-rebuilt-suite.log`.
- Real N64/MCP regression: one five-frame AVI spans four epochs, retaining the
  distinct pixels before and after loads; a second AVI contains its own two
  frames. Timeline offsets/counts are checked. The long-path stop reply exceeds
  the previous 1,536-byte host-result bound and passes the enlarged bounded bridge.
- Overlapping starts are rejected; ungranted output is rejected; file-exists
  publication failure retains the current clip and succeeds on a different
  granted path. Status after a successful stop has no leftover timeline entries.
- Eight sequential clips save successfully; a ninth start respects the existing
  artifact quota. Start/status/cancel do not consume publication slots.
- A script saves a video, begins another and throws: the saved file survives and
  the unsaved spool is released. Previously published clips are unchanged.
- Same-owner public `video_start` → two frames → state load → three frames →
  `video_stop` produces a five-frame video with two timeline segments.
- Automatic CLI `--video` retains both intervals across a load (3 + 200 = 203
  frames), replacing the previous last-interval-only behavior.
- Native disk-spool regression verifies frame ordering, cumulative frame/byte
  bounds across loads, dimension-change prefix preservation, reset/release, and
  readable prefixes after a real short disk write.

An initial large-reply test fixture did not actually exceed the old reply limit;
it was corrected to include four epochs. The implementation then passed both the
focused regression and full suite. This was a test-fixture assertion failure,
not a failed export or missing video frames.

## Packaged Kirby acceptance

The actual package above passed the opt-in media check using disposable copies
of Kirby's ROM and `rec2` state:

```
node electron-ui/tests/continuous-packaged.js APP ROM STATE OUTPUT_DIRECTORY segments
```

One script saved `first.avi` with **22 frames across two state epochs** (10 + 12),
then saved `second.avi` with **eight frames** in a new recording. Both are 320×237,
raw BGR24 at 60 fps. `ffprobe` independently confirmed dimensions, codec, frame
counts and playback rate. File sizes are 5,006,200 and 1,820,584 bytes. Original
ROM/state hashes were verified unchanged.

Actual app/native provenance and returned segment offsets are retained in
`artifacts/video-segments-2026-10-28/acceptance/acceptance.json`; both AVIs are in
the same ignored artifacts directory. Actual native SHA-256:
`05c27bca640ecc058a26f70b88012fddb2461de3f4822bcfca25dcd8089b8d61`.
The packaged run reported `SEGMENTED_PACKAGED_PASS`.
