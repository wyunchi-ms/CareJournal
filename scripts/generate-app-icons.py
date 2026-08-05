"""Generate every platform icon from the single high-resolution CareJournal artwork."""

from __future__ import annotations

import struct
import argparse
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "design-system" / "carejournal" / "app-icon" / "care-journal-foreground-v2.png"
BACKGROUND = "#E8F2EC"
# Tauri 2 decodes the first ICO entry as its single default window icon.
# Put the simplified 48 px glyph first so the Windows 11 taskbar downsamples it
# to 24 px instead of upscaling the former 16 px first entry.
WINDOWS_SIZES = (48, 16, 20, 24, 32, 40, 64, 128, 256)
ANDROID_FOREGROUND_SIZES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
ANDROID_LEGACY_SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def contain(image: Image.Image, canvas_size: int, occupied: float) -> Image.Image:
    # Ignore near-transparent chroma-key remnants when finding the artwork bounds.
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value >= 64 else 0).getbbox()
    if not bbox:
        raise ValueError("The source artwork is empty")
    cropped = image.crop(bbox)
    target = round(canvas_size * occupied)
    cropped.thumbnail((target, target), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (canvas_size, canvas_size))
    canvas.alpha_composite(cropped, ((canvas_size - cropped.width) // 2, (canvas_size - cropped.height) // 2))
    return canvas


def rounded_background(size: int, radius: float = 0.22) -> Image.Image:
    result = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(result)
    inset = max(0, round(size * 0.018))
    draw.rounded_rectangle(
        (inset, inset, size - inset - 1, size - inset - 1),
        radius=round(size * radius),
        fill=BACKGROUND,
    )
    return result


def compose(source: Image.Image, size: int, occupied: float, rounded: bool = True) -> Image.Image:
    icon = rounded_background(size) if rounded else Image.new("RGBA", (size, size), BACKGROUND)
    icon.alpha_composite(contain(source, size, occupied))
    return icon


def small_icon(source: Image.Image, size: int) -> Image.Image:
    if size <= 48:
        return small_desktop_glyph(size)
    # Larger desktop surfaces can retain the complete brand artwork.
    icon = compose(source, size, occupied=0.72)
    if size <= 48:
        icon = ImageEnhance.Contrast(icon).enhance(1.10)
        icon = icon.filter(ImageFilter.UnsharpMask(radius=0.55, percent=135, threshold=2))
    return icon


def small_desktop_glyph(size: int) -> Image.Image:
    """Draw a high-contrast, pixel-aligned brand glyph for the Windows taskbar."""
    # Draw at the final pixel size. Supersampling looks polished at large sizes but
    # introduces gray transition pixels in the 24 px Windows 11 taskbar slot.
    extent = size
    icon = Image.new("RGBA", (extent, extent))
    draw = ImageDraw.Draw(icon)
    teal = "#087568"
    ivory = "#FFFCF2"
    mint = "#9ED4AE"

    pad = max(1, round(size * 0.055))
    draw.rounded_rectangle(
        (pad, pad, extent - pad - 1, extent - pad - 1),
        radius=round(size * 0.22),
        fill=teal,
    )

    # A single bold ECG is the taskbar identity. The full journal illustration is
    # reserved for larger frames where its detail can actually be perceived.
    points = [
        (0.18, 0.56),
        (0.34, 0.56),
        (0.42, 0.39),
        (0.53, 0.72),
        (0.63, 0.47),
        (0.71, 0.56),
        (0.82, 0.56),
    ]
    ecg_width = max(2, round(size * 0.10))
    scaled_points = [(round(x * extent), round(y * extent)) for x, y in points]
    draw.line(
        scaled_points,
        fill=ivory,
        width=ecg_width,
        joint="curve",
    )
    radius = ecg_width // 2
    for x, y in (scaled_points[0], scaled_points[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=ivory)

    # A tiny axis-aligned leaf survives at 40/48 px; below that it becomes visual noise.
    if size >= 40:
        leaf_points = [
            (round(size * 0.67), round(size * 0.25)),
            (round(size * 0.78), round(size * 0.15)),
            (round(size * 0.84), round(size * 0.16)),
            (round(size * 0.83), round(size * 0.23)),
            (round(size * 0.73), round(size * 0.29)),
        ]
        draw.polygon(leaf_points, fill=mint)
    return icon


def save_ico(images: list[Image.Image], destination: Path) -> None:
    """Write an ICO with independently rendered PNG frames (Pillow otherwise re-resizes one frame)."""
    payloads: list[bytes] = []
    for image in images:
        output = BytesIO()
        image.save(output, format="PNG", optimize=True)
        payloads.append(output.getvalue())

    header_size = 6 + 16 * len(images)
    offset = header_size
    entries = []
    for image, payload in zip(images, payloads):
        width = 0 if image.width == 256 else image.width
        height = 0 if image.height == 256 else image.height
        entries.append(struct.pack("<BBBBHHII", width, height, 0, 0, 1, 32, len(payload), offset))
        offset += len(payload)

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(struct.pack("<HHH", 0, 1, len(images)) + b"".join(entries) + b"".join(payloads))


def generate_android(source: Image.Image) -> None:
    resources = ROOT / "android" / "app" / "src" / "main" / "res"
    adaptive = contain(source, 432, occupied=0.58)
    for density, size in ANDROID_FOREGROUND_SIZES.items():
        adaptive.resize((size, size), Image.Resampling.LANCZOS).save(
            resources / f"mipmap-{density}" / "ic_launcher_foreground.png", optimize=True
        )
    for density, size in ANDROID_LEGACY_SIZES.items():
        square = compose(source, size, occupied=0.64)
        square.save(resources / f"mipmap-{density}" / "ic_launcher.png", optimize=True)
        mask = Image.new("L", (size, size))
        ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
        square.putalpha(mask)
        square.save(resources / f"mipmap-{density}" / "ic_launcher_round.png", optimize=True)


def generate_windows_and_desktop(source: Image.Image) -> None:
    icons = ROOT / "src-tauri" / "icons"
    frames = [small_icon(source, size) for size in WINDOWS_SIZES]
    save_ico(frames, icons / "icon.ico")
    compose(source, 32, occupied=0.72).save(icons / "32x32.png", optimize=True)
    compose(source, 128, occupied=0.72).save(icons / "128x128.png", optimize=True)
    desktop_256 = compose(source, 256, occupied=0.72)
    desktop_512 = compose(source, 512, occupied=0.68)
    desktop_256.save(icons / "128x128@2x.png", optimize=True)
    desktop_256.save(icons / "256x256.png", optimize=True)
    desktop_512.save(icons / "icon.png", optimize=True)
    desktop_512.save(icons / "512x512.png", optimize=True)


def generate_ios(source: Image.Image) -> None:
    # App Store icons must be opaque and must not include a pre-applied corner mask.
    destination = ROOT / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset" / "AppIcon-512@2x.png"
    compose(source, 1024, occupied=0.62, rounded=False).convert("RGB").save(destination, optimize=True)


def generate_harmony(source: Image.Image) -> None:
    destination = ROOT / "harmony" / "AppScope" / "resources" / "base" / "media" / "app_icon.png"
    compose(source, 512, occupied=0.64).save(destination, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--platform",
        choices=("all", "android", "harmony", "ios", "desktop"),
        default="all",
        help="Generate one platform family or every platform.",
    )
    platform = parser.parse_args().platform
    with Image.open(SOURCE) as image:
        source = image.convert("RGBA")
        if platform in ("all", "android"):
            generate_android(source)
        if platform in ("all", "desktop"):
            generate_windows_and_desktop(source)
        if platform in ("all", "ios"):
            generate_ios(source)
        if platform in ("all", "harmony"):
            generate_harmony(source)
        if platform == "all":
            compose(source, 512, occupied=0.64).save(SOURCE.with_name("care-journal-icon-preview.png"), optimize=True)
    print(f"Generated {platform} icon assets.")


if __name__ == "__main__":
    main()
