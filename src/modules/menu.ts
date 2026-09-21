/**
 * Item context-menu entries: find / confirm an arXiv ID, refresh like counts,
 * and remove AlphaLikes data from the selected items.
 */

import { config } from "../../package.json";
import { extractIDFromLooseText } from "./arxiv-id";
import { getService } from "./column";
import { getCitationSourcePreference } from "./prefs";
import { t, pickerStrings } from "./l10n";
import type { ArxivCandidate, PaperMetadata } from "./resolver";
import { shortAuthorList } from "./similarity";

const SEPARATOR_ID = "alphalikes-itemmenu-separator";
const FIND_ID = "alphalikes-find-arxiv";
const REFRESH_ID = "alphalikes-refresh-likes";
const OPEN_SCHOLAR_ID = "alphalikes-open-scholar";
const CLEAR_ID = "alphalikes-clear-data";
const BATCH_FIND_ID = "alphalikes-batch-find-arxiv";

const PICKER_URL = `chrome://${config.addonRef}/content/arxiv-picker.xhtml`;
const PICKER_WINDOW_NAME = "alphalikes-arxiv-picker";

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
  searchAgain(paper: PaperMetadata): Promise<ArxivCandidate[]>;
  /** Validates free text typed into the dialog; returns `null` when invalid. */
  parseArxivID(value: string): string | null;
  result: PickerResult | null;
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
    searchAgain: (next) => service.searchArxiv(next),
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

async function refreshSelectedItems(win: Window): Promise<void> {
  const items = selectedItems(win);
  if (!items.length) {
    notify(win, t("error-no-selection"));
    return;
  }

  try {
    await getService().refreshItems(items);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notify(win, `${t("progress-error")} ${message}`);
  }
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
    const clear = createMenuItem(doc, CLEAR_ID, t("menu-clear"), () => {
      void clearSelectedItems(win);
    });
    // Google Scholar is the only provider that can ask the user to prove they
    // are human, so it is the only one that needs a way out of a block.
    const openScholar = createMenuItem(
      doc,
      OPEN_SCHOLAR_ID,
      t("menu-open-scholar"),
      () => {
        getService().openScholarVerification();
      },
    );

    popup.append(
      createSeparator(doc, SEPARATOR_ID),
      find,
      batchFind,
      refresh,
      openScholar,
      clear,
    );

    popup.addEventListener("popupshowing", () => {
      const count = selectedItems(win).length;

      // "Find arXiv ID" only makes sense for a single item.
      (find as HTMLElement).hidden = count !== 1;
      // The batch entries need at least two items to be worth offering, and
      // the per-item ones are hidden instead of the batch action.
      (batchFind as HTMLElement).hidden = count < 2;
      (refresh as HTMLElement).hidden = count === 0;
      (clear as HTMLElement).hidden = count === 0;
      // Only relevant while Google Scholar is the source of the counts.
      (openScholar as HTMLElement).hidden =
        getCitationSourcePreference() !== "googleScholar";
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
