from pathlib import Path

from PIL import Image, ImageDraw


PROJECT_ROOT = Path(__file__).resolve().parents[3]
SOURCE = Path(__file__).with_name("care-journal-foreground.png")
RESOURCES = PROJECT_ROOT / "android" / "app" / "src" / "main" / "res"
BACKGROUND = "#E8F2EC"

FOREGROUND_SIZES = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}

LEGACY_SIZES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}


def resize(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)


def legacy_icon(foreground: Image.Image, size: int, round_icon: bool) -> Image.Image:
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    inset = max(1, round(size * 0.025))
    bounds = (inset, inset, size - inset - 1, size - inset - 1)
    if round_icon:
        draw.ellipse(bounds, fill=255)
    else:
        draw.rounded_rectangle(bounds, radius=round(size * 0.22), fill=255)
    background = Image.new("RGBA", (size, size), BACKGROUND)
    icon.alpha_composite(Image.composite(background, Image.new("RGBA", (size, size)), mask))
    icon.alpha_composite(resize(foreground, size))
    return icon


def main() -> None:
    foreground = Image.open(SOURCE).convert("RGBA")
    for density, size in FOREGROUND_SIZES.items():
        destination = RESOURCES / f"mipmap-{density}" / "ic_launcher_foreground.png"
        resize(foreground, size).save(destination, optimize=True)

    for density, size in LEGACY_SIZES.items():
        directory = RESOURCES / f"mipmap-{density}"
        legacy_icon(foreground, size, round_icon=False).save(directory / "ic_launcher.png", optimize=True)
        legacy_icon(foreground, size, round_icon=True).save(directory / "ic_launcher_round.png", optimize=True)

    preview = legacy_icon(foreground, 512, round_icon=False)
    preview.save(Path(__file__).with_name("care-journal-icon-preview.png"), optimize=True)


if __name__ == "__main__":
    main()
