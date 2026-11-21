"""Squall app icon: a daylight radar scope with one storm cell and you at the centre. Drawn at 4x and downsampled."""
import math
import os
from PIL import Image, ImageDraw

SKY = (216, 224, 230)
GLASS = (238, 242, 245)
LINE = (179, 191, 201)
INK = (22, 33, 42)
WHITE = (255, 255, 255)
DBZ = [(46, 155, 87), (227, 188, 26), (238, 138, 34), (215, 55, 43), (179, 42, 120)]
OUT = os.path.join(os.path.dirname(__file__), '..', 'app', 'assets')
PUB = os.path.join(os.path.dirname(__file__), '..', 'server', 'public')


def mix(a, b, k):
    return tuple(int(a[j] * k + b[j] * (1 - k)) for j in range(3))


def scope(size, transparent=False, scale_scope=0.84, mono=False):
    S = size * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0) if transparent else SKY + (255,))
    d = ImageDraw.Draw(im, 'RGBA')
    c = S / 2
    R = S * scale_scope / 2
    w = max(2, int(S * 0.008))
    col = (lambda rgb: (255, 255, 255, 255)) if mono else (lambda rgb: rgb + (255,))
    if not mono:
        d.ellipse([c - R, c - R, c + R, c + R], fill=GLASS + (255,))
    for f in (0.38, 0.7):
        rr = R * f
        d.ellipse([c - rr, c - rr, c + rr, c + rr], outline=col(LINE), width=w)
    # the cell
    cx, cy, cr = c + R * 0.33, c - R * 0.30, R * 0.44
    for i, rgb in enumerate(DBZ):
        rr = cr * (1 - i / 5.6)
        fill = mix(rgb, GLASS, 0.3 if i == 0 else 0.85)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=col(fill))
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], outline=col(DBZ[-1] if not mono else WHITE), width=w * 2)
    # rim and the N tick
    d.ellipse([c - R, c - R, c + R, c + R], outline=col(mix(INK, GLASS, 0.25)), width=w * 2)
    d.line([(c, c - R), (c, c - R + S * 0.06)], fill=col(INK), width=w * 3)
    # you
    rr = S * 0.055
    d.ellipse([c - rr - w * 2, c - rr - w * 2, c + rr + w * 2, c + rr + w * 2], fill=col(WHITE))
    d.ellipse([c - rr, c - rr, c + rr, c + rr], fill=col(INK))
    a = S * 0.03
    d.polygon([(c, c - rr - a * 2.6), (c + a, c - rr - a * 1.2), (c - a, c - rr - a * 1.2)], fill=col(INK))
    return im.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    scope(1024).convert('RGB').save(os.path.join(OUT, 'icon.png'))
    scope(1024).convert('RGB').save(os.path.join(OUT, 'adaptive-icon.png'))
    scope(1024, scale_scope=0.6).convert('RGB').save(os.path.join(OUT, 'splash-icon.png'))
    scope(512, transparent=True, scale_scope=0.6).save(os.path.join(OUT, 'android-icon-foreground.png'))
    Image.new('RGBA', (512, 512), SKY + (255,)).save(os.path.join(OUT, 'android-icon-background.png'))
    scope(432, transparent=True, scale_scope=0.6, mono=True).save(os.path.join(OUT, 'android-icon-monochrome.png'))
    scope(48).convert('RGB').save(os.path.join(OUT, 'favicon.png'))
    scope(256).convert('RGB').save(os.path.join(PUB, 'icon.png'))
    print('icons written')
