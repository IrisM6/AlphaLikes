# AlphaLikes strings.
#
# This file is used in two places:
#   1. Column labels, context menus and cell tooltips in the main window, read
#      through src/modules/l10n.ts.
#   2. The settings pane, addon/content/preferences.xhtml, which Zotero's
#      Fluent renders directly from `data-l10n-id` attributes.
#
# `zotero-plugin-scaffold` prefixes every message id with `alphalikes-` at build
# time and renames the file to `alphalikes-addon.ftl`, so the pane's
# `data-l10n-id` values are written without the prefix.

column-label = alphaXiv Likes
column-citations-label = Citations
menu-find-arxiv = Find arXiv ID…
menu-refresh = Refresh alphaXiv Likes
menu-clear = Clear AlphaLikes data

cell-loading = Loading from alphaXiv…
cell-unavailable = No alphaXiv likes found for this item
cell-pending = A possible arXiv match was found — right-click to confirm it
cell-filtered = Hidden by the like-count filter
cell-trend = {delta} likes since the previous snapshot (currently {likes})
cell-high-impact = In the top 10% of its field and year
cell-citations-unavailable = No citation count found for this item
cell-quantile-high = High for the items in view
cell-quantile-low = Low for the items in view
cell-quantile-mid = Mid-range for the items in view
cell-quantile-title = {label} — high from {high} likes, low up to {low} (ranked against {sample} items)

# --- Batch actions ---------------------------------------------------------

cell-split-prefix = likes
cell-split-prefix-citations = cited
cell-citation-source = Source: {source}
menu-batch-find = Find arXiv IDs for all selected
batch-finding = AlphaLikes is looking up {count} items…
batch-done = Done. {applied} matched automatically, {pending} need confirmation, {notFound} had no match, {alreadyKnown} already had an ID.
batch-none-to-do = Every selected item already has an arXiv ID.
progress-error = AlphaLikes: the update failed: {message}

error-no-selection = Select at least one item first.
error-single-selection = This action works on a single item only.

# --- Summary note ----------------------------------------------------------

picker-title = Find arXiv ID
picker-heading = Candidate matches
picker-subheading = AlphaLikes searched the enabled scholarly APIs. Pick the correct arXiv record, or enter an ID manually.
picker-current = Current match
picker-none = No candidate reached the confidence threshold. Try searching again or enter an ID manually.
picker-no-candidates = Nothing was found for this item yet — use Search again, or type an ID below.
picker-manual-label = Enter an arXiv ID or URL
picker-manual-placeholder = 2301.12345 or https://arxiv.org/abs/2301.12345
picker-apply = Apply
picker-cancel = Cancel
picker-search = Search again
picker-clear = Remove AlphaLikes data
picker-searching = Searching…
picker-search-failed = The search failed.
picker-invalid = That does not look like an arXiv ID.
picker-item = Item
picker-confidence-high = High confidence
picker-confidence-medium = Needs your confirmation
picker-confidence-low = Low confidence

# ===========================================================================
# Settings pane
#
# Controls (checkbox, radio, menuitem) use `.label` and prose uses the message
# value, matching the convention in Zotero's own panes.
# ===========================================================================

pref-pane-intro = Reads each item's like count and citation count and writes the result into the item's Extra field.

pref-match-title = arXiv matching
pref-match-desc = AlphaLikes reads the arXiv record from the URL, the DOI or the Extra field. When an item has none, it can look one up through scholarly APIs.
pref-match-auto =
    .label = Find arXiv IDs for items that do not have one
pref-match-auto-accept = Adopt a match automatically at or above (%)
pref-match-confirm = Offer a match for manual confirmation at or above (%)
pref-match-title-results = Results per title search
pref-match-use-arxiv =
    .label = Search the arXiv API by title
pref-match-use-s2 =
    .label = Use Semantic Scholar (DOI and title)
pref-match-use-openalex =
    .label = Use OpenAlex (DOI and title)
pref-match-use-crossref =
    .label = Use Crossref (DOI metadata)
pref-match-use-unpaywall =
    .label = Use Unpaywall (requires a contact address)
pref-match-contact = Contact address for OpenAlex / Unpaywall

