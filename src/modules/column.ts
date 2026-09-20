/**
 * Registration and rendering of the AlphaLikes item-tree column.
 */

import { config } from "../../package.json";
import {
  CELL_LOADING,
  CELL_PENDING,
  CELL_UNAVAILABLE,
  fromSortableValue,
} from "./likes";
import { t } from "./l10n";
import {
  colorBucket,
  getColorScheme,
  getLikeStyle,
  getRangeFilter,
  isWithinRange,
  type ColorScheme,
  type LikeStyle,
} from "./prefs";
import { AlphaLikesService } from "./service";

export const COLUMN_KEY = "alphaxiv_likes";
export const COLUMN_LABEL = "alphaXiv Likes";

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
function applyLikeStyle(
  visual: HTMLElement,
  style: LikeStyle,
  accent: string,
): void {
  if (style === "plain") return;

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

  // "ring": a circle. Wide numbers cannot stay circular without clipping, so
  // they become a stadium and the font steps down a size.
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
}

/**
 * Applies the configured colours and the like-count range filter to a cell.
 *
 * `data` is the sortable value produced by the data provider: either a
 * zero-padded like count or one of the status markers.
 */
export function renderLikeCell(
  data: string,
  column: { className: string },
  doc: Document,
): HTMLElement {
  const cell = doc.createElement("span");
  cell.className = `cell ${column.className}`;
  cell.style.justifyContent = "flex-end";
  cell.style.fontVariantNumeric = "tabular-nums";

  const text = fromSortableValue(data);
  const style = getLikeStyle();

  // The outer span keeps the cell's box; the inner one carries the styling so
  // that padding and borders cannot disturb the column's measured width.
  const visual = doc.createElement("span");
  visual.textContent = text;
  cell.appendChild(visual);

  if (NUMERIC_CELL_RE.test(text)) {
    applyLikeCountStyling(cell, visual, Number.parseInt(text, 10), style);
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
      applyLikeStyle(visual, style, scheme.pending);
    }
    return cell;
  }

  if (text === CELL_UNAVAILABLE) {
    cell.title = t("cell-unavailable");
  }

  return cell;
}

function applyLikeCountStyling(
  cell: HTMLElement,
  visual: HTMLElement,
  likes: number,
  style: LikeStyle,
): void {
  const scheme = getColorScheme();
  const filter = getRangeFilter();

  if (filter.enabled && !isWithinRange(likes, filter)) {
    // `hide` mode never reaches this branch because the data provider blanks
    // the value; this is the `dim` presentation.
    cell.style.opacity = "0.45";
    cell.title = t("cell-filtered");
    if (scheme.enabled && scheme.low) {
      visual.style.color = scheme.low;
      applyLikeStyle(visual, style, scheme.low);
    }
    return;
  }

  if (!scheme.enabled) {
    // No accent to tint with; still honour the structural part of the style.
    applyLikeStyle(visual, style, "");
    return;
  }

  const bucket = colorBucket(likes, scheme);
  const color = effectiveColor(bucket, scheme);

  if (color) visual.style.color = color;
  applyLikeStyle(visual, style, color);
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
  return registeredDataKeys;
}

export async function shutdownAlphaXivLikesColumn(): Promise<void> {
  service?.dispose();
  service = null;

  if (registeredDataKeys.length) {
    await Zotero.ItemTreeManager.unregisterColumns(registeredDataKeys);
    registeredDataKeys = [];
  }
}
