/**
 * The colours each display style paints with.
 *
 * Two things live here, and they are deliberately in one module so they can
 * never drift apart:
 *
 *  - `STYLE_ACCENTS` — the colour each band shows when the user has not chosen
 *    one. This is what the settings pane previews and what the "restore the
 *    style's own colours" button puts back.
 *  - `PALETTES` — the paint a style uses for a band when it is left on its
 *    defaults. A Morandi tag stops being Morandi the moment its hue is
 *    replaced, so the built-in look is kept verbatim as long as nobody edits
 *    it.
 *
 * Once a colour *is* edited, `customPaint()` derives the band's paint from the
 * chosen colour with the same recipe the style would have used: the style keeps
 * its shape, spacing and weight, and the hue follows the setting. That is the
 * whole point of the feature — before it, picking a colour for one of the seven
 * palette styles did nothing at all.
 *
 * `color-mix()` is available in every Gecko version the add-on supports
 * (Zotero 7 ships Gecko 115), so derived colours are expressed as CSS colour
 * mixes instead of being computed by hand.
 */

export type Band = "high" | "mid" | "low";

/** One band's paint inside a palette style. */
export interface BandPaint {
  background?: string;
  color?: string;
  border?: string;
}

export interface BandColors {
  high: string;
  mid: string;
  low: string;
}

/** A translucent version of `color`, for the badge/glass fill. */
export function translucent(color: string, percent: number): string {
  const base = color.trim() || "currentColor";
  return `color-mix(in srgb, ${base} ${percent}%, transparent)`;
}

/** `percent` of `color`, the rest white. */
function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, #ffffff)`;
}

/** `percent` of `color`, the rest near-black. */
function shade(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, #111111)`;
}

/** Parses `#rgb` / `#rrggbb`; anything else is reported as unknown. */
function hexToRgb(value: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((char) => char + char)
      .join("");
  }
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

/**
 * Black or white, whichever can be read on `background`.
 *
 * Only hex colours can be measured; anything else (a `color-mix()`, a named
 * colour, a theme keyword) keeps the light text the solid styles use by
 * default, which is what they shipped with.
 */
export function readableOn(background: string, fallback = "#FFFFFF"): string {
  const rgb = hexToRgb(background);
  if (!rgb) return fallback;
  const [r, g, b] = rgb;
  // Relative luminance, sRGB coefficients.
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? "#111111" : "#FFFFFF";
}

/**
 * The colour each band shows by default, per style.
 *
 * For the four shape-only styles this is the colour section's own defaults;
 * for the seven palette styles it is the band's dominant colour, i.e. the one a
 * user would name if asked "what colour is the high band?".
 */
export const STYLE_ACCENTS: Record<string, BandColors> = {
  plain: { high: "#1a7f37", mid: "", low: "#9aa0a6" },
  badge: { high: "#1a7f37", mid: "", low: "#9aa0a6" },
  ring: { high: "#1a7f37", mid: "", low: "#9aa0a6" },
  outline: { high: "#1a7f37", mid: "", low: "#9aa0a6" },

  bookmark: { high: "#D4AF37", mid: "#9AA0A6", low: "#D0D0D0" },
  morandi: { high: "#9FB3BF", mid: "#DCD3C9", low: "#F1F1EF" },
  academic: { high: "#003366", mid: "#F5F5F5", low: "#FAFAFA" },
  fresh: { high: "#2E8B57", mid: "#C71585", low: "#999999" },
  playful: { high: "#FFD700", mid: "#FFE9A8", low: "#EDEDED" },
  split: { high: "#333333", mid: "#5F6368", low: "#8A8A8A" },
  dot: { high: "#FF3B30", mid: "#FF9500", low: "#8E8E93" },
};

/** The default colours of `style`, with a safe fallback for unknown values. */
export function styleAccents(style: string): BandColors {
  return STYLE_ACCENTS[style] ?? STYLE_ACCENTS.badge;
}

/**
 * Palettes for the styles whose look *is* the point.
 *
 * Used while a style is on its defaults. The high and low entries are what keep
 * the like-count signal visible inside each look.
 */
export const PALETTES: Record<string, Record<Band, BandPaint>> = {
  // 侧边强调块：左侧深金色块 + 浅米黄底
  bookmark: {
    high: { background: "#FDF9E8", color: "#A67C00", border: "#D4AF37" },
    mid: { background: "#F5F6F7", color: "#5F6368", border: "#9AA0A6" },
    low: { background: "#FAFAFA", color: "#8A8A8A", border: "#D0D0D0" },
  },
  // 莫兰迪低饱和：仍是灰调，但三档在明度与色相上都拉开，一眼能分辨
  // （雾霾蓝 → 灰米 → 近白），文字颜色也跟着深浅走。
  morandi: {
    high: { background: "#9FB3BF", color: "#16232A", border: "#7D95A3" },
    mid: { background: "#DCD3C9", color: "#4A423B", border: "#C0B4A6" },
    low: { background: "#F1F1EF", color: "#8A8A88", border: "#DFDFDC" },
  },
  // 学术严谨
  academic: {
    high: { background: "#003366", color: "#FFFFFF" },
    mid: { background: "#F5F5F5", color: "#003366", border: "#CCCCCC" },
    low: { background: "#FAFAFA", color: "#777777", border: "#DDDDDD" },
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
export const SPLIT_RIGHT: Record<Band, BandPaint> = {
  high: { background: "#F0F0F0", color: "#333333" },
  mid: { background: "#F0F0F0", color: "#5F6368" },
  low: { background: "#F5F5F5", color: "#8A8A8A" },
};

/** Whether a style paints its bands from a palette. */
export function hasPalette(style: string): boolean {
  return Object.prototype.hasOwnProperty.call(PALETTES, style);
}

/**
 * The paint a palette style uses for a band once its colour has been chosen.
 *
 * Each style keeps the treatment that makes it recognisable — a Morandi tag
 * stays a soft fill, a badge stays a solid disc, the bookmark keeps its left
 * bar — and only the hue comes from `accent`.
 */
export function customPaint(
  style: string,
  band: Band,
  accent: string,
): BandPaint | null {
  if (!hasPalette(style)) return null;
  const color = accent.trim();
  if (!color) return null;

  switch (style) {
    case "bookmark":
      return {
        background: tint(color, 12),
        border: color,
        color: shade(color, 88),
      };
    case "morandi":
      return {
        background: tint(color, 55),
        border: tint(color, 35),
        color: shade(color, 80),
      };
    case "academic":
      return band === "high"
        ? { background: color, color: readableOn(color) }
        : {
            background: tint(color, 12),
            border: tint(color, 45),
            color: color,
          };
    case "fresh":
      return {
        background: tint(color, 88),
        color: color,
      };
    case "playful":
      return band === "low"
        ? {
            background: tint(color, 45),
            color: shade(color, 70),
            border: "#BDBDBD",
          }
        : { background: color, color: readableOn(color), border: "#000000" };
    case "split":
      return { background: shade(color, 90), color: "#FFFFFF" };
    case "dot":
      return { background: color, color: readableOn(color) };
    default:
      return null;
  }
}
