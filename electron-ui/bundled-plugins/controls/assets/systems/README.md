# System pixel art

27 transparent PNG cutouts from the user-supplied repository-root image
`this-8-bit-image-of-video-game-consoles-is-pretty-neat-v0-akpw98q10uj31.jpg.webp`.
The sheet did not include artist attribution; its existing artwork is preserved.

Every asset has a 144×144 transparent canvas. The original artwork is centered at
its source pixel dimensions: no resizing, palette conversion, or redrawing.
The source is a compressed WebP, so its original compression artifacts remain.

`extraction.json` records crop rectangles, artwork dimensions and canvas dimensions.
Recreate the assets from the repository root with Pillow installed:

```
python3 electron-ui/bundled-plugins/controls/scripts/extract-system-icons.py
```

The controller plugin uses icons only for matching systems. NES/SNES artwork
labels the corresponding Famicom/Super Famicom entries. Systems absent from the
sheet retain text labels. Other cutouts are available for future system pickers.
