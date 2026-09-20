import { config } from "../package.json";
import {
  registerAlphaXivLikesColumn,
  shutdownAlphaXivLikesColumn,
} from "./modules/column";
import { loadStrings } from "./modules/l10n";
import { registerItemMenu, unregisterItemMenu } from "./modules/menu";
import { observePrefs } from "./modules/prefs";

/**
 * Registers the AlphaLikes pane in Zotero's settings window.
 *
 * `Zotero.PreferencePanes` is not part of the bundled Zotero typings yet, so
 * the call is made through a narrow structural type.
 *
 * The pane icon must be a raster image: the sidebar renders it through a XUL
 * `<image>`, which sizes the source from its intrinsic dimensions. An SVG with
 * only a `viewBox` has none and would render as nothing. These files exist at
 * several sizes so HiDPI displays stay sharp.
 */
function registerPreferencePane(): void {
  const zotero = Zotero as unknown as {
    PreferencePanes?: {
      register(options: {
        pluginID: string;
        src: string;
        label: string;
        image?: string;
      }): unknown;
    };
  };

  try {
    zotero.PreferencePanes?.register({
      pluginID: config.addonID,
      src: `${rootURI}content/preferences.xhtml`,
      label: config.addonName,
      image: `chrome://${config.addonRef}/content/icons/favicon.png`,
    });
  } catch (error) {
    Zotero.logError(
      new Error(
        `[AlphaLikes] Could not register the preference pane: ${error}`,
      ),
    );
  }
}

async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  await registerAlphaXivLikesColumn();
  // Localised menu labels are read from the cache, so fill it first.
  await loadStrings();

  try {
    registerPreferencePane();
  } catch (error) {
    // A missing pane must not stop the column from working.
    Zotero.logError(error as Error);
  }

  // Repaint the column when a setting changes, so colour edits show up without
  // a restart. Column registration owns the repaint callback.
  try {
    observePrefs(() => {
      void Zotero.ItemTreeManager.refreshColumns?.();
    });
  } catch (error) {
    Zotero.debug(`[AlphaLikes] Could not observe preferences: ${error}`);
  }

  for (const win of Zotero.getMainWindows()) {
    registerItemMenu(win);
  }

  addon.data.initialized = true;
  Zotero.debug("[AlphaLikes] alphaXiv Likes column registered");
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  registerItemMenu(win);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  unregisterItemMenu(win);
}

async function onShutdown(): Promise<void> {
  for (const win of Zotero.getMainWindows()) {
    unregisterItemMenu(win);
  }

  await shutdownAlphaXivLikesColumn();
  addon.data.alive = false;

  const zoteroWithPlugin = Zotero as _ZoteroTypes.Zotero & {
    [key: string]: unknown;
  };
  delete zoteroWithPlugin[addon.data.config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
