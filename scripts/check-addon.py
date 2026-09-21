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
# 6. Settings pane: Fluent ids, linkset and preference keys
# ---------------------------------------------------------------------------
#
# A `data-l10n-id` that no FTL defines is the failure that blanks the pane:
# Zotero's Fluent reports it, Zotero logs it, and the element keeps whatever it
# had. The id also has to be one the build is able to prefix, which is exactly
# what "exists in a locale" means here.

pane_path = ROOT / "addon" / "content" / "preferences.xhtml"
if pane_path.exists():
    pane = read(pane_path)
    pane_ids = set(re.findall(r'data-l10n-id="([A-Za-z0-9_-]+)"', pane))
    check(bool(pane_ids), "the settings pane carries no data-l10n-id attribute")

    for name, ids in locale_ids.items():
        missing = pane_ids - ids
        check(
            not missing,
            f"locale {name} does not define every id the settings pane uses: "
            f"{sorted(missing)}",
        )

    # Plugin FTLs are matched by file name, not by path, and the build renames
    # the file to <namespace>-<basename>.
    linksets = re.findall(r"<[a-zA-Z:]*link[^>]*rel=\"localization\"[^>]*/>", pane)
    check(
        bool(linksets),
        "the settings pane has no <link rel=\"localization\"> so Fluent never "
        "reaches it",
    )
    hrefs = {
        href
        for link in linksets
        for href in re.findall(r'href="([^"]+)"', link)
    }
    check(
        all(re.fullmatch(r"[A-Za-z0-9_.-]+\.ftl", href) for href in hrefs),
        f"the settings pane references FTL files by path instead of name: {sorted(hrefs)}",
    )
    expected_prefix = None
    config_ts = read(ROOT / "zotero-plugin.config.ts")
    namespace_match = re.search(r"namespace:\s*(?:pkg\.)?config\.addonRef", config_ts)
    package_json = json.loads(read(ROOT / "package.json"))
    if namespace_match:
        expected_prefix = package_json["config"]["addonRef"]
    if expected_prefix:
        check(
            all(href.startswith(f"{expected_prefix}-") for href in hrefs),
            f"the settings pane must reference the built file names "
            f"({expected_prefix}-*.ftl), got {sorted(hrefs)}",
        )

    pane_prefs = set(re.findall(r'preference="([A-Za-z0-9_]+)"', pane))
    check(bool(pane_prefs), "the settings pane binds no preferences")
    unknown_pane_prefs = pane_prefs - declared_prefs
    check(
        not unknown_pane_prefs,
        f"the settings pane binds preferences that addon/prefs.js does not "
        f"declare: {sorted(unknown_pane_prefs)}",
    )
    # Two preferences are deliberately driven by addon/content/preferences.js
    # instead of a `preference=` attribute: the citation-source list is one
    # comma-separated value behind three checkboxes, and the 1.6.0 single-source
    # key exists only so an upgrade keeps the source it had chosen.
    js_driven_prefs = {"citationSourcePreferences", "citationSourcePreference"}
    unused_pane_prefs = declared_prefs - pane_prefs - js_driven_prefs
    check(
        not unused_pane_prefs,
        f"preferences are declared but have no control in the pane: "
        f"{sorted(unused_pane_prefs)}",
    )
else:
    check(False, "addon/content/preferences.xhtml is missing")

# ---------------------------------------------------------------------------
# 7. Fluent variables used by t() must exist in the locale files
# ---------------------------------------------------------------------------
#
# The build prefixes variables as well as ids, so a mismatch only shows up as a
# placeholder that never gets filled at runtime.

argument_re = re.compile(
    r"\bt\(\s*\"([A-Za-z0-9_-]+)\"\s*,\s*\{(.*?)\}\s*\)", re.DOTALL
)


def argument_names(body: str) -> set[str]:
    """Keys of the object literal passed to t().

    Only top-level keys count: `{ sample: thresholds.sampleSize }` names the
    variable `sample`, and the value expression must not be mistaken for
    another variable.
    """
    parts: list[str] = []
    current = ""
    depth = 0
    for char in body:
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        if char == "," and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += char
    parts.append(current)

    names: set[str] = set()
    for part in parts:
        text = part.strip()
        if not text:
            continue
        key = text.split(":", 1)[0].strip() if ":" in text else text
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            names.add(key)
    return names


variables_by_id: dict[str, set[str]] = {}
for ts in (ROOT / "src").rglob("*.ts"):
    for message_id, body in argument_re.findall(read(ts)):
        names = argument_names(body)
        if names:
            variables_by_id.setdefault(message_id, set()).update(names)

