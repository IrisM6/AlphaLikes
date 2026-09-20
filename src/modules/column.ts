/**
 * Registration and rendering of the AlphaLikes item-tree column.
 */

import { config } from "../../package.json";
import { CITATION_SOURCE_LABELS, type CitationSourceKey } from "./citations";
import {
  CELL_LOADING,
  CELL_PENDING,
  CELL_UNAVAILABLE,
  fromSortableValue,
  splitValueDecorations,
} from "./likes";
import { t } from "./l10n";
import {
  colorBucket,
  getCitationPrefs,
  getColorScheme,
  getLikeStyle,
  getRangeFilter,
  getTrendPrefs,
  isWithinRange,
  type ColorScheme,
  type LikeStyle,
} from "./prefs";
import { AlphaLikesService } from "./service";

export const COLUMN_KEY = "alphaxiv_likes";
export const COLUMN_LABEL = "alphaXiv Likes";

/** Second column: citation counts from Semantic Scholar and OpenAlex. */
export const CITATIONS_COLUMN_KEY = "alphaxiv_citations";
export const CITATIONS_COLUMN_LABEL = "Citations";

/** Decoration value that marks a work as being in its field's top decile. */
const HIGH_IMPACT_MARKER = "1";
/** Above this the dot style shows "99+" and moves the count into the tooltip. */
const DOT_CAP = 99;

/** Superscript plus sign, kept as a literal so the cell needs no font tuning. */
const HIGH_IMPACT_GLYPH = "▲";

const NUMERIC_CELL_RE = /^\d+$/;

let service: AlphaLikesService | null = null;
let registeredDataKeys: string[] = [];

/**
 * The shared service instance. The context menu and the column both use it so
 * pending candidates and caches stay in one place.
 */
export function getService(): AlphaLikesService {
  if (!service) service = new AlphaLikesService();
  return service;
}

/**
 * Reads a colour into the cell's computed colour. Kept as a function so the
 * `mid` slot can fall back to the theme colour (an empty string).
 */
function effectiveColor(
  bucket: "high" | "low" | "mid",
  scheme: ColorScheme,
): string {
  if (bucket === "high") return scheme.high;
  if (bucket === "low") return scheme.low;
  return scheme.mid;
}

/**
 * A translucent version of `color`, used for the badge/glass fill.
 *
 * `color-mix()` is available in the Gecko versions Zotero 7-9 ship, so the
 * accent does not have to be a hex literal. When the accent is empty (theme
 * colour) `currentColor` keeps the fill in step with the text.
 */
function translucent(color: string, percent: number): string {
  const base = color.trim() || "currentColor";
  return `color-mix(in srgb, ${base} ${percent}%, transparent)`;
}

/**
 * Applies one of the display styles to the element that carries the text.
 *
 * All styles are inline so they survive `renderCell` having no stylesheet of
 * its own, and none of them change the cell's layout width: the item tree
 * measures column content from the outer cell element.
 */
/** The high / mid / low bands a style can paint. */
type Band = "high" | "mid" | "low";

/** One band's paint inside a palette style. */
interface BandPaint {
  background?: string;
  color?: string;
  border?: string;
}

/**
 * Palettes for the styles whose look *is* the point.
 *
 * These bring their own colours for every band instead of using the colour
 * section, because a muted Morandi tag or a gold-bordered card stops being
 * itself the moment its hue is replaced. The high and low entries are what
 * keep the like-count signal visible inside each look.
 */
