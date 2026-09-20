#!/usr/bin/env python3
"""Static checks for the AlphaLikes add-on assets.

These guard invariants that Zotero only surfaces at runtime, where a mistake is
invisible: a broken preference pane renders as an empty settings page, and a
dialog whose script runs before its markup exists renders as a blank window.
Both shipped once; this script is what stops that happening again.

Run with `npm run check:addon`.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
ADDON = ROOT / "addon"
CONTENT = ADDON / "content"
LOCALES = ADDON / "locale"

failures: list[str] = []
checks = 0


def check(condition: bool, message: str) -> bool:
    global checks
    checks += 1
    if not condition:
        failures.append(message)
    return condition


def read(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# 1. Preference pane markup
# ---------------------------------------------------------------------------

pane = CONTENT / "preferences.xhtml"
pane_text = read(pane)

# Zotero loads panes with MozXULElement.parseXULToFragment(), which wraps the
# markup in a <div> before handing it to an XML parser. An XML declaration is
# only legal at the very start of a document, so inside that wrapper it is a
# syntax error and the whole pane fails to load.
check(
    not re.search(r"<\?xml\b", pane_text),
    "preferences.xhtml must not contain an XML declaration: it is parsed as a "
    "fragment, where '<?xml ...?>' is a syntax error and leaves the pane blank",
)

# Well-formedness of the fragment, wrapped the way Zotero wraps it.
wrapped = (
    '<wrapper xmlns="http://www.w3.org/ns/xul" '
    'xmlns:html="http://www.w3.org/1999/xhtml">' + pane_text + "</wrapper>"
)
try:
    pane_root = ET.fromstring(wrapped)
    pane_ok = True
except ET.ParseError as exc:
    pane_ok = False
    print(f"  parse error in preferences.xhtml: {exc}")
check(pane_ok, "preferences.xhtml must be well-formed XML when wrapped in a root element")

# A pane that renders nothing usually means an empty root element.
if pane_ok:
    check(
        len(list(pane_root)) > 0,
        "preferences.xhtml root element has no children, so the pane would be empty",
    )

# `preference` attributes are rewritten by the build to full pref names, so the
# short names must match keys that actually exist in addon/prefs.js.
prefs_js = read(ADDON / "prefs.js")
declared_prefs = set(re.findall(r'pref\(\s*"([A-Za-z0-9_]+)"', prefs_js))
used_prefs = set(re.findall(r'preference="([A-Za-z0-9_.]+)"', pane_text))
missing = {p for p in used_prefs if "." not in p and p not in declared_prefs}
check(
    not missing,
    f"preferences.xhtml binds preferences that addon/prefs.js never declares: {sorted(missing)}",
)

# ---------------------------------------------------------------------------
# 2. Picker dialog
# ---------------------------------------------------------------------------

picker = CONTENT / "arxiv-picker.xhtml"
picker_text = read(picker)
picker_js = read(CONTENT / "arxiv-picker.js")

# A classic <script> runs while the document is still being parsed, so any
# element it looks up must already be in the tree when it executes.
try:
    picker_root = ET.fromstring(picker_text)
    picker_ok = True
except ET.ParseError as exc:
    picker_ok = False
    print(f"  parse error in arxiv-picker.xhtml: {exc}")
check(picker_ok, "arxiv-picker.xhtml must be well-formed XML")

if picker_ok:
    children = list(picker_root)
    scripts = [i for i, el in enumerate(children) if el.tag.endswith("script")]
    if scripts:
        last_script = scripts[-1]
        after = children[last_script + 1 :]
        check(
            not after,
            "the <script> in arxiv-picker.xhtml must be the last child of <window>, "
            "otherwise it runs before the elements it looks up exist",
        )

    markup_ids = {el.get("id") for el in picker_root.iter() if el.get("id")}
    looked_up = set(re.findall(r'getElementById\(\s*"([^"]+)"', picker_js))
    looked_up |= set(re.findall(r'byId\(\s*"([^"]+)"', picker_js))
    absent = looked_up - markup_ids
    check(
        not absent,
        f"arxiv-picker.js looks up ids that arxiv-picker.xhtml does not define: {sorted(absent)}",
    )

# ---------------------------------------------------------------------------
# 3. Manifest icons
# ---------------------------------------------------------------------------

manifest_template = read(ADDON / "manifest.json")
# The manifest carries build placeholders, so only the static keys are read.
try:
    manifest = json.loads(
        re.sub(r'"__[A-Za-z]+__"', '"placeholder"', manifest_template)
    )
    manifest_ok = True
except json.JSONDecodeError as exc:
    manifest_ok = False
    print(f"  parse error in manifest.json: {exc}")
check(manifest_ok, "addon/manifest.json must be valid JSON")

if manifest_ok:
    icons = manifest.get("icons", {})
    check(bool(icons), "addon/manifest.json declares no icons")
    for size, rel in icons.items():
        # The preferences sidebar draws the pane icon through a XUL <image>,
        # which takes its size from the image itself. Vector files with only a
        # viewBox have no intrinsic size and would draw nothing.
        is_raster = rel.lower().endswith((".png", ".jpg", ".jpeg", ".gif"))
        check(
            is_raster,
            f"manifest icon {rel!r} must be a raster image: SVG icons without an "
            "intrinsic width/height render as nothing in the preferences sidebar",
        )

        icon_path = ADDON / rel
        if not check(
            icon_path.exists(), f"manifest icon {rel!r} does not exist at {icon_path}"
        ):
            continue

        # Only a raster file can be size-checked, and Pillow may not be
        # installed. A missing Pillow is not a failure: existence was already
        # verified above and the format was covered by the check just before.
        if not is_raster:
            continue
        try:
            from PIL import Image  # type: ignore
        except ImportError:
            continue
        try:
            with Image.open(icon_path) as im:
                check(
                    im.size[0] > 0 and im.size[1] > 0,
                    f"manifest icon {rel!r} has no intrinsic size",
                )
        except Exception as exc:  # noqa: BLE001 - report, never crash
            check(False, f"manifest icon {rel!r} could not be read: {exc}")

# ---------------------------------------------------------------------------
# 4. Locale parity and message coverage
# ---------------------------------------------------------------------------

MESSAGE_RE = re.compile(r"^([A-Za-z0-9_-]+)\s*=", re.MULTILINE)
locale_ids: dict[str, set[str]] = {}
for locale_dir in sorted(p for p in LOCALES.iterdir() if p.is_dir()):
    ftl = locale_dir / "addon.ftl"
    if not ftl.exists():
        failures.append(f"locale {locale_dir.name} has no addon.ftl")
        continue
    locale_ids[locale_dir.name] = set(MESSAGE_RE.findall(read(ftl)))

check(bool(locale_ids), "no locale files found under addon/locale")

if len(locale_ids) > 1:
    reference_name = "en-US" if "en-US" in locale_ids else sorted(locale_ids)[0]
    reference = locale_ids[reference_name]
    for name, ids in locale_ids.items():
        if name == reference_name:
            continue
        check(
            ids == reference,
            f"locale {name} differs from {reference_name}: "
            f"missing={sorted(reference - ids)} extra={sorted(ids - reference)}",
        )

l10n_ts = read(ROOT / "src" / "modules" / "l10n.ts")
# Keys of the MESSAGES object literal.
messages_block = l10n_ts.split("export const MESSAGES = {", 1)
if len(messages_block) == 2:
    body = messages_block[1].split("} as const;", 1)[0]
    message_ids = set(re.findall(r'^\s*"([A-Za-z0-9_-]+)":', body, re.MULTILINE))
else:
    message_ids = set()
check(bool(message_ids), "could not read the MESSAGES table from src/modules/l10n.ts")

for name, ids in locale_ids.items():
    absent = message_ids - ids
    check(
        not absent,
        f"locale {name} is missing {len(absent)} message(s) used by src/modules/l10n.ts: "
        f"{sorted(absent)}",
    )

# Every t("id") call site must name a known message, otherwise the UI shows the
# raw id.
used_ids: set[str] = set()
for ts in (ROOT / "src").rglob("*.ts"):
    used_ids |= set(re.findall(r'\bt\(\s*"([A-Za-z0-9_-]+)"', read(ts)))
unknown = used_ids - message_ids
check(
    not unknown,
    f"src calls t() with ids that MESSAGES does not define: {sorted(unknown)}",
)

# ---------------------------------------------------------------------------
# 5. Preferences declared in code vs. shipped defaults
# ---------------------------------------------------------------------------

prefs_ts = read(ROOT / "src" / "modules" / "prefs.ts")
defaults_block = prefs_ts.split("export const PREF_DEFAULTS = {", 1)
if len(defaults_block) == 2:
    body = defaults_block[1].split("} as const;", 1)[0]
    code_prefs = set(re.findall(r"^\s*([A-Za-z0-9_]+):", body, re.MULTILINE))
else:
    code_prefs = set()
check(bool(code_prefs), "could not read PREF_DEFAULTS from src/modules/prefs.ts")

only_in_code = code_prefs - declared_prefs
only_in_js = declared_prefs - code_prefs
check(
    not only_in_code,
    f"PREF_DEFAULTS lists preferences that addon/prefs.js does not ship a default for: "
    f"{sorted(only_in_code)}",
)
check(
    not only_in_js,
    f"addon/prefs.js declares preferences that PREF_DEFAULTS does not know about: "
    f"{sorted(only_in_js)}",
)

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

if failures:
    print(f"\ncheck-addon: {len(failures)} problem(s) in {checks} checks\n")
    for message in failures:
        print(f"  ✗ {message}")
    sys.exit(1)

print(f"check-addon: {checks} checks passed")