check(bool(variables_by_id), "no t() call passes named arguments")

for name in locale_ids:
    ftl_text = read(LOCALES / name / "addon.ftl")
    for message_id, variables in sorted(variables_by_id.items()):
        block = re.search(
            rf"^{re.escape(message_id)}\s*=(.*?)(?=^[A-Za-z0-9_-]+\s*=|\Z)",
            ftl_text,
            re.MULTILINE | re.DOTALL,
        )
        if not block:
            continue
        # The source FTL is checked, so variables are still unprefixed; the
        # build adds the namespace to both ids and variables afterwards.
        declared = set(re.findall(r"\{\s*([A-Za-z0-9_-]+)\s*\}", block.group(1)))
        absent = variables - declared
        check(
            not absent,
            f"locale {name}: message {message_id} is called with {sorted(absent)} "
            f"but the Fluent message declares {sorted(declared)}",
        )

# ---------------------------------------------------------------------------
# 8. Appearance styles declared in code must be offered by the pane
# ---------------------------------------------------------------------------
#
# A style that exists in the union but has no menu entry is invisible to the
# user; one that the pane offers but the code does not know is a blank cell.

prefs_ts = read(ROOT / "src" / "modules" / "prefs.ts")
styles_block = re.search(
    r"export const LIKE_STYLES[^=]*=\s*\[(.*?)\];", prefs_ts, re.DOTALL
)
code_styles = (
    set(re.findall(r'"([a-z]+)"', styles_block.group(1))) if styles_block else set()
)
check(bool(code_styles), "could not read LIKE_STYLES from src/modules/prefs.ts")

pane_styles = set(re.findall(r'data-l10n-id="pref-style-([a-z]+)"', pane))
check(bool(pane_styles), "the settings pane offers no display styles")
check(
    code_styles == pane_styles,
    f"LIKE_STYLES and the pane disagree: only in code={sorted(code_styles - pane_styles)} "
    f"only in pane={sorted(pane_styles - code_styles)}",
)

# Every palette style needs a palette entry, otherwise it falls through to the
# generic fallback and silently loses its look.
column_ts = read(ROOT / "src" / "modules" / "column.ts")
palette_block = re.search(
    r"const PALETTES[^=]*=\s*\{(.*?)\n\};", column_ts, re.DOTALL
)
palette_keys = (
    set(re.findall(r"^\s{2}([a-z]+):\s*\{", palette_block.group(1), re.MULTILINE))
    if palette_block
    else set()
)
palette_styles = (
    set(
        re.findall(
            r'"([a-z]+)"',
            re.search(r"export const PALETTE_STYLES[^=]*=\s*\[(.*?)\];", prefs_ts, re.DOTALL).group(1),
        )
    )
    if re.search(r"export const PALETTE_STYLES[^=]*=\s*\[(.*?)\];", prefs_ts, re.DOTALL)
    else set()
)
check(bool(palette_keys), "could not read the PALETTES table from src/modules/column.ts")
check(
    palette_styles <= palette_keys,
    f"palette styles without a palette: {sorted(palette_styles - palette_keys)}",
)

# Each palette needs all three bands, or a count would render unpainted.
for style in sorted(palette_keys):
    body = palette_block.group(1)
    entry = re.search(rf"\n  {re.escape(style)}:\s*\{{(.*?)\n  \}},", body, re.DOTALL)
    if not entry:
        continue
    bands = set(re.findall(r"^\s{4}(high|mid|low):", entry.group(1), re.MULTILINE))
    check(
        bands == {"high", "mid", "low"},
        f"palette {style} does not define every band: {sorted(bands)}",
    )

# ---------------------------------------------------------------------------
# 9. Citation providers: code, cache line and pane must agree
# ---------------------------------------------------------------------------

citations_ts = read(ROOT / "src" / "modules" / "citations.ts")
code_sources = set(
    re.findall(r'"([a-zA-Z]+)"', re.search(
        r"export const CITATION_AUTHORITY_ORDER[^=]*=\s*\[(.*?)\];", citations_ts, re.DOTALL
    ).group(1))
)
# The pane's source checkboxes carry the provider identifiers the code uses,
# and the list they write is the comma-separated preference.
source_group = re.search(
    r'id="alphalikes-citation-sources".*?</hbox>', pane, re.DOTALL
)
pane_sources = (
    set(re.findall(r'data-source="([A-Za-z]+)"', source_group.group(0)))
    if source_group
    else set()
)
check(bool(pane_sources), "the pane has no citation-source chooser")
check(
    len(re.findall(r'class="alphalikes-citation-source"', pane)) == 3,
    "the pane does not offer exactly the three citation sources",
)
check(
    code_sources <= pane_sources,
    f"citation sources missing from the pane: {sorted(code_sources - pane_sources)}",
)
check(
    "auto" not in pane_sources,
    "the citation-source chooser still offers an automatic mode; a chosen "
    "source has to be the only one used",
)

