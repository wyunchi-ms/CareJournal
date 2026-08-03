"""Generate the Android splash branding VectorDrawable from outlined Chinese glyphs."""

from pathlib import Path
from xml.sax.saxutils import escape

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


ROOT = Path(__file__).resolve().parents[1]
FONT_PATH = Path("C:/Windows/Fonts/NotoSansSC-VF.ttf")
TEXT_LINES = ["放化疗只是一时", "愿康复如期而至"]
ACCESSIBLE_TEXT = "，".join(TEXT_LINES) + "。"
VIEWPORT_WIDTH = 720
VIEWPORT_HEIGHT = 260
OUTPUT_SVG = ROOT / "design-system" / "assets" / "splash-slogan.svg"
OUTPUT_VECTOR = ROOT / "android" / "app" / "src" / "main" / "res" / "drawable" / "splash_branding.xml"


def create_paths() -> list[str]:
    font = instantiateVariableFont(TTFont(FONT_PATH), {"wght": 560}, inplace=True)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    units_per_em = font["head"].unitsPerEm
    paths: list[str] = []

    for line, baseline_y in zip(TEXT_LINES, (88, 190)):
        glyphs = [glyph_set[cmap[ord(character)]] for character in line]
        total_advance = sum(glyph.width for glyph in glyphs)
        scale = min(54 / units_per_em, 640 / total_advance)
        cursor_x = (VIEWPORT_WIDTH - total_advance * scale) / 2
        for glyph in glyphs:
            path_pen = SVGPathPen(glyph_set)
            transformed = TransformPen(path_pen, (scale, 0, 0, -scale, cursor_x, baseline_y))
            glyph.draw(transformed)
            paths.append(path_pen.getCommands())
            cursor_x += glyph.width * scale

    return paths


def main() -> None:
    paths = create_paths()
    svg_paths = "\n".join(f'  <path fill="#6D5A52" d="{path_data}"/>' for path_data in paths)
    vector_paths = "\n".join(
        f'    <path android:fillColor="#6D5A52" android:pathData="{path_data}" />'
        for path_data in paths
    )
    OUTPUT_SVG.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_VECTOR.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_SVG.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VIEWPORT_WIDTH} {VIEWPORT_HEIGHT}" '
        f'width="320" height="116" role="img" aria-label="{escape(ACCESSIBLE_TEXT)}">\n'
        f'{svg_paths}\n'
        '</svg>\n',
        encoding="utf-8",
    )
    OUTPUT_VECTOR.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    android:width="320dp"\n'
        '    android:height="116dp"\n'
        f'    android:viewportWidth="{VIEWPORT_WIDTH}"\n'
        f'    android:viewportHeight="{VIEWPORT_HEIGHT}">\n'
        f'{vector_paths}\n'
        '</vector>\n',
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