const PALETTES: Record<string, Record<Band, BandPaint>> = {
  // 侧边强调块：左侧深金色块 + 浅米黄底
  bookmark: {
    high: { background: "#FDF9E8", color: "#A67C00", border: "#D4AF37" },
    mid: { background: "#F5F6F7", color: "#5F6368", border: "#9AA0A6" },
    low: { background: "#FAFAFA", color: "#8A8A8A", border: "#D0D0D0" },
  },
  // 莫兰迪低饱和
  morandi: {
    high: { background: "#DDE3E5", color: "#7A8B99" },
    mid: { background: "#E8E3E1", color: "#9A8C89" },
    low: { background: "#EFEFEF", color: "#AFAFAF" },
  },
  // 学术严谨
  academic: {
    high: { background: "#003366", color: "#FFFFFF" },
    mid: { background: "#F5F5F5", color: "#003366", border: "#CCCCCC" },
    low: { background: "#FAFAFA", color: "#777777", border: "#DDDDDD" },
  },
  // 典雅精致：深藏青底 + 细金线
  elegant: {
    high: { background: "#1A2332", color: "#D4AF37", border: "#D4AF37" },
    mid: { background: "#1A2332", color: "#BFA76A", border: "#8C7A4B" },
    low: { background: "transparent", color: "#8A8F98" },
  },
  // 淡雅清新
  fresh: {
    high: { background: "#E6F7F0", color: "#2E8B57" },
    mid: { background: "#FFF0F5", color: "#C71585" },
    low: { background: "#F5F5F5", color: "#999999" },
  },
  // 活泼明快
  playful: {
    high: { background: "#FFD700", color: "#000000", border: "#000000" },
    mid: { background: "#FFE9A8", color: "#000000", border: "#000000" },
    low: { background: "#EDEDED", color: "#666666", border: "#BDBDBD" },
  },
  // 双色拼接：左半深底白字，右半浅底深字
  split: {
    high: { background: "#333333", color: "#FFFFFF" },
    mid: { background: "#5F6368", color: "#FFFFFF" },
    low: { background: "#8A8A8A", color: "#FFFFFF" },
  },
  // 数字角标
  dot: {
    high: { background: "#FF3B30", color: "#FFFFFF" },
    mid: { background: "#FF9500", color: "#FFFFFF" },
    low: { background: "#8E8E93", color: "#FFFFFF" },
  },
};

/** The light half of the split style, per band. */
const SPLIT_RIGHT: Record<Band, BandPaint> = {
  high: { background: "#F0F0F0", color: "#333333" },
  mid: { background: "#F0F0F0", color: "#5F6368" },
  low: { background: "#F5F5F5", color: "#8A8A8A" },
};

/** Colours for the shape-only styles that use the colour section: #1 and #11. */
const MINIMAL_COLOR = "#666666";
const OUTLINE_COLOR = "#CCCCCC";
const OUTLINE_TEXT = "#333333";

/**
 * Applies one of the display styles to the element that carries the text.
 *
 * All styles are inline so they survive `renderCell` having no stylesheet of
 * its own, and none of them change the cell's layout width: the item tree
 * measures column content from the outer cell element. `band` is the colour
 * band the count falls into, which the palette styles paint themselves; the
 * shape-only styles receive `accent` from the colour section instead.
 */
