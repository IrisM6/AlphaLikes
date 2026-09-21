#!/usr/bin/env python3
"""Regenerate docs/styles-preview.html from the plugin's own sources.

The page is a visual index of the display styles, and it has to show the same
colours the columns use, otherwise it is worse than useless. So nothing in it
is typed twice:

  * the style list and their order come from the pane (``pref-style-*`` items
    in ``addon/content/preferences.xhtml``);
  * the names come from both locale files;
  * the high / mid / low colours come from ``PALETTES`` in ``column.ts``;
  * the split-tag prefixes come from the ``cell-split-prefix*`` messages.

Only the shape of each sample (padding, radii, shadows, fonts) is written out
here by hand, mirroring the branches of ``applyLikeStyle``. Run:

    python3 scripts/gen-styles-preview.py

and commit the result along with the change that motivated it.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
COLUMN_TS = ROOT / "src/modules/column.ts"
PREFS_TS = ROOT / "src/modules/prefs.ts"
PANE = ROOT / "addon/content/preferences.xhtml"
FTLS = {
    "zh": ROOT / "addon/locale/zh-CN/addon.ftl",
    "en": ROOT / "addon/locale/en-US/addon.ftl",
}
OUT = ROOT / "docs/styles-preview.html"

# The colour section's own three buckets, used to draw the styles that have no
# palette of their own. Mirrors the defaults in prefs.ts.
SECTION = {"high": "#1a7f37", "mid": "currentColor", "low": "#9aa0a6"}
# A long high-band number documents that the round styles widen into a
# stadium for four digits instead of clipping, and that the dot style prints
# the number in full.
LIKE_SAMPLE = {"high": "2979", "mid": "42", "low": "7"}
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
    """PALETTES from column.ts: style -> band -> {background,color,border}."""
    src = read(COLUMN_TS)
    block = re.search(r"const PALETTES[^{]*\{(.*?)\n\};", src, re.S)
    if not block:
        sys.exit("could not find PALETTES in column.ts")
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
    <title>AlphaLikes 外观样式一览 / Appearance styles</title>
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
    <h1 style="margin: 0 0 4px; font-size: 20px">AlphaLikes 外观样式一览</h1>
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


if __name__ == "__main__":
    main()
