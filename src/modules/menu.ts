/**
 * Item context-menu entries: find / confirm an arXiv ID, re-read like counts,
 * re-read citation counts, pick the Google Scholar result an item's citation
 * count comes from, and remove AlphaLikes data from the selected items.
 */

import { config } from "../../package.json";
import { extractIDFromLooseText } from "./arxiv-id";
import { getService } from "./column";
import { getCitationPrefs, getCitationSourcePreferences } from "./prefs";
import { t, pickerStrings, scholarPickerStrings } from "./l10n";
import { openExternal, toast } from "./notify";
import type { ArxivCandidate, PaperMetadata } from "./resolver";
import type { ScholarResult } from "./citations";
import type { RefreshSummary, ScholarLookup } from "./service";
import { shortAuthorList } from "./similarity";

const SEPARATOR_ID = "alphalikes-itemmenu-separator";
const FIND_ID = "alphalikes-find-arxiv";
const REFRESH_ID = "alphalikes-refresh-likes";
const REFRESH_CITATIONS_ID = "alphalikes-refresh-citations";
const PICK_SCHOLAR_ID = "alphalikes-pick-scholar";
const OPEN_SCHOLAR_ID = "alphalikes-open-scholar";
const CLEAR_ID = "alphalikes-clear-data";
const BATCH_FIND_ID = "alphalikes-batch-find-arxiv";

const PICKER_URL = `chrome://${config.addonRef}/content/arxiv-picker.xhtml`;
const PICKER_WINDOW_NAME = "alphalikes-arxiv-picker";
const SCHOLAR_PICKER_URL = `chrome://${config.addonRef}/content/scholar-picker.xhtml`;
const SCHOLAR_PICKER_WINDOW_NAME = "alphalikes-scholar-picker";

/**
 * Title-similarity floor for the manual arXiv picker.
 *
 * Lower than the threshold the automatic resolver applies, because the picker
 * exists precisely for the cases where the automatic score was too low: a
 * user looking at the list can judge a 40% match themselves, and "nothing to
 * choose from" is the one answer this dialog must not give when the search
 * did return something.
 */
const PICKER_MIN_SCORE = 0.2;

export type PickerResult =
  | { action: "apply"; arxivID: string }
  | { action: "clear" }
  | { action: "cancel" };

/** Object handed to the dialog through `window.arguments`. */
export interface PickerRequest {
  strings: Record<string, string>;
  itemTitle: string;
  itemSummary: string;
  currentArxivID: string | null;
  candidates: ArxivCandidate[];
  paper: PaperMetadata;
  /** Whether the dialog should run a search as soon as it opens. */
  autoSearch?: boolean;
  searchAgain(paper: PaperMetadata): Promise<ArxivCandidate[]>;
  /** Validates free text typed into the dialog; returns `null` when invalid. */
  parseArxivID(value: string): string | null;
  result: PickerResult | null;
}

export type ScholarPickerResult =
  | { action: "apply"; result: ScholarResult }
  | { action: "clear" }
  | { action: "cancel" };

/** Object handed to the Scholar picker through `window.arguments`. */
export interface ScholarPickerRequest {
  strings: Record<string, string>;
  itemTitle: string;
  itemSummary: string;
  /** The result currently in use for this item, by title. */
  pinnedTitle: string | null;
  results: ScholarResult[];
  blocked: boolean;
  error: string;
  /** The Scholar search page, for "open it in the browser". */
  searchURL: string;
  searchAgain(): Promise<ScholarLookup>;
  openInBrowser(url: string): void;
  result: ScholarPickerResult | null;
}

type WindowWithPicker = Window & {
  openDialog?: (
    url: string,
    name: string,
    features: string,
    arg: unknown,
  ) => Window | null;
  alert?: (message: string) => void;
};

