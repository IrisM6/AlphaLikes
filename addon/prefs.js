// AlphaLikes default preferences.
//
// Keys are written here without the branch prefix; `zotero-plugin build`
// prefixes them with `extensions.zotero.alphalikes.` and regenerates
// `typings/prefs.d.ts`.
//
// Gecko preferences are typed (bool / int / string) and cannot hold
// fractional numbers, so the confidence thresholds are stored as percentages.

// --- arXiv matching -------------------------------------------------------

pref("autoResolveNonArxiv", true);
pref("autoAcceptPercent", 90);
pref("confirmPercent", 70);
pref("titleSearchResults", 5);
pref("useSemanticScholar", true);
pref("useOpenAlex", true);
pref("useCrossref", true);
pref("useUnpaywall", false);
pref("useArxivTitleSearch", true);
pref("contactEmail", "");

// --- Network --------------------------------------------------------------

pref("requestIntervalMs", 1500);
pref("requestTimeoutMs", 15000);
pref("cacheTtlDays", 0);

// --- Appearance -----------------------------------------------------------
//
// plain | badge | ring | bookmark | morandi | academic | fresh | playful |
// outline | split | dot
//
// The shape-only styles tint with the colours below; the palette styles carry
// their own colours for every band.

pref("likeStyle", "badge");

// --- Colours --------------------------------------------------------------

pref("colorEnabled", true);
pref("highLikesThreshold", 100);
pref("lowLikesThreshold", 10);
pref("highLikesColor", "#1a7f37");
pref("lowLikesColor", "#9aa0a6");
pref("midLikesColor", "");
pref("pendingColor", "#b45309");

// --- Like-count range filter ---------------------------------------------

pref("rangeFilterEnabled", false);
pref("rangeFilterMin", 0);
pref("rangeFilterMax", 0);

// --- Like trend ------------------------------------------------------------
//
// Each refresh appends one snapshot per day to a line in the item's Extra
// field, so the column can show `2979 ↑12`. The history is trimmed to
// `historyDays` entries to keep Extra small.

pref("showTrend", true);
pref("trendHotDelta", 10);
pref("historyDays", 7);

// --- Colour mode -----------------------------------------------------------
//
// threshold | quantile. Quantile colours by rank within the items currently in
// the tree; the fixed thresholds above are the fallback when there are too few
// items to rank.

pref("colorMode", "threshold");
pref("quantileLowPercent", 40);
pref("quantileHighPercent", 80);

// --- Citations -------------------------------------------------------------
//
// Counts come from three providers. Google Scholar has no API, so its public
// results page is read; it can be switched off on its own because Google may
// answer with a captcha or a rate limit.

pref("citationsEnabled", true);
// 0 keeps whatever was read once.
pref("citationCacheTtlDays", 7);
// One or more of googleScholar | openAlex | semanticScholar, comma separated.
// One source is strict (its number or none); several are all read and the
// largest count is shown. Nothing outside this list is ever substituted.
pref("citationSourcePreferences", "googleScholar");
// Kept only to migrate an install that chose a source in 1.6.0 or earlier;
// nothing reads it once the list above has been written.
pref("citationSourcePreference", "googleScholar");

// --- Citations: appearance -------------------------------------------------
//
// Linked (the default) means the Citations column reuses the likes style,
// colours and range filter. Unlinked gives it its own, because the two figures
// often live on different scales.

pref("appearanceLinked", true);
pref("citationStyle", "badge");
pref("citationColorEnabled", true);
pref("citationHighLikesColor", "#1a7f37");
pref("citationLowLikesColor", "#9aa0a6");
pref("citationMidLikesColor", "");
pref("citationHighLikesThreshold", 100);
pref("citationLowLikesThreshold", 10);
pref("citationRangeFilterEnabled", false);
pref("citationRangeFilterMin", 0);
pref("citationRangeFilterMax", 0);