function applyLikeStyle(
  visual: HTMLElement,
  style: LikeStyle,
  accent: string,
  band: Band,
  doc: Document,
  prefix: string,
): void {
  const color = accent.trim();

  // The frosted look needs a translucent fill, a hairline highlight along the
  // top edge, and a soft drop shadow to read as glass.
  if (style === "badge" || style === "glass") {
    visual.style.padding = "1px 8px";
    visual.style.borderRadius = "999px";
    visual.style.background = translucent(color, style === "glass" ? 18 : 14);
    visual.style.border = `1px solid ${translucent(color, style === "glass" ? 42 : 32)}`;
    if (style === "glass") {
      visual.style.boxShadow =
        "inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 1px 2px rgba(0, 0, 0, 0.16)";
      visual.style.backdropFilter = "blur(6px) saturate(1.5)";
      visual.style.setProperty("-moz-backdrop-filter", "none");
    }
    return;
  }

  if (style === "plain") return;

  // 纯文本极简：只在数字上做轻量排版，没有底色和边框。
  if (style === "minimal") {
    visual.style.fontSize = "0.95em";
    visual.style.fontWeight = "500";
    if (!visual.style.color) visual.style.color = MINIMAL_COLOR;
    visual.style.opacity = "0.9";
    return;
  }

  // 细边框描边：透明底 + 1px 边框。
  if (style === "outline") {
    const outline = color || OUTLINE_TEXT;
    visual.style.padding = "1px 8px";
    visual.style.borderRadius = "999px";
    visual.style.background = "transparent";
    visual.style.border = `1px solid ${color || OUTLINE_COLOR}`;
    if (!visual.style.color) visual.style.color = outline;
    return;
  }

  // 侧边强调块：用左侧的粗边框当那条深色竖块，比塞一个子元素更稳。
  if (style === "bookmark") {
    const paint = PALETTES.bookmark[band];
    visual.style.padding = "1px 8px 1px 7px";
    visual.style.borderRadius = "0 4px 4px 0";
    if (paint.background) visual.style.background = paint.background;
    if (paint.color) visual.style.color = paint.color;
    // One shorthand sets the hairline around the box, then the left edge is
    // widened into the accent block.
    visual.style.border = `1px solid ${paint.border ?? "transparent"}`;
    visual.style.borderLeftWidth = "3px";
    return;
  }

  // 莫兰迪、学术、清新、活泼：实底/浅底 + 文字，
  // 差别在圆角、字重与阴影。
  if (
    style === "morandi" ||
    style === "academic" ||
    style === "fresh" ||
    style === "playful"
  ) {
    const paint = PALETTES[style][band];
    visual.style.padding = style === "academic" ? "0 6px" : "1px 8px";

    const radius =
      style === "morandi" || style === "fresh"
        ? "999px"
        : style === "academic"
          ? "3px"
          : "6px";
    visual.style.borderRadius = radius;
    if (paint.background) visual.style.background = paint.background;
    if (paint.color) visual.style.color = paint.color;

    if (paint.border) visual.style.border = `1px solid ${paint.border}`;
    else visual.style.border = "none";

    if (style === "academic") {
      // 学术严谨风用等宽数字、无阴影。
      visual.style.fontVariantNumeric = "tabular-nums";
      visual.style.fontWeight = "500";
    }
    if (style === "fresh") {
      visual.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.05)";
    }
    if (style === "playful") {
      // 硬阴影：位移实色，不带模糊。
      visual.style.fontWeight = "700";
      visual.style.boxShadow = band === "low" ? "none" : "2px 2px 0 #000000";
    }
    return;
  }

  // 典雅精致：深藏青底 + 细金线，标题用衬线字体。
  if (style === "elegant") {
    const paint = PALETTES.elegant[band];
    visual.style.padding = "1px 9px";
    visual.style.borderRadius = "2px";
    if (paint.background) visual.style.background = paint.background;
    if (paint.color) visual.style.color = paint.color;
    visual.style.border = paint.border
      ? `1px solid ${paint.border}`
      : "1px solid transparent";
    visual.style.fontFamily = "Georgia, 'Songti SC', serif";
    visual.style.letterSpacing = "0.02em";
    return;
  }

  // 数字角标：正圆、白字，超过 99 显示 99+，真实数字进 tooltip。
  if (style === "dot") {
    const paint = PALETTES.dot[band];
    const text = visual.textContent ?? "";
    const shown =
      /^\d+$/.test(text) && Number.parseInt(text, 10) > 99 ? "99+" : text;

    visual.textContent = shown;
    visual.style.display = "inline-flex";
    visual.style.alignItems = "center";
    visual.style.justifyContent = "center";
    visual.style.minWidth = "18px";
    visual.style.height = "18px";
    visual.style.padding = "0 5px";
    visual.style.borderRadius = shown.length <= 2 ? "50%" : "999px";
    if (paint.background) visual.style.background = paint.background;
    if (paint.color) visual.style.color = paint.color;
    visual.style.fontSize = "0.8em";
    visual.style.fontWeight = "600";
    return;
  }

  // 双色拼接：左半深底白字放前缀，右半浅底深字放数字。
  if (style === "split") {
    const left = PALETTES.split[band];
    const right = SPLIT_RIGHT[band];
    const value = visual.textContent ?? "";

    visual.textContent = "";
    visual.style.display = "inline-flex";
    visual.style.alignItems = "stretch";
    visual.style.borderRadius = "4px";
    visual.style.overflow = "hidden";
    visual.style.padding = "0";

    const leftPart = doc.createElement("span");
    leftPart.textContent = prefix;
    leftPart.style.padding = "1px 6px";
    if (left.background) leftPart.style.background = left.background;
    if (left.color) leftPart.style.color = left.color;
    leftPart.style.fontSize = "0.8em";
    leftPart.style.display = "inline-flex";
    leftPart.style.alignItems = "center";

    const rightPart = doc.createElement("span");
    rightPart.textContent = value;
    rightPart.style.padding = "1px 7px";
    if (right.background) rightPart.style.background = right.background;
    if (right.color) rightPart.style.color = right.color;

    visual.append(leftPart, rightPart);
    return;
  }

  // 玻璃圆形：正圆角标。宽数字无法保持正圆而不裁切，因此变成胶囊并把字号
  // 降一档。
  if (style === "ring") {
    const text = visual.textContent ?? "";
    visual.style.display = "inline-flex";
    visual.style.alignItems = "center";
    visual.style.justifyContent = "center";
    visual.style.minWidth = "22px";
    visual.style.height = "22px";
    visual.style.padding = "0 4px";
    visual.style.borderRadius = text.length <= 3 ? "50%" : "999px";
    visual.style.background = translucent(color, 18);
    visual.style.border = `1px solid ${translucent(color, 45)}`;
    visual.style.boxShadow =
      "inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 1px 2px rgba(0, 0, 0, 0.16)";
    if (text.length >= 4) visual.style.fontSize = "0.85em";
    return;
  }

  // Fallback for an unknown style: keep the count readable rather than blank.
  visual.style.padding = "1px 8px";
  visual.style.borderRadius = "999px";
  visual.style.background = translucent(color, 14);
}

