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
      new Error("[AlphaPulse] could not insert " + FTL_FILE + ": " + error),
    );
  }

  var XHTML_NS = "http://www.w3.org/1999/xhtml";

  /**
   * Fills a Fluent message's placeholders by hand.
   *
   * The build renames a message's variables along with its id (`{ min }`
   * becomes `{ alphalikes-min }`, without the `$`), which is no longer a
   * variable reference Fluent can fill in - it reads as a message reference
   * and comes out literally. The plugin's own `t()` splits on the placeholder
   * and joins the value in, and the pane does the same.
   */
  function fill(text, args) {
    var filled = text.split("{ ").join("{").split(" }").join("}");
    for (var key in args) {
      if (!Object.prototype.hasOwnProperty.call(args, key)) continue;
      filled = filled.split("{" + key + "}").join(args[key]);
    }
    return filled;
  }

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
      Zotero.debug("[AlphaPulse] could not write " + name + ": " + error);
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
      var api = Zotero.AlphaPulse && Zotero.AlphaPulse.api;
      if (api && typeof api.styleColors === "function") {
        return api.styleColors(String(style || ""));
      }
    } catch (error) {
      Zotero.debug("[AlphaPulse] styleColors unavailable: " + error);
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
      // Nothing written yet: the older single-source preference decides,
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

  /**
   * The one-line summary of the read rhythm.
   *
   * Seven numbers in seven boxes are hard to read as a rhythm; the line under
   * them says the same thing as a sentence and follows the fields as they are
   * edited, so a value that no longer matches the suggestion next to it can be
   * seen for what it is instead of having to be compared by eye.
   */
  function wireScholarPaceSummary(doc) {
    var target = doc.getElementById("alphalikes-scholar-pace-current");
    if (!target) return 0;

    // The build prefixes Fluent variables the same way it prefixes message
    // ids, so the arguments have to carry that prefix too.
    var REF = "__addonRef__";

    var fields = [
      ["scholarIntervalMinSeconds", "min"],
      ["scholarIntervalMaxSeconds", "max"],
      ["scholarDwellMinSeconds", "dwellMin"],
      ["scholarDwellMaxSeconds", "dwellMax"],
      ["scholarBatchMin", "batchMin"],
      ["scholarBatchMax", "batchMax"],
      ["scholarPauseMinMinutes", "pauseMin"],
      ["scholarPauseMaxMinutes", "pauseMax"],
    ];

    function values() {
      var out = {};
      for (var index = 0; index < fields.length; index += 1) {
        var name = fields[index][0];
        var raw = Number(readPref(name));
        out[REF + "-" + fields[index][1]] = String(
          Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0,
        );
      }
      return out;
    }

    // The sentence is assembled here rather than by handing Fluent a list of
    // arguments: the build renames the message's variables (`{ min }` becomes
    // `{ alphalikes-min }`, without the `$`), so they are no longer variable
    // references Fluent can fill in - they read as message references and come
    // out literally. The plugin's own `t()` works around this the same way, by
    // splitting on the placeholder and joining the value in.
    function plain(args) {
      var at = function (name) {
        return args[REF + "-" + name];
      };
      return (
        "当前：两次搜索间隔 " +
        at("min") +
        "–" +
        at("max") +
        " 秒，页面停留 " +
        at("dwellMin") +
        "–" +
        at("dwellMax") +
        " 秒，每 " +
        at("batchMin") +
        "–" +
        at("batchMax") +
        " 次后暂停 " +
        at("pauseMin") +
        "–" +
        at("pauseMax") +
        " 分钟"
      );
    }

    function render() {
      var args = values();
      var id = target.getAttribute("data-l10n-id");
      if (id && doc.l10n && doc.l10n.formatValue) {
        doc.l10n.formatValue(id).then(
          function (text) {
            target.textContent = text ? fill(text, args) : plain(args);
          },
          function () {
            target.textContent = plain(args);
          },
        );
        return;
      }
      target.textContent = plain(args);
    }

    var wired = 0;
    for (var index = 0; index < fields.length; index += 1) {
      var input = doc.querySelector(
        'input[preference$="' + fields[index][0] + '"]',
      );
      if (!input) continue;
      input.addEventListener("input", render);
      input.addEventListener("change", render);
      wired += 1;
    }

    render();
    return wired;
  }

  /**
   * What the reading is doing right now, paper by paper.
   *
   * The settings say how the reading is *arranged*; this says where each paper
   * it has been asked about has got to. It used to say one thing for the whole
   * session - a count of requests and the queue's own next slot - which hid
   * the only thing worth knowing: the reading is sequential, so one paper is
   * being read, another waits out Google's check, and a third has not been
   * asked yet. The lines name the paper and carry its own count and its own
   * next attempt, and the count is counted with the same rounding every other
   * surface uses, so nothing here disagrees with the popup.
   *
   * The session's own request count is deliberately not shown anywhere: it is
   * the queue's number, not any paper's, and a reader who is told "36 requests
   * this session" learns nothing about the row in front of them.
   */
  function wireScholarActivity(doc) {
    var target = doc.getElementById("alphalikes-scholar-activity");
    if (!target) return 0;

    var REF = "__addonRef__";
    // Long enough to hold a sentence about the paper being read and the one
    // waiting behind it, short enough to stay a status line.
    var PANE_ITEMS = 2;
    var TITLE_LIMIT = 36;
    var EMPTY = "（无标题）";
    var timer = null;

    function shortTitle(title) {
      var text = (title || "").trim();
      if (!text) return EMPTY;
      return text.length <= TITLE_LIMIT
        ? text
        : text.slice(0, TITLE_LIMIT - 1) + "…";
    }

    /** Minutes until this paper's next attempt, rounded like everywhere else. */
    function minutes(ms) {
      return String(Math.max(1, Math.round(ms / 60_000)));
    }

    /** One entry per paper, in the order the service reports them. */
    function entry(item, autoPaused) {
      var title = shortTitle(item.title);
      // A paper with another one ahead of it has no moment to name: the queue
      // decides when its turn comes, and borrowing the deadline of the paper
      // it is waiting behind is what made two different papers show the same
      // five minutes.
      if (!item.reading && item.ahead > 0) {
        return title + " 排队等待读取（前面还有 " + item.ahead + " 条）";
      }
      if (item.reading) {
        return title + " 正在读取（本条已请求 " + item.attempts + " 次）";
      }
      if (autoPaused) {
        return title + " 自动重试已暂停（本条已请求 " + item.attempts + " 次）";
      }
      // Nothing has been asked about this paper yet: it is at the head of the
      // queue, waiting for the reading rhythm, not for a retry.
      if (!item.attempts) {
        return item.nextInMs <= 1_000
          ? title + " 排在下一个，马上开始读取"
          : title +
              " 排在下一个，约 " +
              minutes(item.nextInMs) +
              " 分钟后开始读取";
      }
      return (
        title +
        " 约 " +
        minutes(item.nextInMs) +
        " 分钟后重试（本条已请求 " +
        item.attempts +
        " 次）"
      );
    }

    function listText(items, autoPaused) {
      var shown = items.slice(0, PANE_ITEMS).map(function (item) {
        return entry(item, autoPaused);
      });
      var rest = items.length - shown.length;
      if (rest > 0) shown.push("等 " + rest + " 条");
      return shown.join("、");
    }

    function plain(activity) {
      // No session total here on purpose: the reading is sequential, so a
      // count for the whole session says nothing about any one paper, and the
      // papers are what the line is about.
      if (!activity.items.length) return "没有正在读取或等待重试的条目。";
      return (
        "各条目的读取进度：" + listText(activity.items, activity.autoPaused)
      );
    }

    /**
     * Fills one message whose variables the build renamed.
     *
     * The build prefixes Fluent variables with the add-on reference, so the
     * argument names below carry `REF + "-"` the same way `fill` expects; a
     * text that comes back without them (an older locale file) still reads.
     */
    function say(id, args) {
      if (doc.l10n && doc.l10n.formatValue) {
        return doc.l10n.formatValue(id).then(
          function (text) {
            return text ? fill(text, args) : null;
          },
          function () {
            return null;
          },
        );
      }
      return Promise.resolve(null);
    }

    function render() {
      var activity = null;
      try {
        activity = Zotero.__addonInstance__.api.scholarActivity();
      } catch (error) {
        Zotero.debug(
          "[AlphaPulse] could not read the Scholar activity: " + error,
        );
        return;
      }

      var items = activity.items || [];
      if (!items.length) {
        say("pref-scholar-activity-empty", {}).then(function (text) {
          target.textContent = text || plain(activity);
        });
        return;
      }

      var args = {};
      args[REF + "-list"] = listText(items, activity.autoPaused);
      // Each paper is described by the service's own numbers; the message is
      // only the frame around them.
      say("pref-scholar-activity-list", args).then(function (text) {
        target.textContent = text || plain(activity);
      });
    }

    render();
    try {
      timer = (global.window || global).setInterval(render, 2_000);
    } catch {
      timer = null;
    }
    // A pane that is closed must not keep a timer alive in the window.
    try {
      (global.window || global).addEventListener("unload", function () {
        if (timer !== null) (global.window || global).clearInterval(timer);
        timer = null;
      });
    } catch {
      // Older windows may not offer it; the timer is harmless there.
    }
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
      wireScholarPaceSummary(doc);
      wireScholarActivity(doc);
    } catch (error) {
      Zotero.logError(
        new Error("[AlphaPulse] settings pane setup failed: " + error),
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
