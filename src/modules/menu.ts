/**
 * The plugin's one menu entry.
 *
 * An icon, the plugin's name, and the actions underneath — the same entry in
 * the Tools menu and in the item context menu, so there is one place to look
 * rather than five entries scattered down a right-click.
 *
 * Everything here is an explicit action on the *data*: re-read the like counts,
 * re-read the citation counts, open the paper's alphaXiv page, open Google
 * Scholar's verification page, or take this plugin's records back out of
 * `Extra`. Looking a paper up is not one of them — matching runs on its own, in
 * the background, at the confidence threshold the settings ask for.
 *
 * The clear action deletes only what this plugin wrote (`alphaxiv_*` lines,
 * through `stripAlphaLikesData`); everything else an item has in `Extra` stays
 * exactly as it was, and nothing outside `Extra` is touched. Cleared items are
 * not written to again until they are refreshed, which is what keeps the next
 * automatic lookup from undoing the action. The manual pickers (find the arXiv
 * ID, choose a Scholar record) stay removed, and scripts/check-addon.py holds
 * both ends of that line rather than memory.
 */

import pkg from "../../package.json";
import { getService } from "./column";
import { getCitationPrefs, getCitationSourcePreferences } from "./prefs";
import { t } from "./l10n";
import { toast } from "./notify";
import type { RefreshSummary } from "./service";

const MENU_ID = "alphalikes-menu";
const MENU_POPUP_ID = "alphalikes-menu-popup";
const TOOLS_MENU_ID = "alphalikes-tools-menu";
const TOOLS_POPUP_ID = "alphalikes-tools-popup";
const SEPARATOR_ID = "alphalikes-itemmenu-separator";
const REFRESH_ID = "alphalikes-refresh-likes";
const REFRESH_CITATIONS_ID = "alphalikes-refresh-citations";
const OPEN_ALPHAXIV_ID = "alphalikes-open-alphaxiv";
const OPEN_SCHOLAR_ID = "alphalikes-open-scholar";
const RESET_GOOGLE_ID = "alphalikes-reset-google";
const CLEAR_ID = "alphalikes-clear-data";

/**
 * The icon on the one menu entry.
 *
 * The bootstrap maps `content/` to `chrome://alphalikes/`, which is the same
 * path the settings pane uses for its own icon.
 */
const ICON_URL = "chrome://alphalikes/content/icons/favicon.png";

type WindowWithAlert = Window & {
  alert?: (message: string) => void;
};

function createMenuItem(
  doc: Document,
  id: string,
  label: string,
  onCommand: () => void,
): Element {
  const element = createXULElement(doc, "menuitem");

  element.setAttribute("id", id);
  element.setAttribute("label", label);
  element.addEventListener("command", onCommand);
  return element;
}

function createXULElement(doc: Document, name: string): Element {
  const xulDocument = doc as Document & {
    createXULElement?: (name: string) => Element;
  };

  return xulDocument.createXULElement
    ? xulDocument.createXULElement(name)
    : doc.createElementNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        name,
      );
}

function createSeparator(doc: Document, id: string): Element {
  const element = createXULElement(doc, "menuseparator");
  element.setAttribute("id", id);
  return element;
}

/**
 * The plugin's one entry: an icon, the name, and the actions underneath.
 *
 * Every action this plugin offers lives in here and nowhere else. A row of
 * five context-menu entries is what the earlier versions had, and it read as
 * five unrelated features rather than one plugin; the submenu is also what
 * makes the alphaXiv and Scholar pages discoverable, since nothing on the item
 * row suggests they exist.
 */
