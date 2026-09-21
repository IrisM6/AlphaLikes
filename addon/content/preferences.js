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
 *
 * The rest of this file waits for the pane markup to appear and then wires up
 * the three things XUL preferences cannot express on their own:
 *
 *   1. a row of clickable colour swatches next to every colour box, so a
 *      colour can be chosen instead of typed;
 *   2. the citation-source checkboxes, because the selection is stored as one
 *      comma-separated preference (`googleScholar,openAlex`) rather than as
 *      three independent booleans;
 *   3. the "citations follow the likes appearance" switch, which shows or
 *      hides the citation-only appearance controls.
 */
(function () {
  var FTL_FILE = "__addonRef__-addon.ftl";
  var BRANCH = "extensions.zotero.alphalikes.";

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

  /**
   * Colours offered as swatches.
   *
   * Chosen to cover what the styles actually use - the greens and greys of the
   * like bands, the blues and browns of the palette styles, plus a couple of
   * emphatic reds and a near-black - so the common choices are one click.
   */
  var SWATCHES = [
    "#1a7f37",
    "#2e7d32",
    "#00695c",
    "#0b7285",
    "#1565c0",
    "#3949ab",
    "#6a1b9a",
    "#ad1457",
    "#c62828",
    "#e65100",
    "#b45309",
    "#8d6e63",
    "#546e7a",
    "#37474f",
    "#9aa0a6",
    "#111111",
  ];

  var XHTML_NS = "http://www.w3.org/1999/xhtml";

  function html(doc, name) {
    return doc.createElementNS(XHTML_NS, name);
  }

  function readPref(name) {
    try {
      return Zotero.Prefs.get(BRANCH + name, true);
    } catch {
      return undefined;
    }
  }

  function writePref(name, value) {
    try {
      Zotero.Prefs.set(BRANCH + name, value, true);
    } catch (error) {
      Zotero.debug("[AlphaLikes] could not write " + name + ": " + error);
    }
  }

  /** Normalises a typed colour so the swatch comparison can match it. */
  function normalizeColor(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  // -------------------------------------------------------------------------
  // Colour swatches
  // -------------------------------------------------------------------------

  /**
   * Builds the swatch row for one colour input.
   *
   * The input keeps working exactly as before - the swatches are an addition,
   * not a replacement - and clicking a swatch writes the preference through
   * the input, so Zotero's own preference binding stays the single writer.
   */
  function attachSwatches(doc, input) {
    var row = html(doc, "span");
    row.className = "alphalikes-swatches";
    row.setAttribute(
      "style",
      "display: inline-flex; flex-wrap: wrap; gap: 3px; margin-inline-start: 6px; vertical-align: middle;",
    );

    var cells = [];

    function current() {
      return normalizeColor(input.value);
    }

    function paint() {
      var value = current();
      cells.forEach(function (cell) {
        var active = normalizeColor(cell.getAttribute("data-color")) === value;
        cell.setAttribute(
          "style",
          "display: inline-block; width: 14px; height: 14px; border-radius: 3px; cursor: pointer; box-sizing: border-box; background: " +
            cell.getAttribute("data-color") +
            "; border: 2px solid " +
            (active ? "AccentColor" : "rgba(128, 128, 128, 0.45)") +
            ";",
        );
        cell.setAttribute("title", cell.getAttribute("data-color"));
        cell.setAttribute("aria-checked", active ? "true" : "false");
      });
    }

    SWATCHES.forEach(function (color) {
      var cell = html(doc, "span");
      cell.className = "alphalikes-swatch";
      cell.setAttribute("role", "button");
      cell.setAttribute("data-color", color);
      cell.addEventListener("click", function (event) {
        if (event) event.preventDefault();
        input.value = color;
        // `change` is what Zotero's preference binding listens for; `input`
        // as well, because the binding differs between Gecko versions.
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        paint();
      });
      row.appendChild(cell);
      cells.push(cell);
    });

    input.addEventListener("input", paint);
    input.addEventListener("change", paint);
    paint();

    return row;
  }

  function wireSwatches(doc) {
    var inputs = doc.querySelectorAll(".alphalikes-color-input");
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      if (!input.parentNode) continue;
      if (input.parentNode.querySelector(".alphalikes-swatches")) continue;
      input.parentNode.appendChild(attachSwatches(doc, input));
    }
    return inputs.length;
  }

  // -------------------------------------------------------------------------
  // Citation sources
  // -------------------------------------------------------------------------

  var CANONICAL_SOURCES = ["googleScholar", "openAlex", "semanticScholar"];

  function readSources() {
    var raw = String(readPref("citationSourcePreferences") || "");
    var picked = raw
      .split(",")
      .map(function (part) {
        return part.trim();
      })
      .filter(function (part) {
        return CANONICAL_SOURCES.indexOf(part) !== -1;
      });

    if (!picked.length) {
      // Nothing written yet: the single-source preference of 1.6.0 decides,
      // which is what keeps an upgrade from changing the source silently.
      var legacy = String(readPref("citationSourcePreference") || "");
      if (CANONICAL_SOURCES.indexOf(legacy) !== -1) return [legacy];
      return ["googleScholar"];
    }

    return CANONICAL_SOURCES.filter(function (source) {
      return picked.indexOf(source) !== -1;
    });
  }

  function wireSources(doc) {
    var boxes = doc.querySelectorAll(".alphalikes-citation-source");
    if (!boxes.length) return 0;

    var current = readSources();

    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var source = box.getAttribute("data-source");
      box.checked = current.indexOf(source) !== -1;
      box.addEventListener("command", function (event) {
        onToggle(event && event.target ? event.target : null);
      });
    }

    function onToggle(target) {
      if (!target) return;

      var picked = [];
      for (var j = 0; j < boxes.length; j++) {
        if (boxes[j].checked) picked.push(boxes[j].getAttribute("data-source"));
      }

      // At least one source has to stay selected: "no source" would leave the
      // column permanently empty with no way to tell why.
      if (!picked.length) {
        target.checked = true;
        picked = [target.getAttribute("data-source")];
      }

      writePref(
        "citationSourcePreferences",
        CANONICAL_SOURCES.filter(function (item) {
          return picked.indexOf(item) !== -1;
        }).join(","),
      );
    }

    return boxes.length;
  }

  // -------------------------------------------------------------------------
  // Citation appearance linkage
  // -------------------------------------------------------------------------

  function wireAppearanceLink(doc) {
    var toggle = doc.getElementById("alphalikes-pref-appearance-linked");
    var group = doc.getElementById("alphalikes-citation-appearance");
    if (!toggle || !group) return 0;

    function sync() {
      var linked;
      try {
        linked = Boolean(toggle.checked);
      } catch {
        linked = Boolean(readPref("appearanceLinked"));
      }
      if (linked) group.setAttribute("hidden", "true");
      else group.removeAttribute("hidden");
    }

    toggle.addEventListener("command", function () {
      // The binding writes the preference on the same event; deferring by a
      // turn lets the checkbox's own state settle first.
      global.setTimeout ? global.setTimeout(sync, 0) : sync();
    });

    sync();
    return 1;
  }

  // -------------------------------------------------------------------------

  function wire() {
    var doc = global.document;
    if (!doc) return false;
    if (!doc.getElementById("alphalikes-citation-sources")) return false;

    try {
      wireSwatches(doc);
      wireSources(doc);
      wireAppearanceLink(doc);
    } catch (error) {
      Zotero.logError(
        new Error("[AlphaLikes] settings pane setup failed: " + error),
      );
    }
    return true;
  }

  /**
   * Runs `wire` once the pane markup is in the document.
   *
   * This script runs before the fragment is inserted, so there is nothing to
   * wire up yet. Polling for the pane's own element is the cheapest reliable
   * signal; it gives up after a few seconds rather than running forever.
   */
  var attempts = 0;
  var MAX_ATTEMPTS = 60;

  function ready() {
    if (wire()) return;
    attempts += 1;
    if (attempts < MAX_ATTEMPTS) global.setTimeout(ready, 50);
  }

  if (global.document) {
    if (global.document.readyState === "complete") ready();
    else global.document.addEventListener("DOMContentLoaded", ready);
  }
})();