pref-appearance-title = Appearance
pref-appearance-desc = How like counts and citation counts are drawn in their columns. Four of the styles only change the shape and texture and take their colours from the Colours section; the other seven carry their own palette and switch between its strong and muted versions for high and low counts.
pref-appearance-style = Display style
pref-style-plain =
    .label = Plain text
pref-style-badge =
    .label = Glass pill
pref-style-ring =
    .label = Glass circle
pref-style-bookmark =
    .label = Side accent block
pref-style-morandi =
    .label = Muted Morandi
pref-style-academic =
    .label = Academic
pref-style-fresh =
    .label = Fresh
pref-style-playful =
    .label = Playful
pref-style-outline =
    .label = Outline
pref-style-split =
    .label = Split tag
pref-style-dot =
    .label = Notification dot

pref-color-title = Colours
pref-color-enabled =
    .label = Colour the like counts
pref-color-mode = Colour by
pref-color-mode-threshold =
    .label = Fixed thresholds
pref-color-mode-quantile =
    .label = Rank within the items in view (quantile)
pref-color-quantile-low = Low percentile (%)
pref-color-quantile-high = High percentile (%)
pref-color-high-threshold = High likes above
pref-color-low-threshold = Low likes up to
pref-color-high = colour
pref-color-low = colour
pref-color-mid = Everything in between (blank keeps the theme colour)
pref-color-pending = “Confirm this match” marker
pref-color-hint = Any CSS colour works: #1a7f37, green, rgb(26 127 55). Quantile mode ranks against the items currently in the tree and falls back to the fixed thresholds when the sample is too small.

pref-trend-title = Like trend
pref-trend-desc = Each refresh records that day's like count in the item's Extra field, which is what lets the column show “2979 ↑12”.
pref-trend-show =
    .label = Show the day-over-day change in the column
pref-trend-hot = A daily rise of at least this count is “recently hot”
pref-trend-history = Days of history to keep (written into Extra, up to 30)

pref-citations-title = Citations
pref-citations-desc = Citation counts come from Google Scholar, OpenAlex and Semantic Scholar. They change slowly, so the cache outlives the like-count cache.
pref-citations-enabled =
    .label = Show the Citations column and look counts up
pref-citations-ttl = Re-read after (days, 0 = read once)
pref-citations-scholar =
    .label = Use Google Scholar (no official API; reads the public results page, may be rate-limited)
pref-citations-scholar-note = Google Scholar has no public API, so the plugin reads the “Cited by” figure from the public results page. Google may answer with a captcha or a rate limit; that source is then skipped and the next one is used. Reading it too often is what triggers the block, so do not set the request interval very low.
pref-citations-source = Which source's count to display
pref-citations-source-auto = Automatic (Google Scholar → OpenAlex → Semantic Scholar)
pref-citations-source-scholar =
    .label = Google Scholar only
pref-citations-source-openalex =
    .label = OpenAlex only
pref-citations-source-s2 =
    .label = Semantic Scholar only
pref-citations-source-note = “Automatic” orders the sources by coverage: Google Scholar indexes the most, OpenAlex is next and is openly documented, Semantic Scholar covers the fewest venues. When a source has nothing (or is rate-limited this time) the next one answers, and the cell's tooltip names the source of the number shown.
pref-citations-s2-note = Semantic Scholar rate-limits requests without an API key; a 429 is skipped and retried later.
pref-refresh-title = Refreshing and network
pref-refresh-desc = Right-click any item and choose “Refresh alphaXiv Likes” to re-read the counts. Cached values can also expire on their own.
pref-refresh-ttl = Re-fetch cached like counts after (days, 0 = never)
pref-refresh-interval = Minimum delay between requests to the same host (ms)
pref-refresh-timeout = Request timeout (ms)

pref-filter-title = Like-count range filter
pref-filter-desc = Focus the column on a band of like counts; bounds of 0 mean no bound. Rows outside the band stay visible and are dimmed; their counts are untouched.
pref-filter-enabled =
    .label = Enable the like-count range filter
pref-filter-min = Minimum likes
pref-filter-max = Maximum likes (0 = no upper bound)

