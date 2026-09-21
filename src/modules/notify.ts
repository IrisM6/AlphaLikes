/**
 * Non-blocking notifications and opening a page in the user's browser.
 *
 * The service runs in the background, so it cannot raise a modal dialog
 * without hijacking the window the user is working in. A progress window is
 * the right weight for "this will retry by itself in ten minutes", and the
 * URL has to go to the system browser because Zotero's own HTTP stack keeps
 * its own cookie jar - a human check completed inside a Zotero tab would not
 * be seen by the requests the plugin makes.
 */

/** Shows a short-lived, non-modal toast in the corner of the main window. */
export function toast(headline: string, message: string, ms = 10_000): void {
  try {
    const ProgressWindow = (
      Zotero as unknown as {
        ProgressWindow?: new (options?: { closeOnClick?: boolean }) => {
          changeHeadline(text: string): void;
          addDescription(text: string): void;
          show(): void;
          startCloseTimer(ms: number): void;
        };
      }
    ).ProgressWindow;

    if (!ProgressWindow) {
      Zotero.debug(`[AlphaLikes] ${headline}: ${message}`);
      return;
    }

    const window = new ProgressWindow({ closeOnClick: true });
    window.changeHeadline(headline);
    window.addDescription(message);
    window.show();
    window.startCloseTimer(ms);
  } catch (error) {
    // A notification is a courtesy; never let it break the work behind it.
    Zotero.debug(`[AlphaLikes] could not show a notification: ${error}`);
  }
}

/** Opens a URL in the user's default browser. */
export function openExternal(url: string): void {
  try {
    Zotero.launchURL(url);
  } catch (error) {
    Zotero.debug(`[AlphaLikes] could not open ${url}: ${error}`);
  }
}
