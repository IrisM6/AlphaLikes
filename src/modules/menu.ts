/**
 * Item context-menu entries.
 *
 * Everything here is an explicit action on the *data*: re-read the like counts,
 * re-read the citation counts, open Google Scholar's verification page, or take
 * this plugin's records back out of `Extra`. Looking a paper up is not one of
 * them — matching runs on its own, in the background, at the confidence
 * threshold the settings ask for.
 *
 * The clear action deletes only what this plugin wrote (`alphaxiv_*` lines,
 * through `stripAlphaLikesData`); everything else an item has in `Extra` stays
 * exactly as it was, and nothing outside `Extra` is touched. Cleared items are
 * not written to again until they are refreshed, which is what keeps the next
 * automatic lookup from undoing the action. The manual pickers (find the arXiv
 * ID, choose a Scholar record) stay removed, and scripts/check-addon.py holds
 * both ends of that line rather than memory.
 */

import { getService } from "./column";
import { getCitationPrefs, getCitationSourcePreferences } from "./prefs";
import { t } from "./l10n";
import { toast } from "./notify";
import type { RefreshSummary } from "./service";

const SEPARATOR_ID = "alphalikes-itemmenu-separator";
const REFRESH_ID = "alphalikes-refresh-likes";
const REFRESH_CITATIONS_ID = "alphalikes-refresh-citations";
const OPEN_SCHOLAR_ID = "alphalikes-open-scholar";
const CLEAR_ID = "alphalikes-clear-data";

type WindowWithAlert = Window & {
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

function notify(win: Window, message: string): void {
  const target = win as WindowWithAlert;
  try {
    target.alert?.(message);
  } catch {
    Zotero.debug(`[AlphaLikes] ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

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

/**
 * Takes this plugin's records back out of the selected items' `Extra`.
 *
 * Deliberately narrow: only the lines AlphaLikes wrote are removed, and the
 * items are then left alone until a refresh asks for them again, so the
 * automatic lookup cannot write them straight back. The summary says both of
 * those things, because "cleared" that reappears a second later looks like a
 * bug rather than a setting.
 */
async function clearSelectedItems(win: Window): Promise<void> {
  const items = selectedItems(win);
  if (!items.length) {
    notify(win, t("error-no-selection"));
    return;
  }

  try {
    const summary = await getService().clearItems(items);
    toast(
      t("notify-clear-title"),
      summary.cleared
        ? t("clear-done", { count: summary.cleared })
        : t("clear-none"),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notify(win, `${t("progress-error")} ${message}`);
  }
}

/** Opens the paper's own Scholar search in the browser. */
function openScholarVerification(win: Window): void {
  const items = selectedItems(win);
  getService().openScholarVerification(items.length === 1 ? items[0] : null);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerItemMenu(win: _ZoteroTypes.MainWindow): void {
  try {
    const doc = win.document;
    const popup = doc.getElementById("zotero-itemmenu");
    if (!popup || doc.getElementById(REFRESH_ID)) return;

    const refresh = createMenuItem(doc, REFRESH_ID, t("menu-refresh"), () => {
      void refreshSelectedItems(win);
    });
    const refreshCitations = createMenuItem(
      doc,
      REFRESH_CITATIONS_ID,
      t("menu-refresh-citations"),
      () => {
        void refreshSelectedCitations(win);
      },
    );
    // Google Scholar is the only provider that can ask the user to prove they
    // are human, so this entry exists only while it is among the sources.
    const openScholar = createMenuItem(
      doc,
      OPEN_SCHOLAR_ID,
      t("menu-open-scholar"),
      () => {
        openScholarVerification(win);
      },
    );

    const clear = createMenuItem(doc, CLEAR_ID, t("menu-clear"), () => {
      void clearSelectedItems(win);
    });

    // One group, in the order the actions are usually wanted: read, read,
    // verify, and - last - take this plugin's records back out of `Extra`.
    popup.append(
      createSeparator(doc, SEPARATOR_ID),
      refresh,
      refreshCitations,
      openScholar,
      clear,
    );

    popup.addEventListener("popupshowing", () => {
      const count = selectedItems(win).length;
      const citationPrefs = getCitationPrefs();
      const findsScholar =
        getCitationSourcePreferences().includes("googleScholar");

      (refresh as HTMLElement).hidden = count === 0;
      // Nothing to refresh or verify while the Citations column is off.
      (refreshCitations as HTMLElement).hidden =
        count === 0 || !citationPrefs.enabled;
      (openScholar as HTMLElement).hidden =
        !citationPrefs.enabled || !findsScholar;
      (clear as HTMLElement).hidden = count === 0;
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
      REFRESH_ID,
      REFRESH_CITATIONS_ID,
      OPEN_SCHOLAR_ID,
      CLEAR_ID,
    ]) {
      doc.getElementById(id)?.remove();
    }
  } catch {
    // The window is already gone.
  }
}