# Google Scholar is the default source, and the shipped default has to say so
# in both places a fresh profile reads.
prefs_ts = read(ROOT / "src" / "modules" / "prefs.ts")
check(
    'citationSourcePreferences: "googleScholar"' in prefs_ts,
    "the default citation source list is not Google Scholar in prefs.ts",
)
check(
    'pref("citationSourcePreferences", "googleScholar")' in prefs_js,
    "the shipped default citation source list is not Google Scholar in prefs.js",
)
# The 1.6.0 single-source preference stays only so an upgrade keeps its source.
check(
    'getPref("citationSourcePreference")' in prefs_ts,
    "the upgrade path from the single-source preference is gone",
)
_checkbox = [line for line in prefs_js.splitlines() if "useGoogleScholar" in line]
check(
    not _checkbox,
    "prefs.js still ships the removed Google Scholar checkbox",
)
check(
    "useGoogleScholar" not in pane_text and "useGoogleScholar" not in prefs_ts,
    "the removed Google Scholar checkbox is still wired up",
)

# The fall-through that made "only Google Scholar" show OpenAlex numbers must
# not come back: the provider order is derived from the preference alone.
service_ts = read(ROOT / "src" / "modules" / "service.ts")
check(
    "citationProviderOrder(getCitationSourcePreferences())" in service_ts,
    "the citation provider order is not derived from the chosen sources alone",
)
check(
    "CITATION_AUTHORITY_ORDER.filter" not in service_ts,
    "the citation order still falls through to other providers",
)
check(
    "getCitationSourcePreference(" not in service_ts,
    "the service still reads the retired single-source preference",
)
# Several sources are all read; the largest count wins and is the one named.
check(
    "for (const source of citationOrder())" in service_ts,
    "only one selected provider is queried",
)
check(
    "primaryCitation(" in citations_ts and "value > best.count" in citations_ts,
    "the largest count among the selected providers is not chosen",
)

# A block has to be detectable, announced and retried.
cite_ts = read(ROOT / "src" / "modules" / "citations.ts")
for needed, why in (
    ("scholarRetryDelayMs", "the Google Scholar retry backoff is missing"),
    ("CITATIONS_BLOCKED_MARKER", "blocked cells cannot be marked"),
    ("citationProviderOrder", "the strict provider order is missing"),
):
    check(needed in cite_ts, why)
for needed, why in (
    ("noteScholarBlock", "nothing records a Google Scholar block"),
    ("scholarRetryTimer", "a block is never retried automatically"),
    ("getScholarBlockStatus", "a block is not reported to the interface"),
    ("openScholarVerification", "the user cannot open the check themselves"),
    ("toast(", "a block is never announced"),
):
    check(needed in service_ts, why)
check(
    "cell-scholar-blocked" in read(ROOT / "src" / "modules" / "column.ts"),
    "a blocked cell does not explain itself",
)
check(
    "menu-open-scholar" in read(ROOT / "src" / "modules" / "menu.ts"),
    "the context menu has no way to open the verification page",
)

# Each provider needs a serialise prefix, so its count survives the round trip.
for key, prefix in (("googleScholar", "gs"), ("openAlex", "oa"), ("semanticScholar", "s2")):
    check(
        f"`{prefix}=" in citations_ts,
        f"the citation cache line has no field for {key}",
    )
    check(
        re.search(rf"readCount\(fields, \"{prefix}\"\)", citations_ts) is not None,
        f"the citation cache line does not read the {prefix} field back",
    )

# ---------------------------------------------------------------------------
# 10. Removed surfaces stay removed
# ---------------------------------------------------------------------------

# Two features and three styles were deleted on request. Deleting them once is
# not enough: a rebuilt pane, a stale locale entry or a resurrected preference
# would quietly bring them back.
pane_text = read(ROOT / "addon" / "content" / "preferences.xhtml")
for gone in ("exportSort", "noteInclude", "rangeFilterMode"):
    check(
        gone not in pane_text,
        f"the pane still binds the removed preference {gone}",
    )
    for locale in ("zh-CN", "en-US"):
        ftl = read(LOCALES / locale / "addon.ftl")
        check(
            gone not in ftl,
            f"{locale} still mentions the removed preference {gone}",
        )

prefs_js = read(ADDON / "prefs.js")
for gone in ("exportSort", "noteInclude", "rangeFilterMode"):
    check(
        gone not in prefs_js,
        f"prefs.js still ships a default for the removed preference {gone}",
    )

