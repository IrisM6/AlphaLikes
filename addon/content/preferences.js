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
 *   1. a colour preview and a colour-area picker (saturation/value field plus
 *      a hue bar) next to every colour box, so a colour can be picked instead
 *      of typed;
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

  function normalized(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  // -------------------------------------------------------------------------
  // Colour: preview + area picker
  // -------------------------------------------------------------------------

  /** `#rrggbb` for an HSV triple (h in [0, 360), s and v in [0, 1]). */
  function hsvToHex(h, s, v) {
    var c = v * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = v - c;
    var rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];

    return (
      "#" +
      rgb
        .map(function (channel) {
          var value = Math.round((channel + m) * 255);
          return ("0" + Math.min(255, Math.max(0, value)).toString(16)).slice(
            -2,
          );
        })
        .join("")
    );
  }

  /** HSV for a `#rgb` / `#rrggbb` value; `null` for anything else. */
  function hexToHsv(value) {
    var match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(
      String(value || "").trim(),
    );
    if (!match) return null;

    var hex = match[1];
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map(function (char) {
          return char + char;
        })
        .join("");
    }

    var r = parseInt(hex.slice(0, 2), 16) / 255;
    var g = parseInt(hex.slice(2, 4), 16) / 255;
    var b = parseInt(hex.slice(4, 6), 16) / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var delta = max - min;

    var h = 0;
    if (delta !== 0) {
      if (max === r) h = 60 * (((g - b) / delta) % 6);
      else if (max === g) h = 60 * ((b - r) / delta + 2);
      else h = 60 * ((r - g) / delta + 4);
    }
    if (h < 0) h += 360;

    return { h: h, s: max === 0 ? 0 : delta / max, v: max };
  }

  /** The colour shown for a value: `null` for "follow the theme" (empty). */
  function previewColor(value) {
    var text = String(value || "").trim();
    return text;
  }

  /**
   * The pane's single floating picker.
   *
   * One panel serves every colour box: opening it on another box updates the
   * same element, which keeps a dozen pickers out of the document and makes
   * "there is one marker" literally true.
   */
  var picker = null;

  function panelFor(doc) {
    if (picker && picker.parentNode) return picker;

    var panel = html(doc, "div");
    panel.id = "alphalikes-color-panel";
    panel.setAttribute(
      "style",
      [
        "position: fixed",
        "z-index: 1000",
        "padding: 10px",
        "border-radius: 8px",
        "background: -moz-Dialog",
        "color: -moz-DialogText",
        "border: 1px solid rgba(128, 128, 128, 0.5)",
        "box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28)",
        "display: none",
        "gap: 8px",
        "width: 208px",
      ].join("; "),
    );

    var area = html(doc, "div");
    area.className = "alphalikes-color-area";
    area.style.cssText =
      "position: relative; width: 100%; height: 132px; border-radius: 6px; cursor: crosshair;";

    var areaMarker = html(doc, "span");
    areaMarker.className = "alphalikes-color-marker";
    areaMarker.style.cssText =
      "position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,0.55); pointer-events: none;";
    area.appendChild(areaMarker);

    var hue = html(doc, "div");
    hue.className = "alphalikes-color-hue";
    hue.style.cssText =
      "position: relative; height: 14px; margin-top: 8px; border-radius: 7px; cursor: pointer; background: linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%);";

    var hueMarker = html(doc, "span");
    hueMarker.className = "alphalikes-color-marker";
    hueMarker.style.cssText =
      "position: absolute; top: -2px; width: 6px; height: 18px; margin-left: -3px; border-radius: 3px; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,0.55); pointer-events: none;";
    hue.appendChild(hueMarker);

    var readout = html(doc, "div");
    readout.className = "alphalikes-color-readout";
    readout.style.cssText =
      "margin-top: 8px; font-family: monospace; font-size: 0.92em; display: flex; align-items: center; gap: 8px;";

    var sample = html(doc, "span");
    sample.className = "alphalikes-color-sample";
    sample.style.cssText =
      "display: inline-block; width: 16px; height: 16px; border-radius: 4px; border: 1px solid rgba(128,128,128,0.6);";

    var text = html(doc, "span");
    readout.appendChild(sample);
    readout.appendChild(text);

    panel.appendChild(area);
    panel.appendChild(hue);
    panel.appendChild(readout);
    doc.documentElement.appendChild(panel);

    picker = panel;
    picker.alphalikesParts = {
      area: area,
      areaMarker: areaMarker,
      hue: hue,
      hueMarker: hueMarker,
      sample: sample,
      text: text,
    };
    return panel;
  }

  /** One colour box: its preview, its panel state and its preference name. */
  function makeField(doc, input) {
    var prefName = String(input.getAttribute("preference") || "");
    if (prefName.indexOf(BRANCH) === 0)
      prefName = prefName.slice(BRANCH.length);

    var field = {
      input: input,
      prefName: prefName,
      // Editing a colour is what tells the renderer to stop using the style's
      // own colours; the button below puts that back.
      flag:
        prefName.indexOf("citation") === 0
          ? "citationColorsCustomised"
          : "likeColorsCustomised",
      hsv: { h: 140, s: 0.8, v: 0.5 },
      suppress: false,
    };

    var preview = html(doc, "span");
    preview.className = "alphalikes-color-preview";
    preview.setAttribute("role", "button");
    preview.setAttribute("tabindex", "0");
    preview.setAttribute(
      "title",
      input.getAttribute("value") || input.value || "#1a7f37",
    );

    function paintPreview() {
      var value = previewColor(input.value);
      var style = [
        "display: inline-block",
        "width: 20px",
        "height: 20px",
        "margin-inline-end: 6px",
        "border-radius: 4px",
        "vertical-align: middle",
        "cursor: pointer",
        "box-sizing: border-box",
        "border: 1px solid rgba(128, 128, 128, 0.6)",
      ];
      if (value) {
        style.push("background: " + value);
      } else {
        // Empty means "follow the theme" (or, for a palette style, "use the
        // style's own colour"), which a plain swatch cannot show.
        style.push(
          "background: repeating-linear-gradient(45deg, rgba(128,128,128,0.55) 0 4px, transparent 4px 8px)",
        );
      }
      preview.setAttribute("style", style.join("; "));
      var shown = value || "默认";
      preview.setAttribute("title", shown);
      preview.setAttribute("aria-label", shown);
    }

    field.paintPreview = paintPreview;

    input.addEventListener("input", function () {
      paintPreview();
      if (!field.suppress) writePref(field.flag, true);
    });
    input.addEventListener("change", function () {
      paintPreview();
      if (!field.suppress) writePref(field.flag, true);
    });

    preview.addEventListener("click", function (event) {
      if (event) event.preventDefault();
      openPanel(doc, field, preview);
    });
    preview.addEventListener("keypress", function (event) {
      if (event && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        openPanel(doc, field, preview);
      }
    });

    if (input.parentNode) input.parentNode.insertBefore(preview, input);
    paintPreview();
    return field;
  }

  /** Applies a hex value to the box that is currently open. */
  function applyColor(field, value) {
    if (field.suppress) return;
    field.suppress = true;
    try {
      field.input.value = value;
      // Both events, because Zotero's preference binding differs between
      // versions in which one it listens for.
      field.input.dispatchEvent(new Event("input", { bubbles: true }));
      field.input.dispatchEvent(new Event("change", { bubbles: true }));
    } finally {
      field.suppress = false;
    }
    writePref(field.prefName, value);
    writePref(field.flag, true);
    if (field.paintPreview) field.paintPreview();
  }

  /** Repositions and repaints the floating panel for `field`. */
  function openPanel(doc, field, anchor) {
    var panel = panelFor(doc);
    if (field === undefined) {
      panel.style.display = "none";
      panel.alphalikesField = null;
      return;
    }

    // No colour to start from (theme / style default): begin at a mid-tone.
    var hsv = hexToHsv(field.input.value) || { h: 140, s: 0.8, v: 0.45 };
    field.hsv = hsv;
    panel.alphalikesField = field;

    var parts = panel.alphalikesParts;
    parts.area.style.background =
      "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, " +
      hsvToHex(hsv.h, 1, 1) +
      ")";

    var rect = anchor.getBoundingClientRect();
    var left = Math.max(8, Math.min(rect.left, (global.innerWidth || 0) - 228));
    var top = rect.bottom + 6;
    if (global.innerHeight && top + 240 > global.innerHeight) {
      top = Math.max(8, rect.top - 246);
    }
    panel.style.left = left + "px";
    panel.style.top = top + "px";
    panel.style.display = "grid";

    syncMarkers(panel, field);
  }

  function syncMarkers(panel, field) {
    var parts = panel.alphalikesParts;
    var hsv = field.hsv;
    var color = hsvToHex(hsv.h, hsv.s, hsv.v);

    parts.area.style.background =
      "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, " +
      hsvToHex(hsv.h, 1, 1) +
      ")";
    parts.areaMarker.style.left = hsv.s * 100 + "%";
    parts.areaMarker.style.top = (1 - hsv.v) * 100 + "%";
    parts.hueMarker.style.left = (hsv.h / 360) * 100 + "%";
    parts.sample.style.background = color;
    parts.text.textContent = color;

    applyColor(field, color);
  }

  /** Wires dragging/clicking inside the panel. */
  function wirePanel(doc) {
    var panel = panelFor(doc);
    var parts = panel.alphalikesParts;

    function trackArea(event) {
      var field = panel.alphalikesField;
      if (!field) return;
      var rect = parts.area.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var x = (event.clientX - rect.left) / rect.width;
      var y = (event.clientY - rect.top) / rect.height;
      field.hsv.s = Math.min(1, Math.max(0, x));
      field.hsv.v = Math.min(1, Math.max(0, 1 - y));
      syncMarkers(panel, field);
    }

    function trackHue(event) {
      var field = panel.alphalikesField;
      if (!field) return;
      var rect = parts.hue.getBoundingClientRect();
      if (!rect.width) return;
      var x = (event.clientX - rect.left) / rect.width;
      field.hsv.h = Math.min(359.9, Math.max(0, x * 360));
      syncMarkers(panel, field);
    }

    function drag(zone, handler) {
      zone.addEventListener("mousedown", function (event) {
        if (event) event.preventDefault();
        handler(event);
        var move = function (moveEvent) {
          handler(moveEvent);
        };
        var up = function () {
          doc.removeEventListener("mousemove", move);
          doc.removeEventListener("mouseup", up);
        };
        doc.addEventListener("mousemove", move);
        doc.addEventListener("mouseup", up);
      });
    }

    drag(parts.area, trackArea);
    drag(parts.hue, trackHue);

    // A click anywhere else closes the panel, like any other popup.
    doc.addEventListener("mousedown", function (event) {
      if (panel.style.display === "none") return;
      if (panel.contains(event.target)) return;
      var target = event.target;
      if (
        target &&
        target.classList &&
        target.classList.contains("alphalikes-color-preview")
      ) {
        return;
      }
      openPanel(doc);
    });
  }

  function wireColorPickers(doc) {
    var inputs = doc.querySelectorAll(".alphalikes-color-input");
    var fields = [];
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      if (!input.parentNode) continue;
      if (input.parentNode.querySelector(".alphalikes-color-preview")) continue;
      fields.push(makeField(doc, input));
    }
    if (fields.length) wirePanel(doc);
    return fields;
  }

  /** The style's own colours, for the previews and the restore buttons. */
  function styleColors(style) {
    try {
      var api = Zotero.AlphaLikes && Zotero.AlphaLikes.api;
      if (api && typeof api.styleColors === "function") {
        return api.styleColors(String(style || ""));
      }
    } catch (error) {
      Zotero.debug("[AlphaLikes] styleColors unavailable: " + error);
    }
    return { high: "", mid: "", low: "" };
  }

  /** Shows only the rows that belong to the selected colour mode. */
  function wireColorModes(doc) {
    var pairs = [
      {
        menu: "alphalikes-pref-color-mode",
        threshold: "alphalikes-color-threshold-rows",
        quantile: "alphalikes-color-quantile-rows",
        pref: "colorMode",
      },
      {
        menu: "alphalikes-pref-citation-color-mode",
        threshold: "alphalikes-citation-threshold-rows",
        // The citation column reuses the likes percentages, so it has no
        // percentile inputs of its own to show.
        quantile: null,
        pref: "citationColorMode",
      },
    ];

    pairs.forEach(function (pair) {
      var menu = doc.getElementById(pair.menu);
      if (!menu) return;
      var thresholdRows = doc.getElementById(pair.threshold);
      var quantileRows = pair.quantile
        ? doc.getElementById(pair.quantile)
        : null;

      function sync() {
        var value = String(menu.value || readPref(pair.pref) || "threshold");
        var quantile = value === "quantile";
        if (thresholdRows) {
          if (quantile) thresholdRows.setAttribute("hidden", "true");
          else thresholdRows.removeAttribute("hidden");
        }
        if (quantileRows) {
          if (quantile) quantileRows.removeAttribute("hidden");
          else quantileRows.setAttribute("hidden", "true");
        }
      }

      menu.addEventListener("command", function () {
        global.setTimeout ? global.setTimeout(sync, 0) : sync();
      });
      menu.addEventListener("change", function () {
        global.setTimeout ? global.setTimeout(sync, 0) : sync();
      });
      sync();
    });
  }

  /**
   * Puts a style's own colours back.
   *
   * The colours in the boxes are what the renderer uses once they have been
   * edited, so restoring means two things: clear the "customised" flag, and
   * put the style's colours back into the boxes so what is shown equals what
   * is drawn.
   */
  function wireColorReset(doc) {
    var buttons = [
      {
        id: "alphalikes-pref-like-colors-reset",
        flag: "likeColorsCustomised",
        style: "likeStyle",
        prefs: ["highLikesColor", "midLikesColor", "lowLikesColor"],
        bands: ["high", "mid", "low"],
      },
      {
        id: "alphalikes-pref-citation-colors-reset",
        flag: "citationColorsCustomised",
        style: "citationStyle",
        prefs: [
          "citationHighLikesColor",
          "citationMidLikesColor",
          "citationLowLikesColor",
        ],
        bands: ["high", "mid", "low"],
      },
    ];

    buttons.forEach(function (spec) {
      var button = doc.getElementById(spec.id);
      if (!button) return;

      button.addEventListener("command", function () {
        var colors = styleColors(readPref(spec.style));
        writePref(spec.flag, false);
        spec.prefs.forEach(function (prefName, index) {
          var input = doc.querySelector(
            '.alphalikes-color-input[preference="' + BRANCH + prefName + '"]',
          );
          var value = colors[spec.bands[index]] || "";
          writePref(prefName, value);
          if (!input) return;
          var field = input.alphalikesField;
          if (field) field.suppress = true;
          try {
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          } finally {
            if (field) field.suppress = false;
          }
          if (field && field.paintPreview) field.paintPreview();
        });
      });
    });
  }

  /**
   * Re-reads the previews when the display style changes.
   *
   * The styles carry different colours, so the boxes have to follow the menu
   * rather than the value they were first shown.
   */
  function wireStyleMenus(doc) {
    var menus = [
      { id: "alphalikes-pref-style", flag: "likeColorsCustomised" },
      {
        id: "alphalikes-pref-citation-style",
        flag: "citationColorsCustomised",
      },
    ];

    menus.forEach(function (spec) {
      var menu = doc.getElementById(spec.id);
      if (!menu) return;
      var sync = function () {
        if (readPref(spec.flag)) return;
        syncStyleColors(doc);
      };
      menu.addEventListener("command", function () {
        global.setTimeout ? global.setTimeout(sync, 0) : sync();
      });
    });
  }

  /** Keeps the boxes showing the colours that are actually in use. */
  function syncStyleColors(doc) {
    var pairs = [
      {
        flag: "likeColorsCustomised",
        style: "likeStyle",
        prefs: ["highLikesColor", "midLikesColor", "lowLikesColor"],
      },
      {
        flag: "citationColorsCustomised",
        style: "citationStyle",
        prefs: [
          "citationHighLikesColor",
          "citationMidLikesColor",
          "citationLowLikesColor",
        ],
      },
    ];

    var bands = ["high", "mid", "low"];
    pairs.forEach(function (pair) {
      if (readPref(pair.flag)) return;
      var colors = styleColors(readPref(pair.style));
      pair.prefs.forEach(function (prefName, index) {
        var input = doc.querySelector(
          '.alphalikes-color-input[preference="' + BRANCH + prefName + '"]',
        );
        if (!input) return;
        var value = colors[bands[index]] || "";
        if (normalized(input.value) === normalized(value)) return;

        var field = input.alphalikesField;
        if (field) field.suppress = true;
        try {
          // The preference is written too: while the "customised" flag is off
          // the box shows the style's colour, and having the stored value agree
          // with it means a later edit only changes what the user touched.
          writePref(prefName, value);
          input.value = value;
          if (field && field.paintPreview) field.paintPreview();
        } finally {
          if (field) field.suppress = false;
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // Read diagnostic
  // -------------------------------------------------------------------------

  /**
   * Runs one real attempt at both reads and copies the report.
   *
   * The point of the button is that a failure cannot be described from memory
   * and cannot be debugged from here: the report carries the machine's own
   * facts - the URLs, the headers, the statuses, the exception, the proxy the
   * request went through - so the user only has to paste it.
   */
  function wireDiagnose(doc) {
    var button = doc.getElementById("alphalikes-diagnose");
    if (!button) return 0;

    var status = {
      running: doc.getElementById("alphalikes-diagnose-running"),
      copied: doc.getElementById("alphalikes-diagnose-copied"),
      failed: doc.getElementById("alphalikes-diagnose-failed"),
    };

    function showStatus(name) {
      Object.keys(status).forEach(function (key) {
        var element = status[key];
        if (!element) return;
        if (key === name) element.removeAttribute("hidden");
        else element.setAttribute("hidden", "true");
      });
    }

    showStatus("");

    button.addEventListener("command", function () {
      var api = apiOf();
      if (!api || typeof api.diagnose !== "function") {
        Zotero.logError(
          new Error("[AlphaLikes] the diagnostic is not available"),
        );
        return;
      }

      button.disabled = true;
      showStatus("running");

      Promise.resolve()
        .then(function () {
          return api.diagnose();
        })
        .then(function (report) {
          var text = String(report || "");
          // The debug log is the fallback: a user who cannot find the copied
          // text still has the whole report in 帮助 → 调试输出日志.
          Zotero.debug("[AlphaLikes] 读取诊断\n" + text);
          try {
            Zotero.Utilities.Internal.copyTextToClipboard(text);
            showStatus("copied");
          } catch (copyError) {
            Zotero.logError(copyError);
            showStatus("failed");
          }
        })
        .catch(function (error) {
          Zotero.logError(
            new Error("[AlphaLikes] diagnostic failed: " + error),
          );
          showStatus("failed");
        })
        .then(function () {
          button.disabled = false;
        });
    });

    return 1;
  }

  /** The plugin instance, as the scaffold's bootstrap exposes it. */
  function apiOf() {
    try {
      var instance = Zotero.AlphaLikes;
      if (instance && instance.api) return instance.api;
    } catch (error) {
      Zotero.debug("[AlphaLikes] api unavailable: " + error);
    }
    return null;
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
      var fields = wireColorPickers(doc);
      fields.forEach(function (field) {
        field.input.alphalikesField = field;
      });
      wireColorModes(doc);
      wireColorReset(doc);
      wireStyleMenus(doc);
      syncStyleColors(doc);
      wireSources(doc);
      wireAppearanceLink(doc);
      wireDiagnose(doc);
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
