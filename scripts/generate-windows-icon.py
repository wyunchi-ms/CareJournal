from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "android" / "app" / "src" / "main" / "res" / "mipmap-xxxhdpi" / "ic_launcher.png"
TARGET = ROOT / "src-tauri" / "icons" / "icon.ico"


def main() -> None:
    with Image.open(SOURCE) as source:
        icon = source.convert("RGBA").resize((256, 256), Image.Resampling.LANCZOS)
        TARGET.parent.mkdir(parents=True, exist_ok=True)
        icon.save(TARGET, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


if __name__ == "__main__":
    main()