function createMenu(
  doc: Document,
  id: string,
  popupId: string,
  label: string,
): { menu: Element; popup: Element } {
  const menu = createXULElement(doc, "menu");
  menu.setAttribute("id", id);
  menu.setAttribute("label", label);
  menu.setAttribute("class", "menu-iconic");
  menu.setAttribute("image", ICON_URL);
  // XUL draws the icon from `list-style-image`; the attribute above is what
  // the platform's own menu items use, and both are set so neither engine
  // version is left without one.
  (menu as HTMLElement).setAttribute(
    "style",
    `list-style-image: url("${ICON_URL}");`,
  );

  const popup = createXULElement(doc, "menupopup");
  popup.setAttribute("id", popupId);
  menu.append(popup);

  return { menu, popup };
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
    Zotero.debug(`[AlphaPulse] ${message}`);
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
/**
 * What each entry of the menu should look like, from the four things it
 * depends on.
 *
 * A pure function of those four, so the rule can be read and tested without a
 * live popup: whether an entry is offered is decided here and nowhere else,
 * and the popup handler merely copies the answer onto the elements.
 */
export interface MenuState {
  /** How many rows are selected. */
  count: number;
  citationsEnabled: boolean;
  findsScholar: boolean;
  /** Whether any selected row has a paper on alphaXiv to open. */
  openableAlphaXiv: boolean;
}

export interface MenuVisibility {
  entry: boolean;
  refresh: boolean;
  refreshCitations: boolean;
  openAlphaXiv: boolean;
  openScholar: boolean;
  resetGoogle: boolean;
  clear: boolean;
}

export function menuVisibility(state: MenuState): MenuVisibility {
  return {
    // With nothing selected the entry leaves the item menu; the Tools menu
    // keeps it, because resetting the Google session is about the session and
    // not about a row, and the caller ignores this field for that host.
    entry: state.count > 0,
    refresh: state.count > 0,
    // Nothing to refresh or verify while the Citations column is off.
    refreshCitations: state.count > 0 && state.citationsEnabled,
    openAlphaXiv: state.count > 0 && state.openableAlphaXiv,
    openScholar: state.citationsEnabled && state.findsScholar,
    resetGoogle: state.citationsEnabled && state.findsScholar,
    clear: state.count > 0,
  };
}

/** Whether the Citations column is on, with a failed read counting as "off". */
function isCitationsEnabled(): boolean {
  try {
    return getCitationPrefs().enabled;
  } catch (error) {
    Zotero.debug(
      `[AlphaPulse] Could not read the citation preferences: ${error}`,
    );
    return false;
  }
}

/** Whether Google Scholar is among the sources, guarded the same way. */
function readsGoogleScholar(): boolean {
  try {
    return getCitationSourcePreferences().includes("googleScholar");
  } catch (error) {
    Zotero.debug(`[AlphaPulse] Could not read the citation sources: ${error}`);
    return false;
  }
}

/**
 * Hides or shows one XUL entry.
 *
 * `hidden` is the attribute XUL reads; the property is set as well because
 * that is what a test (and any plain DOM code) checks.
 */
function setHidden(element: Element, hidden: boolean): void {
  const target = element as HTMLElement;
  target.hidden = hidden;
  if (hidden) element.setAttribute("hidden", "true");
  else element.removeAttribute("hidden");
}

/** Whether any of the selected rows has an alphaXiv page to open. */
function hasAlphaXivPage(item: Zotero.Item): boolean {
  try {
    return getService().alphaXivPageURL(item) !== null;
  } catch (error) {
    Zotero.debug(
      `[AlphaPulse] Could not read the arXiv ID of an item: ${error}`,
    );
    return false;
  }
}

export function refreshSummaryText(
  summary: RefreshSummary,
  updated: string,
): string {
  if (!summary.total) return t("refresh-nothing");

  const parts = [updated];
  if (summary.failed) {
    // With a retry time when one is set: "N failed" alone leaves the user
    // wondering whether they have to do something about it.
    parts.push(
      summary.retryMinutes === undefined
        ? t("refresh-failed", { failed: summary.failed })
        : t("refresh-failed-retry", {
            failed: summary.failed,
            minutes: summary.retryMinutes,
          }),
    );
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
 * Deliberately narrow: only the lines AlphaPulse wrote are removed, and the
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

/**
 * Throws away Zotero's Google session and reads the blocked items again.
 *
 * The entry exists because the two halves of a Scholar block live in different
 * places: the wait is the plugin's, the marking is Google's, and it is carried
 * by Zotero's own cookie jar. A user whose browser shows the very same search
 * while the plugin is refused has no way to hand that session over - dropping
 * the jar is the closest thing to it, and it is offered rather than done
 * silently, because it signs the application out of Google.
 */
async function resetGoogleSession(win: Window): Promise<void> {
  try {
    const summary = await getService().resetGoogleSession();
    toast(
      t("notify-scholar-title"),
      t("reset-google-done", { cookies: summary.cookies }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notify(win, `${t("progress-error")} ${message}`);
  }
}

/**
 * Opens the paper's alphaXiv page in the user's browser.
 *
 * The like count comes from that page, and until now the only way to see it
 * was to build the address by hand: the number in the column is a summary of
 * something the user cannot look at. The first selected item that has an arXiv
 * ID is the one opened - with a mixed selection there is no single page to
 * open, and guessing one would be worse than saying so.
 */
function openAlphaXivPage(win: Window): void {
  const items = selectedItems(win);
  const target = items.find((item) => getService().alphaXivPageURL(item));

  if (!target) {
    notify(win, t("error-no-arxiv-id"));
    return;
  }

  getService().openAlphaXivPage(target);
  toast(t("notify-alphaxiv-title"), t("notify-open-alphaxiv"));
}

/**
 * Opens the paper's own Scholar search in the user's browser.
 *
 * With a notice, because this action was long described as a way to lift the
 * limit - "complete the check and refresh" - which it never was: it opens the
 * page in the browser's session, and the plugin reads through Zotero's own.
 * Two clients, two sessions. It is still worth having (the numbers can be read
 * there by eye, and the report asks for a comparison), so it stays, and says
 * what it does.
 */
function openScholarVerification(win: Window): void {
  const items = selectedItems(win);
  getService().openScholarVerification(items.length === 1 ? items[0] : null);
  toast(t("notify-scholar-title"), t("notify-open-scholar"));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerItemMenu(win: _ZoteroTypes.MainWindow): void {
  try {
    const doc = win.document;
    const itemPopup = doc.getElementById("zotero-itemmenu");
    const toolsPopup = doc.getElementById("menu_ToolsPopup");
    if (doc.getElementById(MENU_ID) || (!itemPopup && !toolsPopup)) return;

    // One set of commands, two hosts: the Tools menu is where a user looks for
    // a plugin, and the item menu is where the selection already is.
    const hosts: Array<{ host: Element | null; id: string; popupId: string }> =
      [
        { host: itemPopup, id: MENU_ID, popupId: MENU_POPUP_ID },
        { host: toolsPopup, id: TOOLS_MENU_ID, popupId: TOOLS_POPUP_ID },
      ];

    for (const { host, id, popupId } of hosts) {
      if (!host || doc.getElementById(id)) continue;

      const { menu, popup } = createMenu(
        doc,
        id,
        popupId,
        pkg.config.addonName,
      );

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
      const openAlphaXiv = createMenuItem(
        doc,
        OPEN_ALPHAXIV_ID,
        t("menu-open-alphaxiv"),
        () => {
          openAlphaXivPage(win);
        },
      );
      // Google Scholar is the only provider that can ask the user to prove
      // they are human, so these two exist only while it is among the sources.
      const openScholar = createMenuItem(
        doc,
        OPEN_SCHOLAR_ID,
        t("menu-open-scholar"),
        () => {
          openScholarVerification(win);
        },
      );
      const resetGoogle = createMenuItem(
        doc,
        RESET_GOOGLE_ID,
        t("menu-reset-google"),
        () => {
          void resetGoogleSession(win);
        },
      );
      const clear = createMenuItem(doc, CLEAR_ID, t("menu-clear"), () => {
        void clearSelectedItems(win);
      });

      // In the order the actions are usually wanted: read, read, go and look,
      // verify, and - last, behind a separator - take the records back out.
      popup.append(
        refresh,
        refreshCitations,
        openAlphaXiv,
        openScholar,
        resetGoogle,
        createSeparator(doc, SEPARATOR_ID),
        clear,
      );
      host.append(menu);

      popup.addEventListener("popupshowing", () => {
        // The four inputs are read defensively - a note, an attachment, an
        // item whose fields throw - and the decision itself is `menuVisibility`.
        // The earlier version computed this inline and let the first throw end
        // the whole handler, which left every entry in whatever state the
        // previous opening gave it: entries that looked available and did
        // nothing when clicked.
        const items = selectedItems(win);
        const visibility = menuVisibility({
          count: items.length,
          citationsEnabled: isCitationsEnabled(),
          findsScholar: readsGoogleScholar(),
          openableAlphaXiv: items.some((item) => hasAlphaXivPage(item)),
        });

        setHidden(refresh, !visibility.refresh);
        setHidden(refreshCitations, !visibility.refreshCitations);
        setHidden(openAlphaXiv, !visibility.openAlphaXiv);
        setHidden(openScholar, !visibility.openScholar);
        setHidden(resetGoogle, !visibility.resetGoogle);
        setHidden(clear, !visibility.clear);
        // Only the item menu hides its whole entry; see `menuVisibility`.
        if (id === MENU_ID) setHidden(menu, !visibility.entry);
      });
    }
  } catch (error) {
    Zotero.debug(`[AlphaPulse] Could not register the item menu: ${error}`);
  }
}

export function unregisterItemMenu(win: Window): void {
  try {
    const doc = win.document;
    for (const id of [
      // The popups go with their menus, and are listed anyway: a menu whose
      // popup was left behind is a menu that comes back empty.
      MENU_ID,
      MENU_POPUP_ID,
      TOOLS_MENU_ID,
      TOOLS_POPUP_ID,
      SEPARATOR_ID,
      REFRESH_ID,
      REFRESH_CITATIONS_ID,
      OPEN_ALPHAXIV_ID,
      OPEN_SCHOLAR_ID,
      RESET_GOOGLE_ID,
      CLEAR_ID,
    ]) {
      doc.getElementById(id)?.remove();
    }
  } catch {
    // The window is already gone.
  }
}