export function renderLikeCell(
  data: string,
  column: { className: string },
  doc: Document,
): HTMLElement {
  const cell = doc.createElement("span");
  cell.className = `cell ${column.className}`;
  cell.style.justifyContent = "flex-end";
  cell.style.fontVariantNumeric = "tabular-nums";

  const { decorations } = splitValueDecorations(data);
  const text = fromSortableValue(data);
  const style = getLikeStyle();

  // The outer span keeps the cell's box; the inner one carries the styling so
  // that padding and borders cannot disturb the column's measured width.
  const visual = doc.createElement("span");
  visual.textContent = text;
  cell.appendChild(visual);

  if (NUMERIC_CELL_RE.test(text)) {
    const likes = Number.parseInt(text, 10);
    applyLikeCountStyling(cell, visual, likes, style, doc);
    appendTrend(cell, doc, decorations[0], likes);
    return cell;
  }

  if (text === CELL_LOADING) {
    cell.title = t("cell-loading");
    return cell;
  }

  if (text === CELL_PENDING) {
    const scheme = getColorScheme();
    cell.title = t("cell-pending");
    if (scheme.enabled && scheme.pending) {
      visual.style.color = scheme.pending;
      applyLikeStyle(
        visual,
        style,
        scheme.pending,
        "mid",
        doc,
        t("cell-split-prefix"),
      );
    }
    return cell;
  }

  if (text === CELL_UNAVAILABLE) {
    cell.title = t("cell-unavailable");
  }

  return cell;
}

/**
 * Adds the day-over-day change next to the count, e.g. `2979 ↑12`.
 *
 * A rise at or above the "hot" threshold is drawn in the high colour and says
 * so in the tooltip; every other change stays muted so the number itself keeps
 * the reader's attention.
 */
function appendTrend(
  cell: HTMLElement,
  doc: Document,
  decoration: string | undefined,
  likes: number,
): void {
  if (decoration === undefined) return;

  const delta = Number.parseInt(decoration, 10);
  if (!Number.isSafeInteger(delta)) return;

  const prefs = getTrendPrefs();
  const scheme = getColorScheme();
  // The hot accent obeys the master colour switch, like the count does.
  const hot = scheme.enabled && prefs.hotDelta > 0 && delta >= prefs.hotDelta;

  const suffix = doc.createElement("span");
  suffix.textContent = `${delta > 0 ? "↑" : delta < 0 ? "↓" : "→"}${Math.abs(delta)}`;
  suffix.style.marginInlineStart = "4px";
  suffix.style.fontSize = "0.85em";
  suffix.style.opacity = hot ? "1" : "0.7";
  if (hot && scheme.high) suffix.style.color = scheme.high;
  suffix.title = t("cell-trend", { delta, likes });

  cell.appendChild(suffix);
}

