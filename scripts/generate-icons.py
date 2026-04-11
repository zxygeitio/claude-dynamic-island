from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SPRITESHEET = ROOT / "characters" / "default-cat" / "spritesheet.png"
ICONS_DIR = ROOT / "src-tauri" / "icons"


def extract_cat_frame() -> Image.Image:
    sheet = Image.open(SPRITESHEET).convert("RGBA")
    frame = sheet.crop((0, 0, 16, 16))
    return frame.resize((320, 320), Image.Resampling.NEAREST)


def build_icon(size: int) -> Image.Image:
    cat = extract_cat_frame()
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse(
        (
            int(size * 0.18),
            int(size * 0.16),
            int(size * 0.82),
            int(size * 0.84),
        ),
        fill=(247, 171, 35, 58),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(radius=size * 0.07))
    canvas.alpha_composite(glow)

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.ellipse(
        (
            int(size * 0.30),
            int(size * 0.74),
            int(size * 0.70),
            int(size * 0.88),
        ),
        fill=(0, 0, 0, 110),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=size * 0.03))
    canvas.alpha_composite(shadow)

    cat_size = int(size * 0.70)
    cat_scaled = cat.resize((cat_size, cat_size), Image.Resampling.NEAREST)
    x = (size - cat_size) // 2
    y = int(size * 0.12)
    canvas.alpha_composite(cat_scaled, (x, y))

    return canvas


def main() -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    build_icon(32).save(ICONS_DIR / "32x32.png")
    build_icon(128).save(ICONS_DIR / "128x128.png")
    build_icon(256).save(ICONS_DIR / "128x128@2x.png")
    build_icon(256).save(
      ICONS_DIR / "icon.ico",
      format="ICO",
      sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    main()
