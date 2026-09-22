"""
Draws the app icon (icon.png 512px, icon-180.png for iOS) and writes them next to
this file. Run it again if the look should change:

    python make_icon.py

Kept as code rather than a binary blob nobody can edit, and it needs Pillow, which
is only installed when you run it - the site build does not need it.
"""
import math

from PIL import Image, ImageDraw

BLUE, DEEP, WHITE = (42, 120, 214), (14, 32, 56), (255, 255, 255)
GREEN = (27, 175, 122)
SS = 4                                     # draw big, shrink down: cheap anti-aliasing


def draw(size):
    w = size * SS
    img = Image.new("RGB", (w, w), DEEP)
    d = ImageDraw.Draw(img)

    # a soft band of colour across the lower half, so the icon is not flat
    for i in range(w // 2):
        f = i / (w / 2)
        d.line([(0, w // 2 + i), (w, w // 2 + i)],
               fill=(int(DEEP[0] + (BLUE[0] - DEEP[0]) * f * 0.55),
                     int(DEEP[1] + (BLUE[1] - DEEP[1]) * f * 0.55),
                     int(DEEP[2] + (BLUE[2] - DEEP[2]) * f * 0.55)))

    # the session in one line: easy, three threshold reps, easy again
    reps = [(0.30, 0.42), (0.48, 0.60), (0.66, 0.78)]
    pts, n = [], 400
    for i in range(n + 1):
        t = i / n
        x = w * 0.12 + (w * 0.74) * t
        high = any(a < t < b for a, b in reps)
        pts.append((x, w * (0.34 if high else 0.62)))
    for _ in range(9):                                   # round off the corners
        pts = [pts[0]] + [(p[0], (pts[i - 1][1] + p[1] * 2 + pts[i + 1][1]) / 4)
                          for i, p in enumerate(pts) if 0 < i < len(pts) - 1] + [pts[-1]]
    d.line(pts, fill=WHITE, width=int(w * 0.035), joint="curve")

    # a dot at the end of the trace - where you are now
    at = pts[-1]
    r = w * 0.058
    d.ellipse([at[0] - r, at[1] - r, at[0] + r, at[1] + r], fill=GREEN)

    return img.resize((size, size), Image.LANCZOS)


for size, name in [(512, "icon.png"), (192, "icon-192.png"), (180, "icon-180.png")]:
    draw(size).save(name, optimize=True)
    print(f"wrote {name} ({size}x{size})")

# Android may crop the icon to a circle, so it gets its own version with the
# artwork pulled well inside the edges ("maskable").
full = draw(512)
inner = full.resize((316, 316), Image.LANCZOS)
safe = Image.new("RGB", (512, 512), DEEP)
safe.paste(inner, (98, 98))
safe.save("icon-maskable.png", optimize=True)
print("wrote icon-maskable.png (512x512, safe area)")