function createMenuItem(
  doc: Document,
  id: string,
  label: string,
  onCommand: () => void,
): Element {
  const xulDocument = doc as Document & {
    createXULElement?: (name: string) => Element;
  };

  const element = xulDocument.createXULElement
    ? xulDocument.createXULElement("menuitem")
    : doc.createElementNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "menuitem",
      );

  element.setAttribute("id", id);
  element.setAttribute("label", label);
  element.addEventListener("command", onCommand);
  return element;
}

function createSeparator(doc: Document, id: string): Element {
  const xulDocument = doc as Document & {
    createXULElement?: (name: string) => Element;
  };

  const element = xulDocument.createXULElement
    ? xulDocument.createXULElement("menuseparator")
    : doc.createElementNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "menuseparator",
      );

  element.setAttribute("id", id);
  return element;
}

function selectedItems(win: Window): Zotero.Item[] {
  try {
    return win.ZoteroPane?.getSelectedItems?.() ?? [];
  } catch {
    return [];
  }
}

function summarize(paper: PaperMetadata): string {
  const parts: string[] = [];
  if (paper.doi) parts.push(`DOI: ${paper.doi}`);
  if (paper.year) parts.push(String(paper.year));
  const authors = shortAuthorList(paper.authors, 2);
  if (authors) parts.push(authors);
  return parts.join(" · ");
}

