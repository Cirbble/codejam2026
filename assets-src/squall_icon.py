"""Squall app icon: a radar scope with one storm cell and you at the centre. Drawn at 4x and downsampled."""
import math
import os
from PIL import Image, ImageDraw

BG = (7, 17, 21)
GLASS = (15, 35, 41)
RING = (140, 196, 182)
INK = (227, 238, 233)
AMBER = (242, 193, 74)
DBZ = [(30, 158, 74), (123, 198, 58), (241, 210, 59), (245, 155, 46), (228, 68, 47), (196, 48, 124)]
OUT = os.path.join(os.path.dirname(__file__), '..', 'app', 'assets')
PUB = os.path.join(os.path.dirname(__file__), '..', 'server', 'public')


def scope(size, transparent=False, scale_scope=0.86, mono=False):
    S = size * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0) if transparent else BG + (255,))
    d = ImageDraw.Draw(im, 'RGBA')
    c = S / 2
    R = S * scale_scope / 2
    def col(rgb, a=255):
        if mono:
            return (255, 255, 255, a)
        k = a / 255  # blend against the background ourselves, so faint lines stay faint
        return tuple(int(rgb[j] * k + BG[j] * (1 - k)) for j in range(3)) + (255,)
    if not mono:
        # glass: a soft radial fade
        for i in range(60, 0, -1):
            t = i / 60
            rr = R * t
            mix = tuple(int(GLASS[j] * (1 - t) + BG[j] * t) for j in range(3))
            d.ellipse([c - rr, c - rr, c + rr, c + rr], fill=mix + (255,))
    w = max(2, int(S * 0.006))
    for f in (0.36, 0.68):
        rr = R * f
        d.ellipse([c - rr, c - rr, c + rr, c + rr], outline=col(RING, 60), width=w)
    d.ellipse([c - R, c - R, c + R, c + R], outline=col(RING, 120), width=w)
    # bearing ticks
    for a in range(0, 360, 15):
        long = a % 90 == 0
        r0 = R - (S * (0.05 if long else 0.025))
        rad = math.radians(a)
        p0 = (c + r0 * math.sin(rad), c - r0 * math.cos(rad))
        p1 = (c + R * math.sin(rad), c - R * math.cos(rad))
        d.line([p0, p1], fill=col(AMBER) if a == 0 else col(RING, 120), width=w * (3 if a == 0 else 2 if long else 1))
    # the cell: reflectivity bands, hot core
    cx, cy, cr = c + R * 0.34, c - R * 0.30, R * 0.42
    for i, rgb in enumerate(DBZ):
        rr = cr * (1 - i / 6)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=col(rgb))
    # you: heading wedge
    a = S * 0.075
    pts = [(c, c - a), (c + a * 0.72, c + a * 0.72), (c, c + a * 0.32), (c - a * 0.72, c + a * 0.72)]
    d.polygon(pts, fill=col(INK), outline=col(BG) if not mono else None)
    return im.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    scope(1024).convert('RGB').save(os.path.join(OUT, 'icon.png'))
    scope(1024).convert('RGB').save(os.path.join(OUT, 'adaptive-icon.png'))
    scope(1024, scale_scope=0.62).convert('RGB').save(os.path.join(OUT, 'splash-icon.png'))
    scope(512, transparent=True, scale_scope=0.62).save(os.path.join(OUT, 'android-icon-foreground.png'))
    Image.new('RGBA', (512, 512), BG + (255,)).save(os.path.join(OUT, 'android-icon-background.png'))
    scope(432, transparent=True, scale_scope=0.62, mono=True).save(os.path.join(OUT, 'android-icon-monochrome.png'))
    scope(48).convert('RGB').save(os.path.join(OUT, 'favicon.png'))
    scope(256).convert('RGB').save(os.path.join(PUB, 'icon.png'))
    print('icons written')
