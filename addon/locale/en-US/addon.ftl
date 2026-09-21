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
menu-refresh-citations = Refresh citation counts
menu-pick-scholar = Choose the Google Scholar record…
menu-clear = Clear AlphaLikes data
menu-open-scholar = Open the Google Scholar verification page

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
cell-scholar-blocked = Google Scholar asked for a human check; retrying automatically in about {minutes} minutes. Right-click → Open the Google Scholar verification page to clear it yourself.
# --- Refresh summaries ------------------------------------------------------

notify-refresh-likes-title = AlphaLikes · likes
notify-refresh-citations-title = AlphaLikes · citations
refresh-likes-updated = Re-read {updated} like count(s)
refresh-citations-updated = Re-read {updated} citation count(s)
refresh-failed = {failed} could not be read (the previous value is kept)
refresh-skipped = {skipped} have no DOI or arXiv ID to look up
refresh-nothing = Nothing to refresh.
refresh-joining = "; "
scholar-picked = The chosen Google Scholar record now supplies this item's citation count.
scholar-cleared = The chosen Google Scholar record was forgotten; the item's own title is used again.

# --- Batch actions ----------------------------------------------------------

menu-batch-find = Find arXiv IDs for all selected
batch-finding = AlphaLikes is looking up {count} items…
batch-done = Done. {applied} matched automatically, {pending} need confirmation, {notFound} had no match, {alreadyKnown} already had an ID.
batch-none-to-do = Every selected item already has an arXiv ID.
progress-error = AlphaLikes: the update failed: {message}

notify-scholar-title = AlphaLikes · Google Scholar
notify-scholar-blocked = Google Scholar asked for a human check, so citation counts are paused. It will retry automatically in about {minutes} minutes; the context menu can open the check now.

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
pref-citations-scholar-note = Google Scholar has no public API, so the plugin reads the "Cited by" number from its results page. When Google asks for a human check or rate-limits the reads, the plugin handles it first: it pauses, then retries automatically after 10 minutes, then 20, then 40 (up to two hours), and the first two retries pass silently. Only a third consecutive block raises a notice, saying how long the wait is and how to clear the check. Another provider's number is never substituted.
pref-citations-source = Citation source
pref-citations-source-scholar =
    .label = Google Scholar (default)
pref-citations-source-openalex =
    .label = OpenAlex
pref-citations-source-s2 =
    .label = Semantic Scholar
pref-citations-source-note = The number only ever comes from the sources that are ticked. With one source: its count, or nothing. With several: all of them are read and the largest is shown (hover to see which source it came from). The three providers do not measure the same thing - Google Scholar indexes preprints, theses and books that OpenAlex does not, and the two figures for one paper can differ twofold - so only Google Scholar is ticked by default.
pref-citations-s2-note = Semantic Scholar rate-limits requests without an API key; a 429 is skipped and retried later.
pref-refresh-title = Refreshing and network
pref-refresh-desc = The context menu can re-read like counts and citation counts separately (the cells show "…" while it runs, then a summary appears); the cache can also expire on its own.
pref-refresh-ttl = Re-fetch cached like counts after (days, 0 = never)
pref-refresh-interval = Minimum delay between requests to the same host (ms)
pref-refresh-timeout = Request timeout (ms)

pref-filter-title = Like-count range filter
pref-filter-desc = Focus the column on a band of like counts; bounds of 0 mean no bound. Rows outside the band stay visible and are dimmed; their counts are untouched.
pref-filter-enabled =
    .label = Enable the like-count range filter
pref-filter-min = Minimum likes
pref-filter-max = Maximum likes (0 = no upper bound)

scholar-picker-title = Choose the Google Scholar record
scholar-picker-heading = Results for the paper's title
scholar-picker-subheading = Pick the record whose citation count should be shown for this item. The choice is remembered, so later refreshes keep using it.
scholar-picker-pinned = Currently used: {title}
scholar-picker-empty = This search returned no results.
scholar-picker-blocked = Google answered with a human check instead of results. Clear it in your browser, then press Search again.
scholar-picker-error = The search failed: {message}
scholar-picker-search = Search again
scholar-picker-searching = Searching Google Scholar…
scholar-picker-open = Open the search in the browser
scholar-picker-apply = Use this record's citation count
scholar-picker-clear = Forget the chosen record
scholar-picker-cancel = Cancel
scholar-picker-count = Cited by {count}
scholar-picker-count-unknown = No citation count shown
scholar-picker-nomatch = (no title)
pref-color-swatches = Every colour box has a row of swatches next to it; click one instead of typing.
pref-citation-appearance-title = Citations appearance
pref-citation-appearance-desc = Citation counts and like counts usually differ by orders of magnitude, so one set of thresholds rarely suits both. With "follow the likes" ticked, both columns look the same and a single set of values in Appearance / Colours / Range is enough. Untick it to give the Citations column its own style, colours and range filter.
pref-citation-appearance-linked =
    .label = Citations follow the likes appearance
pref-citation-appearance-style = Citations display style
pref-citation-color-enabled =
    .label = Colour the citation counts
pref-citation-color-high-threshold = High-citation threshold
pref-citation-color-low-threshold = Low-citation threshold
pref-citation-color-mid = Mid-range colour (empty keeps the theme colour)
pref-citation-filter-enabled =
    .label = Enable the citation-count range filter
pref-citation-filter-min = Fewest citations
pref-citation-filter-max = Most citations (0 = no limit)
pref-citation-filter-note = Like the like-count filter: out-of-range rows stay visible, just dimmed.
pref-citations-sources = Citation sources (several may be selected; the largest count is shown)
