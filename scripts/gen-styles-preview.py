#!/usr/bin/env python3
"""Regenerate docs/styles-preview.html from the plugin's own sources.

The page is a visual index of the display styles, and it has to show the same
colours the columns use, otherwise it is worse than useless. So nothing in it
is typed twice:

  * the style list and their order come from the pane (``pref-style-*`` items
    in ``addon/content/preferences.xhtml``);
  * the names come from both locale files;
  * the high / mid / low colours come from ``PALETTES`` in ``palette.ts``;
  * the split-tag prefixes come from the ``cell-split-prefix*`` messages.

Only the shape of each sample (padding, radii, shadows, fonts) is written out
here by hand, mirroring the branches of ``applyLikeStyle``.

The README image is rasterised with ``rsvg-convert`` when it is installed
(``librsvg2-bin``), because ImageMagick's built-in SVG renderer drops strokes -
and a badge is mostly its border. Without it the SVG is still written and the
PNG falls back to ImageMagick. Run:

    python3 scripts/gen-styles-preview.py

and commit the result along with the change that motivated it.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
COLUMN_TS = ROOT / "src/modules/column.ts"
PALETTE_TS = ROOT / "src/modules/palette.ts"
PREFS_TS = ROOT / "src/modules/prefs.ts"
PANE = ROOT / "addon/content/preferences.xhtml"
FTLS = {
    "zh": ROOT / "addon/locale/zh-CN/addon.ftl",
    "en": ROOT / "addon/locale/en-US/addon.ftl",
}
OUT = ROOT / "docs/styles-preview.html"
# The same styles as a picture, for the README (and the marketplace page).
IMAGE = ROOT / "docs/images/styles-preview.svg"
IMAGE_PNG = ROOT / "docs/images/styles-preview.png"

# The colour section's own three buckets, used to draw the styles that have no
# palette of their own. Mirrors the defaults in prefs.ts.
SECTION = {"high": "#1a7f37", "mid": "currentColor", "low": "#9aa0a6"}
# A long high-band number documents that the round styles widen into a
# stadium for four digits instead of clipping, and that the dot style prints
# the number in full.
LIKE_SAMPLE = {"high": "2979", "mid": "42", "low": "7"}
# The ring and the badge are the two styles people mix up - both are pill-shaped
# at four digits, and the difference is what happens below that. The image gives
# the ring a three-digit high sample so the row shows a circle next to the
# badge's pill, which is the whole distinction. The HTML page keeps 2979 for
# both, because there it is documenting the widening.
IMAGE_SAMPLE = {"ring": {"high": "999", "mid": "42", "low": "7"}}
CITATION_SAMPLE = {"high": "128", "mid": "42", "low": "3"}


def read(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8")


def parse_styles() -> list[str]:
    """The styles offered by the likes menu.

    Scoped to that one menulist on purpose: the Citations column offers the same
    eleven styles through a second menu, and counting both would double the
    list.
    """
    pane = read(PANE)
    menu = re.search(
        r'id="alphalikes-pref-style".*?</menulist>', pane, re.DOTALL
    )
    if not menu:
        sys.exit("could not find the style menu in the settings pane")
    return re.findall(r'data-l10n-id="pref-style-([a-z]+)"', menu.group(0))


def parse_labels() -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for lang, path in FTLS.items():
        ftl = read(path)
        labels = dict(
            re.findall(r"^pref-style-([a-z]+) =\n\s+\.label = (.+)$", ftl, re.M)
        )
        out[lang] = {k: v.strip() for k, v in labels.items()}
    return out


def parse_palettes() -> dict[str, dict[str, dict[str, str]]]:
    """PALETTES from palette.ts: style -> band -> {background,color,border}."""
    src = read(PALETTE_TS)
    block = re.search(r"export const PALETTES[^{]*\{(.*?)\n\};", src, re.S)
    if not block:
        sys.exit("could not find PALETTES in palette.ts")
    palettes: dict[str, dict[str, dict[str, str]]] = {}
    for style, body in re.findall(r"^\s{2}([a-z]+): \{(.*?)^\s{2}\},", block.group(1), re.S | re.M):
        bands: dict[str, dict[str, str]] = {}
        for band, line in re.findall(r"^\s{4}(high|mid|low): \{(.*?)\},", body, re.M):
            bands[band] = dict(re.findall(r'(\w+): "([^"]+)"', line))
        palettes[style] = bands
    return palettes


def parse_const(name: str) -> str:
    m = re.search(rf'const {name} = "([^"]+)";', read(COLUMN_TS))
    if not m:
        sys.exit(f"could not find {name} in column.ts")
    return m.group(1)


def parse_prefix(key: str, lang: str = "zh") -> str:
    m = re.search(rf"^{key} = (.+)$", read(FTLS[lang]), re.M)
    return m.group(1).strip() if m else ""


def short_name(label: str) -> str:
    """Drop the parenthesised detail: it is explained by the sample itself."""
    return re.split(r"[（(]", label)[0].strip()


def translucent(color: str, percent: int) -> str:
    base = color.strip() or "currentColor"
    return f"color-mix(in srgb, {base} {percent}%, transparent)"


def css(pairs: list[tuple[str, str | None]]) -> str:
    body = " ".join(f"{k}: {v};" for k, v in pairs if v)
    return f'style="{body}"'


def escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def sample(
    style: str,
    band: str,
    palettes: dict[str, dict[str, dict[str, str]]],
    accent: str,
    prefix: str,
    text: str,
) -> str:
    """The inner HTML of one sample, mirroring applyLikeStyle."""
    if style == "plain":
        return f"<span>{text}</span>"

    if style == "badge":
        attrs = css(
            [
                ("padding", "1px 8px"),
                ("border-radius", "999px"),
                ("background", translucent(accent, 16)),
                ("border", f"1px solid {translucent(accent, 36)}"),
                ("color", accent),
            ]
        )
        return f"<span {attrs}>{text}</span>"

    if style == "ring":
        attrs = css(
            [
                ("display", "inline-flex"),
                ("align-items", "center"),
                ("justify-content", "center"),
                ("min-width", "22px"),
                ("height", "22px"),
                ("padding", "0 4px"),
                ("border-radius", "50%" if len(text) <= 3 else "999px"),
                ("box-sizing", "border-box"),
                ("background", translucent(accent, 18)),
                ("border", f"1px solid {translucent(accent, 45)}"),
                (
                    "box-shadow",
                    "inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 1px 2px rgba(0, 0, 0, 0.16)",
                ),
                ("font-size", "0.85em" if len(text) >= 4 else None),
                ("color", accent),
            ]
        )
        return f"<span {attrs}>{text}</span>"

    if style == "outline":
        attrs = css(
            [
                ("padding", "1px 8px"),
                ("border-radius", "999px"),
                ("background", "transparent"),
                ("border", f"1px solid {accent or '#9AA0A6'}"),
                ("color", accent or "#5F6368"),
            ]
        )
        return f"<span {attrs}>{text}</span>"

    if style == "bookmark":
        paint = palettes["bookmark"][band]
        attrs = css(
            [
                ("padding", "1px 8px 1px 7px"),
                ("border-radius", "0 4px 4px 0"),
                ("background", paint.get("background")),
                ("color", paint.get("color")),
                ("border", f"1px solid {paint.get('border', 'transparent')}"),
                ("border-left-width", "3px"),
            ]
        )
        return f"<span {attrs}>{text}</span>"

    if style in ("morandi", "academic", "fresh", "playful"):
        paint = palettes[style][band]
        radius = {
            "morandi": "999px",
            "fresh": "999px",
            "academic": "3px",
            "playful": "6px",
        }[style]
        shadow = None
        if style == "fresh":
            shadow = "0 2px 4px rgba(0, 0, 0, 0.05)"
        elif style == "playful":
            shadow = "none" if band == "low" else "2px 2px 0 #000000"
        attrs = css(
            [
                ("padding", "0 6px" if style == "academic" else "1px 8px"),
                ("border-radius", radius),
                ("background", paint.get("background")),
                ("color", paint.get("color")),
                ("border", f"1px solid {paint['border']}" if paint.get("border") else "none"),
                ("font-variant-numeric", "tabular-nums" if style == "academic" else None),
                ("font-weight", "500" if style == "academic" else ("700" if style == "playful" else None)),
                ("box-shadow", shadow),
            ]
        )
        return f"<span {attrs}>{text}</span>"

    if style == "split":
        left = palettes["split"][band]
        right = {"high": "#F0F0F0", "mid": "#F5F5F5", "low": "#FAFAFA"}[band]
        outer = css(
            [
                ("display", "inline-flex"),
                ("align-items", "stretch"),
                ("border-radius", "4px"),
                ("overflow", "hidden"),
                ("font-variant-numeric", "tabular-nums"),
            ]
        )
        left_attrs = css(
            [
                ("padding", "1px 6px"),
                ("background", left.get("background")),
                ("color", left.get("color")),
                ("font-size", "0.8em"),
                ("display", "inline-flex"),
                ("align-items", "center"),
            ]
        )
        right_attrs = css(
            [
                ("padding", "1px 7px"),
                ("background", right),
                ("color", "#333333"),
            ]
        )
        return (
            f"<span {outer}><span {left_attrs}>{escape(prefix)}</span>"
            f"<span {right_attrs}>{text}</span></span>"
        )

    if style == "dot":
        paint = palettes["dot"][band]
        shown = text
        attrs = css(
            [
                ("display", "inline-flex"),
                ("align-items", "center"),
                ("justify-content", "center"),
                ("min-width", "18px"),
                ("height", "18px"),
                ("padding", "0 5px"),
                ("box-sizing", "border-box"),
                ("border-radius", "50%" if len(shown) <= 2 else "999px"),
                ("background", paint.get("background")),
                ("color", paint.get("color")),
                ("font-size", "0.8em"),
                ("font-weight", "600"),
            ]
        )
        return f"<span {attrs}>{shown}</span>"

    return f"<span>{text}</span>"


def row(
    style: str,
    labels: dict[str, dict[str, str]],
    palettes: dict[str, dict[str, dict[str, str]]],
    prefix_like: str,
    prefix_cite: str,
    values: dict[str, str],
    citations: bool,
) -> str:
    zh = short_name(labels["zh"].get(style, style))
    en = short_name(labels["en"].get(style, style))
    source = (
        "样式自带配色" if style in palettes else "跟随「颜色」一节"
    )
    cells = []
    for band in ("high", "mid", "low"):
        if citations:
            accent = SECTION[band] if band == "high" else ("currentColor" if band == "mid" else SECTION["low"])
            text = values[band] + ("▲" if band == "high" else "")
        else:
            accent = SECTION[band]
            text = values[band]
        inner = sample(
            style,
            band,
            palettes,
            accent,
            prefix_cite if citations else prefix_like,
            text,
        )
        cells.append(f'          <td style="padding: 6px 10px">{inner}</td>')
    head = (
        f"          <th scope=\"row\" style=\"text-align: left; padding: 6px 10px; font-weight: 600\">\n"
        f"            {escape(zh)}\n"
        f'            <div style="font-weight: 400; opacity: 0.6; font-size: 0.85em">\n'
        f"              {escape(en)}\n"
        f"            </div>\n"
        f"          </th>"
    )
    return "\n".join(
        [
            "        <tr>",
            head,
            f'          <td style="padding: 6px 10px; opacity: 0.75; font-size: 0.9em">{source}</td>',
            *cells,
            "        </tr>",
        ]
    )


def table(
    header: str,
    styles: list[str],
    labels: dict[str, dict[str, str]],
    palettes: dict[str, dict[str, dict[str, str]]],
    prefix_like: str,
    prefix_cite: str,
    values: dict[str, str],
    citations: bool,
) -> str:
    rows = "\n".join(
        row(
            style,
            labels,
            palettes,
            prefix_like,
            prefix_cite,
            values,
            citations,
        )
        for style in styles
    )
    return f"""    <h2 style="margin: 24px 0 6px; font-size: 16px">{header}</h2>
    <table style="border-collapse: collapse; width: 100%; max-width: 860px">
      <thead>
        <tr style="text-align: left; border-bottom: 2px solid #d0d7de">
          <th style="padding: 6px 10px">样式</th>
          <th style="padding: 6px 10px">配色来源</th>
          <th style="padding: 6px 10px">高</th>
          <th style="padding: 6px 10px">中</th>
          <th style="padding: 6px 10px">低</th>
        </tr>
      </thead>
      <tbody>
{rows}
      </tbody>
    </table>"""


# ---------------------------------------------------------------------------
# The README image
# ---------------------------------------------------------------------------
#
# The point of this second output is that the README can show what the styles
# look like without sending anyone to the HTML page. It is built from the same
# four sources as the page (style list, labels, palettes, prefixes), so it
# cannot show a style the plugin does not offer or a colour it does not use -
# but the shapes are written out here a second time, as SVG primitives, because
# a rasterised box has to know its own pixel geometry. Keep this table and the
# branches in ``sample()`` in step: they are two renderings of one design.

# The stack is ordered for the three places this file is read: a browser on
# macOS or Windows (system UI, then the two CJK families those systems ship), a
# Linux desktop, and the rasteriser that makes the README's PNG. `Noto Sans CJK
# JP` is in the list because that is the family name fontconfig reports for the
# Noto CJK collection that Linux distributions install - without it, the
# renderer that honours strokes best draws every Chinese glyph as a blank.
SVG_FONT = (
    "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', "
    "'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans CJK JP', "
    "'Noto Sans SC', sans-serif"
)
# What `currentColor` resolves to wherever the sample is not inside a coloured
# column (the mid band of a style with no palette of its own).
CURRENT = "#1f2328"
INK = "#1f2328"
MUTED = "#57606a"
FAINT = "#8b949e"

# Per style: box kind, corner radius, horizontal padding, font size, weight and
# whether the box is drawn from the style's own palette or from the band colour.
SHAPES: dict[str, dict[str, object]] = {
    "plain": {"kind": "none"},
    "badge": {"kind": "box", "radius": 10, "pad": 8, "size": 13, "round": 10},
    "ring": {"kind": "circle", "diameter": 22, "pad": 4, "size": 11},
    "outline": {"kind": "box", "radius": 10, "pad": 8, "size": 13},
    "bookmark": {"kind": "bookmark", "radius": 4, "pad": 8, "size": 13},
    "morandi": {"kind": "box", "radius": 10, "pad": 8, "size": 13},
    "academic": {"kind": "box", "radius": 3, "pad": 6, "size": 13},
    "fresh": {"kind": "box", "radius": 10, "pad": 8, "size": 13},
    "playful": {"kind": "box", "radius": 6, "pad": 8, "size": 13, "shadow": True},
    "split": {"kind": "split", "radius": 4, "pad": 6, "size": 13},
    "dot": {"kind": "dot", "diameter": 18, "pad": 5, "size": 10.5},
}


def ink(color: str | None, fallback: str = INK) -> str:
    """A colour usable in SVG: `currentColor` and blanks become something."""
    if not color or color == "currentColor":
        return fallback
    return color


def alpha(hex_color: str, factor: float) -> str:
    """`#rrggbb` at an alpha, as the `rgba()` an SVG rasteriser understands."""
    value = hex_color.lstrip("#")
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    try:
        r, g, b = (int(value[i : i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return hex_color
    return f"rgba({r}, {g}, {b}, {factor:.2f})"


def text_width(text: str, size: float) -> float:
    """A rough advance width: enough to size a pill, not typography."""
    total = 0.0
    for char in text:
        if char.isspace():
            total += size * 0.28
        elif ord(char) > 0x2E80:
            total += size
        elif char.isdigit():
            total += size * 0.56
        else:
            total += size * 0.52
    return total


def svg_text(x: float, y: float, text: str, size: float, fill: str, weight: int = 400) -> str:
    """Text centred on (x, y).

    The baseline is worked out here rather than handed to `dominant-baseline`:
    the value a rasteriser chooses for "middle" varies, and a sample that sits
    two pixels high in a 20 px pill is the difference between "this is what the
    column looks like" and "this is a drawing of it".
    """
    baseline = y + size * 0.35
    return (
        f'<text x="{x:.1f}" y="{baseline:.1f}" font-family="{SVG_FONT}" '
        f'font-size="{size}" font-weight="{weight}" fill="{fill}" '
        f'text-anchor="middle">{escape(text)}</text>'
    )


def svg_chip(
    style: str,
    band: str,
    palettes: dict[str, dict[str, dict[str, str]]],
    accent: str,
    prefix: str,
    text: str,
    cx: float,
    cy: float,
) -> tuple[list[str], float]:
    """One sample chip, centred on (cx, cy); returns its parts and its width."""
    accent = ink(accent)
    shape = SHAPES.get(style, {"kind": "none"})
    kind = shape.get("kind")
    size = float(shape.get("size", 13))
    pad = float(shape.get("pad", 8))

    if kind == "none":
        width = text_width(text, size)
        return [svg_text(cx, cy, text, size, accent)], width

    if kind == "circle":
        diameter = float(shape["diameter"])
        width = diameter if len(text) <= 3 else max(diameter, text_width(text, size) + pad * 2)
        height = diameter
        return (
            [
                f'<rect x="{cx - width / 2:.1f}" y="{cy - height / 2:.1f}" '
                f'width="{width:.1f}" height="{height:.1f}" rx="{height / 2:.1f}" '
                f'fill="{alpha(accent, 0.18)}" stroke="{alpha(accent, 0.45)}" stroke-width="1"/>',
                svg_text(cx, cy, text, size, accent),
            ],
            width,
        )

    if kind == "dot":
        diameter = float(shape["diameter"])
        width = diameter if len(text) <= 2 else max(diameter, text_width(text, size) + pad * 2)
        height = diameter
        paint = palettes["dot"][band]
        return (
            [
                f'<rect x="{cx - width / 2:.1f}" y="{cy - height / 2:.1f}" '
                f'width="{width:.1f}" height="{height:.1f}" rx="{height / 2:.1f}" '
                f'fill="{ink(paint.get("background"))}"/>',
                svg_text(cx, cy, text, size, ink(paint.get("color"), "#ffffff"), 600),
            ],
            width,
        )

    if kind == "split":
        # The left half is the band colour and carries the label, the right half
        # is the number on a light plate - one pill, two fills.
        left = palettes["split"][band]
        right = {"high": "#F0F0F0", "mid": "#F5F5F5", "low": "#FAFAFA"}[band]
        label = prefix
        left_width = text_width(label, size * 0.8) + pad * 2
        right_width = text_width(text, size) + pad * 2 + 2
        width = left_width + right_width
        height = 20
        x = cx - width / 2
        y = cy - height / 2
        parts = [
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{width:.1f}" height="{height}" '
            f'rx="{shape["radius"]} " fill="{ink(right)}"/>',
            f'<path d="M {x + shape["radius"]:.1f} {y:.1f} H {x + left_width:.1f} V {y + height} '
            f'H {x + shape["radius"]:.1f} A {shape["radius"]} {shape["radius"]} 0 0 1 {x:.1f} '
            f'{y + height - shape["radius"]:.1f} V {y + shape["radius"]:.1f} '
            f'A {shape["radius"]} {shape["radius"]} 0 0 1 {x + shape["radius"]:.1f} {y:.1f} Z" '
            f'fill="{ink(left.get("background"))}"/>',
            svg_text(x + left_width / 2, cy, label, size * 0.8, ink(left.get("color"), "#ffffff")),
            svg_text(x + left_width + right_width / 2, cy, text, size, "#333333"),
        ]
        return parts, width

    # Everything else is a box: filled from the style's own palette when it has
    # one, and otherwise a translucent wash of the band colour.
    own = palettes.get(style, {}).get(band)
    radius = float(shape.get("radius", 4))
    width = text_width(text, size) + pad * 2
    height = 20
    x = cx - width / 2
    y = cy - height / 2
    parts: list[str] = []

    if own:
        background = ink(own.get("background"), "#ffffff")
        colour = ink(own.get("color"))
        border = own.get("border")
    elif style == "outline":
        background = "none"
        colour = accent
        border = accent
    else:
        background = alpha(accent, 0.16) if style == "badge" else accent
        colour = accent if style == "badge" else "#ffffff"
        border = alpha(accent, 0.36) if style == "badge" else None

    # 活泼明快 drops its offset shadow in the low band - the style is about
    # shouting, and a low number is not shouting.
    if shape.get("shadow") and band != "low":
        # 活泼明快 offsets a solid black copy instead of blurring one.
        parts.append(
            f'<rect x="{x + 2:.1f}" y="{y + 2:.1f}" width="{width:.1f}" height="{height}" '
            f'rx="{radius}" fill="#000000"/>'
        )

    stroke = ink(border) if border else "none"
    parts.append(
        f'<rect x="{x:.1f}" y="{y:.1f}" width="{width:.1f}" height="{height}" '
        f'rx="{radius}" fill="{background}" stroke="{stroke}" stroke-width="1"/>'
    )
    if kind == "bookmark" and border:
        # The left edge is three pixels wide, which is what makes it read as a
        # bookmark rather than a box.
        parts.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="3" height="{height}" fill="{ink(border)}"/>'
        )
    parts.append(svg_text(cx, cy, text, size, colour, 500))
    return parts, width


def build_svg(
    styles: list[str],
    labels: dict[str, dict[str, str]],
    palettes: dict[str, dict[str, dict[str, str]]],
    prefix_like: str,
) -> str:
    row_height = 50
    top = 92
    width = 900
    height = top + row_height * len(styles) + 24
    columns = {"high": 430.0, "mid": 620.0, "low": 790.0}

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">',
        f'<rect width="{width}" height="{height}" fill="#ffffff"/>',
        f'<text x="24" y="34" font-family="{SVG_FONT}" font-size="17" '
        f'font-weight="600" fill="{INK}">AlphaPulse 外观样式（{len(styles)} 种）</text>',
        f'<text x="24" y="56" font-family="{SVG_FONT}" font-size="12" '
        f'fill="{MUTED}">点赞列与引用列通用 · 高 / 中 / 低三档用同一种样式 · '
        f"自带配色的样式固定用色，其余跟随设置里的「颜色」一节</text>",
        f'<text x="24" y="78" font-family="{SVG_FONT}" font-size="11" '
        f'fill="{FAINT}">此图由 scripts/gen-styles-preview.py 从插件源码生成，请勿手动编辑</text>',
    ]

    for index, style in enumerate(styles):
        centre = top + row_height * index + row_height / 2
        if index % 2:
            parts.append(
                f'<rect x="0" y="{centre - row_height / 2:.1f}" width="{width}" '
                f'height="{row_height}" fill="#f6f8fa"/>'
            )
        zh_name = short_name(labels["zh"].get(style, style))
        en_name = short_name(labels["en"].get(style, style))
        parts.append(
            f'<text x="24" y="{centre - 4:.1f}" font-family="{SVG_FONT}" font-size="14" '
            f'font-weight="600" fill="{INK}">{escape(zh_name)}</text>'
        )
        parts.append(
            f'<text x="24" y="{centre + 13:.1f}" font-family="{SVG_FONT}" font-size="10.5" '
            f'fill="{FAINT}">{escape(en_name)}</text>'
        )
        values = IMAGE_SAMPLE.get(style, LIKE_SAMPLE)
        for band, cx in columns.items():
            accent = SECTION[band]
            text = values[band]
            chip, _ = svg_chip(style, band, palettes, accent, prefix_like, text, cx, centre)
            parts.extend(chip)

    parts.append("</svg>")
    return "\n".join(part for part in parts if part)


def write_image(
    styles: list[str],
    labels: dict[str, dict[str, str]],
    palettes: dict[str, dict[str, dict[str, str]]],
    prefix_like: str,
) -> None:
    """Writes the README image, PNG included when a rasteriser is around."""
    svg = build_svg(styles, labels, palettes, prefix_like)
    IMAGE.parent.mkdir(parents=True, exist_ok=True)
    IMAGE.write_text(svg + "\n", encoding="utf-8")
    print(f"wrote {IMAGE.relative_to(ROOT)} ({len(svg)} B)")

    # librsvg first: it honours strokes and font stacks the way a browser does.
    try:
        result = subprocess.run(
            [
                "rsvg-convert",
                "-z",
                "2",
                "-b",
                "white",
                "-o",
                str(IMAGE_PNG),
                str(IMAGE),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0 and IMAGE_PNG.exists():
            _shrink(IMAGE_PNG)
            print(f"wrote {IMAGE_PNG.relative_to(ROOT)} ({IMAGE_PNG.stat().st_size} B, rsvg)")
            return
    except FileNotFoundError:
        pass

    # cairosvg is the next best thing when librsvg is missing: it is a real SVG
    # renderer, so strokes survive, which is most of what a badge is.
    try:
        import cairosvg  # type: ignore[import-not-found]

        cairosvg.svg2png(
            url=str(IMAGE),
            write_to=str(IMAGE_PNG),
            scale=2,
            background_color="white",
        )
        if IMAGE_PNG.exists():
            _shrink(IMAGE_PNG)
            print(
                f"wrote {IMAGE_PNG.relative_to(ROOT)} "
                f"({IMAGE_PNG.stat().st_size} B, cairosvg)"
            )
            return
    except Exception:
        pass

    for command in (["magick"], ["convert"]):
        try:
            result = subprocess.run(
                [*command, "-density", "192", str(IMAGE), "-background", "white",
                 "-flatten", "-strip", str(IMAGE_PNG)],
                capture_output=True,
                text=True,
            )
        except FileNotFoundError:
            continue
        if result.returncode == 0 and IMAGE_PNG.exists():
            _shrink(IMAGE_PNG)
            print(
                f"wrote {IMAGE_PNG.relative_to(ROOT)} ({IMAGE_PNG.stat().st_size} B, "
                f"imagemagick - install librsvg2-bin for an exact one)"
            )
            return
    print("no rasteriser found (rsvg-convert/magick/convert): the SVG is committed")


def _shrink(path: pathlib.Path) -> None:
    """Flat art with antialiased text: 8-bit and 256 colours, no metadata.

    Keeps the README image around 60 KB instead of 330 KB, which matters for a
    file that is loaded on every view of the repository page.
    """
    for command in (["magick"], ["convert"]):
        try:
            result = subprocess.run(
                [*command, str(path), "-depth", "8", "-colors", "256", "-strip", str(path)],
                capture_output=True,
                text=True,
            )
        except FileNotFoundError:
            return
        if result.returncode == 0:
            return


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--out",
        type=pathlib.Path,
        default=OUT,
        help="where to write the page (default: the committed one)",
    )
    args = parser.parse_args()

    styles = parse_styles()
    labels = parse_labels()
    palettes = parse_palettes()
    prefix_like = parse_prefix("cell-split-prefix") or "赞"
    prefix_cite = parse_prefix("cell-split-prefix-citations") or "引"

    body = f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>AlphaPulse 外观样式一览 / Appearance styles</title>
  </head>
  <body
    style="
      margin: 0;
      padding: 24px;
      font: 14px/1.6 -apple-system, &quot;Segoe UI&quot;, system-ui,
        &quot;PingFang SC&quot;, &quot;Microsoft YaHei&quot;, sans-serif;
      background: #fff;
      color: #1f2328;
    "
  >
    <h1 style="margin: 0 0 4px; font-size: 20px">AlphaPulse 外观样式一览</h1>
    <p style="margin: 0 0 18px; opacity: 0.7">
      共 {len(styles)} 种样式，点赞列与引用列都会套用。没有自带配色的样式使用「颜色」一节里的
      高/中/低三档（此处用 Zotero 的默认绿色示意）。此页由
      <code>scripts/gen-styles-preview.py</code> 从插件源码生成，请勿手动编辑。
    </p>

{table("点赞列 / Likes column", styles, labels, palettes, prefix_like, prefix_cite, LIKE_SAMPLE, False)}

{table("引用列 / Citations column", styles, labels, palettes, prefix_like, prefix_cite, CITATION_SAMPLE, True)}

    <p style="margin: 18px 0 0; opacity: 0.7">
      引用列的档位来自 OpenAlex 的同领域百分位（前 10% 记作高，即带 ▲ 的那一档），
      不按点赞阈值判断。数字角标样式完整显示数字，位数多时从正圆变成胶囊。
      双色拼接样式左半放「{escape(prefix_like)} / {escape(prefix_cite)}」，右半放数字。
    </p>
  </body>
</html>
"""
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(body, encoding="utf-8")
    try:
        shown = args.out.relative_to(ROOT)
    except ValueError:
        shown = args.out
    print(f"wrote {shown} ({len(body)} B, {len(styles)} styles)")

    if args.out == OUT:
        write_image(styles, labels, palettes, prefix_like)


if __name__ == "__main__":
    main()