src = "\n".join(read(f) for f in sorted((ROOT / "src" / "modules").glob("*.ts")))
for gone in ('"minimal"', '"glass"', '"elegant"', "DOT_CAP", "cell-dot-capped"):
    check(
        gone not in src,
        f"the removed style or message {gone} is still referenced in src/",
    )

# Out-of-range rows are always dimmed now, so nothing may blank the value.
check(
    'filter.mode === "hide"' not in src,
    "the data provider still hides out-of-range rows",
)
check(
    not (ROOT / "src" / "modules" / "export.ts").exists(),
    "the export module is back",
)
check(
    not (ROOT / "src" / "modules" / "note.ts").exists(),
    "the summary-note module is back",
)

# ---------------------------------------------------------------------------
# 11. A preference change has to repaint, not just redraw
# ---------------------------------------------------------------------------

# The reported bug: a toggled setting only took effect after a manual refresh.
# Dropping the row cache is what makes the new value visible, so the call has
# to stay in the repaint path.
service_ts = read(ROOT / "src" / "modules" / "service.ts")
check(
    "function dropRowCache" in service_ts,
    "the row-cache helper is gone; preference changes would stop applying",
)
check(
    "invalidateRowCache" in service_ts and "_rowCache" in service_ts,
    "the row cache is not dropped on all supported Zotero versions",
)
check(
    "dropRowCache(" in service_ts.split("function dropRowCache")[1],
    "the repaint path does not use the row-cache helper",
)

# ---------------------------------------------------------------------------
# 12. The style preview page is generated, never hand-edited
# ---------------------------------------------------------------------------