/** Tooltip and marker for the Citations column. */
function appendHighImpact(
  cell: HTMLElement,
  visual: HTMLElement,
  doc: Document,
): void {
  const scheme = getColorScheme();

  const marker = doc.createElement("span");
  marker.textContent = HIGH_IMPACT_GLYPH;
  marker.style.marginInlineStart = "3px";
  marker.style.fontSize = "0.75em";
  marker.style.verticalAlign = "super";
  if (scheme.high) marker.style.color = scheme.high;
  cell.appendChild(marker);

  visual.title = t("cell-high-impact");
}

/**
 * Renders the Citations column.
 *
 * The styles apply here too, with the colour band taken from the work's impact
 * rather than from a threshold: a work OpenAlex places in its field's top
 * decile gets the style's "high" band, everything else the middle one. The
 * like-count range filter deliberately does not apply, because it filters a
 * different quantity.
 */
export function renderCitationCell(
  data: string,
  column: { className: string },
  doc: Document,
): HTMLElement {
  const cell = doc.createElement("span");
  cell.className = `cell ${column.className}`;
  cell.style.justifyContent = "flex-end";
  cell.style.fontVariantNumeric = "tabular-nums";

  const { decorations } = splitValueDecorations(data);
  const text = fromSortableValue(data);
  const style = getLikeStyle();
  const scheme = getColorScheme();

  const visual = doc.createElement("span");
  visual.textContent = text;
  cell.appendChild(visual);

  if (NUMERIC_CELL_RE.test(text)) {
    const highImpact = decorations.includes(HIGH_IMPACT_MARKER);
    const band: Band = highImpact ? "high" : "mid";
    const accent = scheme.enabled
      ? effectiveColor(highImpact ? "high" : "mid", scheme)
      : "";

    if (accent) visual.style.color = accent;
    applyLikeStyle(
      visual,
      style,
      accent,
      band,
      doc,
      t("cell-split-prefix-citations"),
    );

    const source = citationSourceFrom(decorations);
    if (highImpact) appendHighImpact(cell, visual, doc);
    if (source) {
      const line = t("cell-citation-source", { source });
      cell.title = visual.title ? `${line} · ${visual.title}` : line;
    }
    return cell;
  }

  if (text === CELL_LOADING) {
    cell.title = t("cell-loading");
    return cell;
  }

  if (text === CELL_UNAVAILABLE) cell.title = t("cell-citations-unavailable");
  return cell;
}

/** Maps the provider key carried in the cell data to its display name. */
function citationSourceFrom(decorations: string[]): string | null {
  for (const key of Object.keys(CITATION_SOURCE_LABELS)) {
    if (decorations.includes(key)) {
      return CITATION_SOURCE_LABELS[key as CitationSourceKey];
    }
  }
  return null;
}

function applyLikeCountStyling(
  cell: HTMLElement,
  visual: HTMLElement,
  likes: number,
  style: LikeStyle,
  doc: Document,
): void {
  const scheme = getColorScheme();
  const filter = getRangeFilter();
  const prefix = t("cell-split-prefix");

  if (filter.enabled && !isWithinRange(likes, filter)) {
    // `hide` mode never reaches this branch because the data provider blanks
    // the value; this is the `dim` presentation.
    cell.style.opacity = "0.45";
    cell.title = t("cell-filtered");
    if (scheme.enabled && scheme.low) {
      visual.style.color = scheme.low;
    }
    applyLikeStyle(visual, style, scheme.low, "low", doc, prefix);
    return;
  }

  // In quantile mode the cut-offs are percentiles of the counts currently in
  // the item tree, so the same number can be "high" in one view and "mid" in
  // another. The service owns that derivation and falls back to the fixed
  // thresholds whenever the sample is too small to rank.
  const thresholds = getService().getEffectiveThresholds();
  const bucket = colorBucket(likes, {
    ...scheme,
    highThreshold: thresholds.high,
    lowThreshold: thresholds.low,
  });

  // The palette styles paint every band themselves, so they are handed the
  // band rather than a colour. Without the colour switch they fall back to the
  // middle band, which is their plainest look.
  const coloring = scheme.enabled;
  const band: Band = coloring ? bucket : "mid";
  const color = coloring ? effectiveColor(bucket, scheme) : "";

  if (color) visual.style.color = color;
  applyLikeStyle(visual, style, color, band, doc, prefix);

  // The dot style shortens everything above 99, so the real figure goes into
  // the tooltip rather than being lost.
  if (style === "dot" && likes > DOT_CAP) {
    cell.title = t("cell-dot-capped", { likes });
  }

  if (coloring && thresholds.source === "quantile") {
    appendQuantileTitle(cell, bucket, thresholds);
  }
}

