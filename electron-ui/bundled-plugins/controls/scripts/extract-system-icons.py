"""Extract supplied sprite sheet without resampling any artwork. Requires Pillow.
Run from the repository root. Preserve source RGB values within each silhouette.
"""
from pathlib import Path
import json
from PIL import Image, ImageDraw

SOURCE = Path('this-8-bit-image-of-video-game-consoles-is-pretty-neat-v0-akpw98q10uj31.jpg.webp')
DEST = Path('electron-ui/bundled-plugins/controls/assets/systems')
SIZE = 144
# Deliberately include a few pixels of exterior on all sides for flood-fill seeds.
CROPS = {
 'nes': (4, 4, 142, 143), 'snes': (150, 4, 288, 143),
 'n64': (291, 4, 438, 143), 'gamecube': (445, 4, 578, 143),
 'wii': (590, 4, 729, 143), 'wii-u': (735, 4, 878, 143),
 'switch': (883, 29, 1023, 117),
 'game-boy': (17, 149, 130, 290), 'game-boy-color': (167, 154, 260, 286),
 'game-boy-advance': (294, 166, 439, 274),
 'nintendo-ds': (445, 148, 580, 290),
 'nintendo-3ds-blue': (585, 144, 735, 295),
 'nintendo-3ds-white': (735, 144, 881, 295),
 'master-system': (3, 313, 143, 417), 'mega-drive': (153, 314, 287, 418),
 'saturn': (296, 295, 437, 438), 'dreamcast': (446, 295, 579, 438),
 'game-gear': (148, 463, 292, 562),
 'playstation': (295, 597, 437, 719), 'playstation-2': (446, 592, 581, 727),
 'playstation-2-slim': (589, 601, 730, 717), 'playstation-3': (735, 588, 877, 731),
 'psp': (584, 762, 734, 848), 'ps-vita': (731, 760, 883, 850),
 'xbox': (441, 885, 580, 1014), 'xbox-360': (590, 880, 731, 1015),
 'xbox-one': (734, 880, 878, 1023),
}

def extract(source, box):
    sprite = source.crop(box).convert('RGBA')
    w, h = sprite.size
    pixels = sprite.load()
    # These sprites have a dark pixel outline. Fill each silhouette scanline,
    # retaining every source RGB value inside it (including light-colored bodies).
    for y in range(h):
        outline = [x for x in range(w) if max(pixels[x, y][:3]) < 65]
        left, right = (min(outline), max(outline)) if outline else (w, -1)
        for x in range(w):
            if x < left or x > right: pixels[x, y] = (0, 0, 0, 0)
    # Small concave pockets visible in the supplied silhouettes. Restrict
    # removal to exterior geometry so red/purple artwork is never color-keyed.
    pockets = [(323,130,397,140), (330,706,391,714),
               (485,889,535,907), (629,885,690,895)]
    for left, top, right, bottom in pockets:
        for sy in range(max(top,box[1]), min(bottom,box[3])):
            for sx in range(max(left,box[0]), min(right,box[2])):
                x,y = sx-box[0],sy-box[1]
                r,g,b,a = pixels[x,y]
                if max(r,g,b) >= 90 and r > g*1.25 and b > g*1.05:
                    pixels[x,y] = (0,0,0,0)
    trimmed = sprite.crop(sprite.getbbox())
    if max(trimmed.size) > SIZE: raise ValueError(f'Artwork {trimmed.size} exceeds {SIZE}px canvas')
    canvas = Image.new('RGBA', (SIZE, SIZE))
    canvas.paste(trimmed, ((SIZE-trimmed.width)//2, (SIZE-trimmed.height)//2))
    return canvas, trimmed.size

if __name__ == '__main__':
    source = Image.open(SOURCE)
    DEST.mkdir(parents=True, exist_ok=True)
    dimensions = {}
    contact = Image.new('RGB', (SIZE*7, (SIZE+22)*4), '#d0d0d0')
    draw = ImageDraw.Draw(contact)
    for index, (name, box) in enumerate(CROPS.items()):
        icon, size = extract(source, box)
        icon.save(DEST / f'{name}.png')
        dimensions[name] = {'sourceCrop': box, 'artworkSize': size, 'canvasSize': [SIZE, SIZE]}
        x, y = index % 7 * SIZE, index // 7 * (SIZE+22)
        contact.paste(icon, (x, y), icon)
        draw.text((x+4, y+SIZE+3), name, fill='black')
    (DEST / 'extraction.json').write_text(json.dumps(dimensions, indent=2)+'\n')
    contact.save('/tmp/ares-system-icons-contact.png')
    print(f'Extracted {len(dimensions)} icons at original pixel size.')
