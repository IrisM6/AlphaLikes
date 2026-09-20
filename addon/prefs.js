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

// plain | badge | glass | ring
pref("likeStyle", "glass");

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
pref("rangeFilterMode", "hide");

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

pref("citationsEnabled", true);
// 0 keeps whatever was read once.
pref("citationCacheTtlDays", 7);

// --- Summary note ----------------------------------------------------------

pref("noteIncludeCitations", true);
pref("noteIncludeTrend", true);
pref("noteIncludeArxivLink", true);

// --- Export ----------------------------------------------------------------
//
// likes | citations | title | none. Exporting sorted by like count is the
// default because that is what the column is used for.

pref("exportSort", "likes");