/** Explains a quantile-derived colour on hover. */
function appendQuantileTitle(
  cell: HTMLElement,
  bucket: ReturnType<typeof colorBucket>,
  thresholds: { high: number; low: number; sampleSize: number },
): void {
  const label =
    bucket === "high"
      ? t("cell-quantile-high")
      : bucket === "low"
        ? t("cell-quantile-low")
        : t("cell-quantile-mid");

  cell.title = t("cell-quantile-title", {
    label,
    high: thresholds.high,
    low: thresholds.low,
    sample: thresholds.sampleSize,
  });
}

export async function registerAlphaXivLikesColumn(): Promise<string[]> {
  const activeService = getService();

  // `registerColumns` is the deprecated plural form, which calls the current
  // `registerColumn` internally. Using the singular keeps the call on the
  // supported API and still returns one data key.
  const result = await Zotero.ItemTreeManager.registerColumn({
    pluginID: config.addonID,
    dataKey: COLUMN_KEY,
    label: COLUMN_LABEL,
    enabledTreeIDs: ["main"],
    width: "110",
    minWidth: 72,
    showInColumnPicker: true,
    zoteroPersist: ["width", "hidden", "sortDirection"],
    dataProvider: (item: Zotero.Item) => activeService.getCellData(item),
    renderCell(_index, data, column, _isFirstColumn, doc) {
      return renderLikeCell(data, column, doc);
    },
  });

  registeredDataKeys = (Array.isArray(result) ? result : [result]).filter(
    (key): key is string => typeof key === "string",
  );
  if (!registeredDataKeys.length) {
    throw new Error(
      "AlphaLikes could not register its Zotero item-tree column",
    );
  }

  if (getCitationPrefs().enabled) {
    await registerCitationsColumn(activeService);
  }

  return registeredDataKeys;
}

/**
 * Registers the Citations column.
 *
 * Registration is conditional because the column is opt-out: with citation
 * lookups switched off the column would only ever render blanks.
 */
async function registerCitationsColumn(
  activeService: AlphaLikesService,
): Promise<void> {
  const result = await Zotero.ItemTreeManager.registerColumn({
    pluginID: config.addonID,
    dataKey: CITATIONS_COLUMN_KEY,
    label: t("column-citations-label"),
    enabledTreeIDs: ["main"],
    width: "90",
    minWidth: 64,
    showInColumnPicker: true,
    zoteroPersist: ["width", "hidden", "sortDirection"],
    dataProvider: (item: Zotero.Item) =>
      activeService.getCitationCellData(item),
    renderCell(_index, data, column, _isFirstColumn, doc) {
      return renderCitationCell(data, column, doc);
    },
  });

  const keys = (Array.isArray(result) ? result : [result]).filter(
    (key): key is string => typeof key === "string",
  );
  if (!keys.length) {
    Zotero.debug(
      "[AlphaLikes] Zotero refused the Citations column; like counts keep working",
    );
    return;
  }

  registeredDataKeys.push(...keys);
}

export async function shutdownAlphaXivLikesColumn(): Promise<void> {
  service?.dispose();
  service = null;

  if (registeredDataKeys.length) {
    await Zotero.ItemTreeManager.unregisterColumns(registeredDataKeys);
    registeredDataKeys = [];
  }
}
