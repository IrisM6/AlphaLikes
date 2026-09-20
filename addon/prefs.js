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