# docs/styles-preview.html exists to show the real colours, so it has to come
# from the same tables the columns read. Regenerating it into a temporary file
# and comparing the bytes is the whole guard: an edited page, a stale page and
# a palette change that skipped the page all show up here.
preview = ROOT / "docs" / "styles-preview.html"
generator = ROOT / "scripts" / "gen-styles-preview.py"
check(preview.exists(), "docs/styles-preview.html is missing")
if generator.exists() and preview.exists():
    import subprocess
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        target = pathlib.Path(tmp) / "styles-preview.html"
        result = subprocess.run(
            [sys.executable, str(generator), "--out", str(target)],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        check(
            result.returncode == 0,
            f"the style preview generator failed: {result.stderr.strip()[:200]}",
        )
        if result.returncode == 0:
            check(
                target.read_text(encoding="utf-8") == read(preview),
                "docs/styles-preview.html is out of date; "
                "run `python3 scripts/gen-styles-preview.py`",
            )
else:
    check(False, "scripts/gen-styles-preview.py is missing")

# ---------------------------------------------------------------------------
# 13. The refresh actions report what they did, and the picker picks
# ---------------------------------------------------------------------------

# The reported bug: 「刷新点赞数」 looked like it did nothing. A refresh that
# cannot be told apart from a no-op is a refresh that will be reported again,
# so it has to pass through the loading marker and end with a summary.
menu_ts = read(ROOT / "src" / "modules" / "menu.ts")
check(
    "refreshSelectedCitations" in menu_ts and "menu-refresh-citations" in menu_ts,
    "the context menu has no citation-count refresh",
)
check(
    "refreshSummaryText" in menu_ts,
    "a refresh does not report how many counts it re-read",
)
check(
    "alphalikes-refresh-likes" in menu_ts and "alphalikes-refresh-citations" in menu_ts,
    "the two refresh actions are not separate menu entries",
)
# Every entry that is added has to be removed again: a menu item left behind
# comes back a second time when the window registers its menu again.
_MENU_IDS = re.findall(r'^const ([A-Z][A-Z_]*_ID) = "([^"]+)";', menu_ts, re.MULTILINE)
check(bool(_MENU_IDS), "could not read the menu item ids from src/modules/menu.ts")
_teardown = menu_ts.split("export function unregisterItemMenu")[-1]
for _name, _id in _MENU_IDS:
    check(
        _name in _teardown,
        f"the menu item {_id} is not removed when the menu is torn down",
    )
check(
    "refreshingLikes" in service_ts and "refreshingCitations" in service_ts,
    "an explicit refresh is not visible in the column",
)
check(
    "CELL_LOADING" in service_ts.split("private cellForKnownID")[1][:400],
    "the like cell does not show the loading state while refreshing",
)
check(
    "async refreshItems" in service_ts
    and "async refreshCitations" in service_ts
    and "RefreshSummary" in service_ts,
    "the refresh actions no longer report a summary",
)

# Google Scholar's check is handled silently first; only a block that survives
# the automatic retries is worth interrupting the user for.
check(
    "SCHOLAR_ANNOUNCE_AFTER" in service_ts,
    "every Scholar block still interrupts the user immediately",
)

# Choosing the Scholar record by hand: the dialog, its script, and the pin that
# keeps the choice from being undone by the next refresh.
scholar_dialog = CONTENT / "scholar-picker.xhtml"
scholar_script = CONTENT / "scholar-picker.js"
check(scholar_dialog.exists(), "the Scholar record picker dialog is missing")
check(scholar_script.exists(), "the Scholar record picker script is missing")
if scholar_dialog.exists():
    dialog_text = read(scholar_dialog)
    # The script has to be the last element, or it runs before its own markup.
    check(
        dialog_text.rstrip().endswith("</window>")
        and dialog_text.rindex("<script") > dialog_text.index('id="result-group"'),
        "the picker script is not the last element in its dialog",
    )
    check(
        'id="result-group"' in dialog_text and 'id="apply"' in dialog_text,
        "the picker has no result list or apply button",
    )
if scholar_script.exists():
    script_text = read(scholar_script)
    for needed, why in (
        ("addEventListener(\"click\", onPick, true)", "rows are not clickable"),
        ("command", "the radio command is not handled"),
        ("applyAndClose", "the picker cannot apply a result"),
        ("searchAgain", "the picker cannot re-run the search"),
    ):
        check(needed in script_text, f"the Scholar picker: {why}")
check(
    'parseGoogleScholarResults' in cite_ts,
    "the Scholar results page is not parsed into a list",
)
check(
    "readScholarTitle" in service_ts and "upsertScholarTitle" in service_ts,
    "the picked Scholar record is not remembered",
)
check(
    "SCHOLAR_TITLE_ANY_LINE_RE" in read(ROOT / "src" / "modules" / "arxiv-id.ts"),
    "clearing the data would leave the picked Scholar record behind",
)

# The verification page has to be the paper's own search, not a blank one.
check(
    "scholarVerificationURL(item" in service_ts
    or "scholarVerificationURL(item?" in service_ts,
    "the verification page is not filled in with the paper's title",
)
check(
    "scholarTitleSearchURL" in service_ts,
    "the verification page is not a pre-filled Scholar search",
)

# The manual arXiv picker searches as it opens and keeps weak matches.
check(
    "autoSearch" in read(CONTENT / "arxiv-picker.js"),
    "the arXiv picker still opens without searching",
)
check(
    "PICKER_MIN_SCORE" in menu_ts,
    "the arXiv picker uses the automatic floor, so weak matches stay invisible",
)
check(
    "minScore" in read(ROOT / "src" / "modules" / "resolver.ts"),
    "the resolver cannot lower its display floor for the manual picker",
)

# ---------------------------------------------------------------------------
# 14. Citations may have their own look, and colours are clickable
# ---------------------------------------------------------------------------

for key in (
    "appearanceLinked",
    "citationStyle",
    "citationColorEnabled",
    "citationRangeFilterEnabled",
):
    check(
        f'preference="{key}"' in pane or f'data-l10n-id="pref-citation' in pane,
        f"the pane does not offer {key}",
    )
    check(
        key in prefs_ts and f'pref("{key}"' in prefs_js,
        f"{key} has no default",
    )

check(
    "getCitationAppearance" in prefs_ts,
    "the Citations column has no look of its own",
)
check(
    "getCitationAppearance()" in column_ts,
    "the Citations column still borrows the likes appearance unconditionally",
)
check(
    "citationRangeFilterEnabled" in prefs_ts
    and "isWithinRange(count, appearance.filter)" in column_ts,
    "the citation range filter does not reach the renderer",
)

# Clickable swatches: the pane script has to build them, and every colour box
# has to be marked so it can find them.
preferences_js = read(CONTENT / "preferences.js")
check(
    "alphalikes-color-input" in pane,
    "no colour box is marked for the swatch row",
)
check(
    len(re.findall(r"alphalikes-color-input", pane)) >= 7,
    "not every colour box has a swatch row",
)
check(
    "attachSwatches" in preferences_js and "SWATCHES" in preferences_js,
    "the pane script does not build colour swatches",
)
check(
    "dispatchEvent(new Event(\"change\"" in preferences_js,
    "a swatch click does not reach the preference binding",
)
check(
    "alphalikes-citation-source" in pane
    and "wireSources" in preferences_js,
    "the citation-source checkboxes are not wired up",
)
check(
    "citationSourcePreferences" in preferences_js,
    "the source checkboxes do not write the source list",
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