function notify(win: Window, message: string): void {
  const target = win as WindowWithPicker;
  try {
    target.alert?.(message);
  } catch {
    Zotero.debug(`[AlphaLikes] ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function openFinderDialog(win: Window): Promise<void> {
  const items = selectedItems(win);
  if (!items.length) {
    notify(win, t("error-no-selection"));
    return;
  }
  if (items.length > 1) {
    notify(win, t("error-single-selection"));
    return;
  }

  const item = items[0];
  const service = getService();
  const paper = service.readPaperMetadata(item);

  const request: PickerRequest = {
    strings: pickerStrings(),
    itemTitle: paper.title || "(untitled)",
    itemSummary: summarize(paper),
    currentArxivID: service.getItemArxivID(item),
    candidates: service.getPendingCandidates(item),
    paper,
    // The dialog searches as it opens; without this it would show "nothing
    // found" until the user pressed 搜索 again, even though a search is
    // exactly what the action is for. The floor is lower than the automatic
    // one so a weak-but-real match is still selectable.
    autoSearch: true,
    searchAgain: (next) =>
      service.searchArxiv(next, { minScore: PICKER_MIN_SCORE }),
    parseArxivID: (value) => extractIDFromLooseText(value),
    result: null,
  };

  const dialogWindow = (win as WindowWithPicker).openDialog?.(
    PICKER_URL,
    PICKER_WINDOW_NAME,
    "chrome,centerscreen,modal,resizable,width=760,height=620",
    request,
  );

  if (!dialogWindow) {
    // Only reachable when `openDialog` is unavailable, e.g. in a test harness.
    Zotero.debug("[AlphaLikes] openDialog is unavailable in this window");
    return;
  }

  const result = request.result;
  if (!result || result.action === "cancel") return;

  if (result.action === "clear") {
    await service.clearItems([item]);
    return;
  }

  if (result.arxivID) {
    await service.applyArxivID(item, result.arxivID);
  }
}

/**
 * Renders what a refresh did.
 *
 * An explicit refresh has to say what it did: the numbers themselves move
 * slowly, so without a summary "it worked" and "it silently failed" look
 * exactly the same in the column.
 */
function refreshSummaryText(summary: RefreshSummary, updated: string): string {
  if (!summary.total) return t("refresh-nothing");

  const parts = [updated];
  if (summary.failed) {
    parts.push(t("refresh-failed", { failed: summary.failed }));
  }
  if (summary.skipped) {
    parts.push(t("refresh-skipped", { skipped: summary.skipped }));
  }
  return parts.join(t("refresh-joining"));
}

async function refreshSelectedItems(win: Window): Promise<void> {
  const items = selectedItems(win);
  if (!items.length) {
    notify(win, t("error-no-selection"));
    return;
  }

  try {
    const summary = await getService().refreshItems(items);
    toast(
      t("notify-refresh-likes-title"),
      refreshSummaryText(
        summary,
        t("refresh-likes-updated", { updated: summary.updated }),
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notify(win, `${t("progress-error")} ${message}`);
  }
}

async function refreshSelectedCitations(win: Window): Promise<void> {
  const items = selectedItems(win);
  if (!items.length) {
    notify(win, t("error-no-selection"));
    return;
  }

  try {
    const summary = await getService().refreshCitations(items);
    toast(
      t("notify-refresh-citations-title"),
      refreshSummaryText(
        summary,
        t("refresh-citations-updated", { updated: summary.updated }),
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notify(win, `${t("progress-error")} ${message}`);
  }
}

/** Opens the paper's own Scholar search in the browser, result picked or not. */
function openScholarVerification(win: Window): void {
  const items = selectedItems(win);
  getService().openScholarVerification(items.length === 1 ? items[0] : null);
}

/**
 * Lets the user choose which Google Scholar record an item's count comes from.
 *
 * The search runs as the dialog opens, on the paper's own title (or on the
 * record previously picked for it), so the list is populated instead of empty.
 * Picking one remembers it, which is what stops the next automatic refresh
 * from matching a different paper with a similar title.
 */
async function openScholarPicker(win: Window): Promise<void> {
  const items = selectedItems(win);
  if (!items.length) {
    notify(win, t("error-no-selection"));
    return;
  }
  if (items.length > 1) {
    notify(win, t("error-single-selection"));
    return;
  }

  const item = items[0];
  const service = getService();
  const paper = service.readPaperMetadata(item);

  let lookup: ScholarLookup = {
    results: [],
    blocked: false,
    url: "",
    error: "",
  };
  try {
    lookup = await service.scholarResults(item);
  } catch (error) {
    lookup = {
      results: [],
      blocked: false,
      url: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const request: ScholarPickerRequest = {
    strings: scholarPickerStrings(),
    itemTitle: paper.title || "(untitled)",
    itemSummary: summarize(paper),
    pinnedTitle: service.getScholarPinnedTitle(item),
    results: lookup.results,
    blocked: lookup.blocked,
    error: lookup.error,
    searchURL: lookup.url,
    searchAgain: () => getService().scholarResults(item),
    openInBrowser: (url) =>
      openExternal(url || getService().scholarVerificationURL(item)),
    result: null,
  };

  const dialogWindow = (win as WindowWithPicker).openDialog?.(
    SCHOLAR_PICKER_URL,
    SCHOLAR_PICKER_WINDOW_NAME,
    "chrome,centerscreen,modal,resizable,width=820,height=640",
    request,
  );

  if (!dialogWindow) {
    Zotero.debug("[AlphaLikes] openDialog is unavailable in this window");
    return;
  }

  const result = request.result;
  if (!result || result.action === "cancel") return;

  if (result.action === "clear") {
    await service.clearScholarResult(item);
    toast(t("notify-refresh-citations-title"), t("scholar-cleared"));
    return;
  }

  await service.applyScholarResult(item, result.result);
  toast(t("notify-refresh-citations-title"), t("scholar-picked"));
}

async function clearSelectedItems(win: Window): Promise<void> {
  const items = selectedItems(win);
  if (!items.length) {
    notify(win, t("error-no-selection"));
    return;
  }

  await getService().clearItems(items);
}

/**
 * Resolves arXiv IDs for a whole selection in one go.
 *
 * Items whose match clears the auto-accept threshold are adopted; the rest
 * keep their candidates so the per-item picker can confirm them later, and the
 * summary says how many of each.
 */
async function batchFindArxiv(win: Window): Promise<void> {
  const items = selectedItems(win);
  if (!items.length) {
    notify(win, t("error-no-selection"));
    return;
  }

  const pending = items.filter((item) => !getService().getItemArxivID(item));
  if (!pending.length) {
    notify(win, t("batch-none-to-do"));
    return;
  }

  notify(win, t("batch-finding", { count: pending.length }));

  try {
    const result = await getService().batchFindArxiv(items);
    notify(
      win,
      t("batch-done", {
        applied: result.applied,
        pending: result.pending,
        notFound: result.notFound,
        alreadyKnown: result.alreadyKnown,
      }),
    );
  } catch (error) {
    notify(win, `${t("progress-error")} ${describe(error)}`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerItemMenu(win: _ZoteroTypes.MainWindow): void {
  try {
    const doc = win.document;
    const popup = doc.getElementById("zotero-itemmenu");
    if (!popup || doc.getElementById(FIND_ID)) return;

    const find = createMenuItem(doc, FIND_ID, t("menu-find-arxiv"), () => {
      void openFinderDialog(win);
    });
    const refresh = createMenuItem(doc, REFRESH_ID, t("menu-refresh"), () => {
      void refreshSelectedItems(win);
    });
    const batchFind = createMenuItem(
      doc,
      BATCH_FIND_ID,
      t("menu-batch-find"),
      () => {
        void batchFindArxiv(win);
      },
    );
    const refreshCitations = createMenuItem(
      doc,
      REFRESH_CITATIONS_ID,
      t("menu-refresh-citations"),
      () => {
        void refreshSelectedCitations(win);
      },
    );
    const clear = createMenuItem(doc, CLEAR_ID, t("menu-clear"), () => {
      void clearSelectedItems(win);
    });
    // Google Scholar is the only provider that can ask the user to prove they
    // are human and the only one whose results make sense to choose between,
    // so these two entries exist only while it is among the selected sources.
    const pickScholar = createMenuItem(
      doc,
      PICK_SCHOLAR_ID,
      t("menu-pick-scholar"),
      () => {
        void openScholarPicker(win);
      },
    );
    const openScholar = createMenuItem(
      doc,
      OPEN_SCHOLAR_ID,
      t("menu-open-scholar"),
      () => {
        openScholarVerification(win);
      },
    );

    popup.append(
      createSeparator(doc, SEPARATOR_ID),
      find,
      batchFind,
      refresh,
      refreshCitations,
      pickScholar,
      openScholar,
      clear,
    );

    popup.addEventListener("popupshowing", () => {
      const count = selectedItems(win).length;
      const citationPrefs = getCitationPrefs();
      const findsScholar =
        getCitationSourcePreferences().includes("googleScholar");

      // "Find arXiv ID" only makes sense for a single item.
      (find as HTMLElement).hidden = count !== 1;
      // The batch entries need at least two items to be worth offering, and
      // the per-item ones are hidden instead of the batch action.
      (batchFind as HTMLElement).hidden = count < 2;
      (refresh as HTMLElement).hidden = count === 0;
      (clear as HTMLElement).hidden = count === 0;
      // Nothing to refresh or choose while the Citations column is off.
      (refreshCitations as HTMLElement).hidden =
        count === 0 || !citationPrefs.enabled;
      (pickScholar as HTMLElement).hidden =
        count !== 1 || !citationPrefs.enabled || !findsScholar;
      (openScholar as HTMLElement).hidden =
        !citationPrefs.enabled || !findsScholar;
    });
  } catch (error) {
    Zotero.debug(`[AlphaLikes] Could not register the item menu: ${error}`);
  }
}

export function unregisterItemMenu(win: Window): void {
  try {
    const doc = win.document;
    for (const id of [
      SEPARATOR_ID,
      FIND_ID,
      REFRESH_ID,
      BATCH_FIND_ID,
      OPEN_SCHOLAR_ID,
      CLEAR_ID,
    ]) {
      doc.getElementById(id)?.remove();
    }
  } catch {
    // The window is already gone.
  }
}
