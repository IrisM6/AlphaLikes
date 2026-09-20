/**
 * Settings-pane bootstrap.
 *
 * Loaded through `Zotero.PreferencePanes.register({ scripts: [...] })`, which
 * runs pane scripts *before* the pane markup is parsed and inserted. That
 * ordering is what the Zotero developer docs ask for: the Fluent file has to
 * be in the window before anything that carries a `data-l10n-id` is added.
 *
 * The pane markup also contains a `<linkset>` with the same file, so the
 * declarative path works too. Doing both is deliberate - the linkset can only
 * be picked up once the fragment is in the document, and a translation that
 * runs before the resource is ready leaves labels empty.
 *
 * The file name is the *built* one: `zotero-plugin-scaffold` prefixes every
 * FTL in `addon/locale/<locale>/` with the add-on reference.
 */
(function () {
  var FTL_FILE = "__addonRef__-addon.ftl";
  var global = this;

  try {
    var win = global.window || global;
    if (win && win.MozXULElement && win.MozXULElement.insertFTLIfNeeded) {
      win.MozXULElement.insertFTLIfNeeded(FTL_FILE);
    }
  } catch (error) {
    // Not fatal: the pane is written with Chinese fallback text, so it stays
    // readable, and Zotero still parses the linkset from the markup.
    Zotero.logError(
      new Error("[AlphaLikes] could not insert " + FTL_FILE + ": " + error),
    );
  }
})();
