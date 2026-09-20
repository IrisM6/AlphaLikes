/**
 * Manual arXiv match picker.
 *
 * Runs as a standalone chrome script (it is not part of the TypeScript bundle)
 * and talks to the plugin exclusively through `window.arguments[0]`, which is a
 * `PickerRequest` built by src/modules/menu.ts.
 *
 * Loaded from the END of arxiv-picker.xhtml so every element already exists.
 */
(function () {
  "use strict";

  var request = window.arguments && window.arguments[0];
  if (!request) {
    // Opened without arguments: close instead of showing a broken dialog.
    window.close();
    return;
  }

  var strings = request.strings || {};
  var candidates = request.candidates || [];
  var selectedID = null;

  function byId(id) {
    return document.getElementById(id);
  }

  var elements = {
    itemTitle: byId("item-title"),
    itemSummary: byId("item-summary"),
    heading: byId("heading"),
    subheading: byId("subheading"),
    group: byId("candidate-group"),
    empty: byId("empty-message"),
    manualLabel: byId("manual-label"),
    manualInput: byId("manual-input"),
    manualError: byId("manual-error"),
    status: byId("status"),
    searchAgain: byId("search-again"),
    clear: byId("clear"),
    cancel: byId("cancel"),
    apply: byId("apply"),
  };

  function text(id, fallback) {
    var value = strings[id];
    return typeof value === "string" && value ? value : fallback;
  }

  function setText(node, value) {
    if (node) node.textContent = value == null ? "" : String(value);
  }

  /**
   * Sets a XUL control's caption.
   *
   * Zotero 8 changed button captions to be read from the `label` property;
   * writing the attribute appends instead of replacing there. Setting the
   * property covers Zotero 7 as well, since it maps onto the attribute.
   */
  function setLabel(node, value) {
    if (!node) return;
    try {
      node.label = value;
    } catch {
      node.setAttribute("label", value);
    }
  }

  function show(node, visible) {
    if (!node) return;
    if (visible) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "true");
  }

  function confidenceLabel(confidence) {
    if (confidence === "high") return text("confidenceHigh", "High confidence");
    if (confidence === "medium") {
      return text("confidenceMedium", "Needs your confirmation");
    }
    return text("confidenceLow", "Low confidence");
  }

  function setStatus(message) {
    setText(elements.status, message || "");
  }

  function clearChildren(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  var XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

  function xul(name) {
    return document.createElementNS(XUL_NS, name);
  }

  // -------------------------------------------------------------------------
  // Candidate list
  // -------------------------------------------------------------------------

  function buildRow(candidate, index) {
    var row = xul("hbox");
    row.setAttribute(
      "style",
      "padding: 6px; gap: 8px; border-radius: 4px; align-items: flex-start;",
    );

    var radio = xul("radio");
    radio.setAttribute("id", "candidate-radio-" + index);

    var details = xul("vbox");
    details.setAttribute("flex", "1");

    var title = xul("description");
    title.setAttribute("style", "font-weight: 600;");
    title.textContent = candidate.title || candidate.arxivID;

    var meta = xul("description");
    meta.setAttribute("style", "opacity: 0.78;");
    meta.textContent =
      candidate.arxivID +
      " · " +
      candidate.sourceLabel +
      " · " +
      confidenceLabel(candidate.confidence) +
      " (" +
      Math.round((candidate.score || 0) * 100) +
      "%)";

    var evidence = xul("description");
    evidence.setAttribute("style", "opacity: 0.62;");
    evidence.textContent = candidate.detail || candidate.url || "";

    details.appendChild(title);
    details.appendChild(meta);
    details.appendChild(evidence);
    row.appendChild(radio);
    row.appendChild(details);

    row.addEventListener("click", function () {
      selectRadio(radio);
      selectedID = candidate.arxivID;
      if (elements.manualInput) elements.manualInput.value = "";
      hideManualError();
      updateApplyState();
    });

    return { row: row, radio: radio, candidate: candidate };
  }

  function selectRadio(target) {
    if (!elements.group) return;
    var radios = elements.group.querySelectorAll("radio");
    for (var i = 0; i < radios.length; i++) {
      radios[i].selected = radios[i] === target;
    }
  }

  function render() {
    clearChildren(elements.group);

    if (!candidates.length) {
      show(elements.empty, true);
      setText(
        elements.empty,
        text("none", "No candidate reached the confidence threshold."),
      );
      updateApplyState();
      return;
    }

    show(elements.empty, false);
    var preselected = null;

    candidates.forEach(function (candidate, index) {
      var built = buildRow(candidate, index);
      if (elements.group) elements.group.appendChild(built.row);
      if (!preselected && candidate.arxivID === request.currentArxivID) {
        preselected = built;
      }
    });

    if (!preselected) selectedID = null;

    if (preselected) {
      selectRadio(preselected.radio);
      selectedID = preselected.candidate.arxivID;
    }
    updateApplyState();
  }

  // -------------------------------------------------------------------------
  // Manual entry
  // -------------------------------------------------------------------------

  function manualValue() {
    return elements.manualInput ? String(elements.manualInput.value || "") : "";
  }

  function hideManualError() {
    show(elements.manualError, false);
    setText(elements.manualError, "");
  }

  function manualArxivID() {
    var raw = manualValue().trim();
    if (!raw) return "";
    return request.parseArxivID ? request.parseArxivID(raw) || "" : raw;
  }

  function updateApplyState() {
    var manual = manualValue().trim();
    if (elements.apply) elements.apply.disabled = !manual && !selectedID;
  }

  if (elements.manualInput) {
    elements.manualInput.addEventListener("input", function () {
      hideManualError();
      updateApplyState();
    });

    elements.manualInput.addEventListener("keypress", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        applyAndClose();
      }
    });
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  function applyAndClose() {
    var manual = manualValue().trim();

    if (manual) {
      var resolved = manualArxivID();
      if (!resolved) {
        show(elements.manualError, true);
        setText(
          elements.manualError,
          text("invalid", "That does not look like an arXiv ID."),
        );
        return;
      }
      request.result = { action: "apply", arxivID: resolved };
      window.close();
      return;
    }

    if (!selectedID) return;
    request.result = { action: "apply", arxivID: selectedID };
    window.close();
  }

  if (elements.apply) elements.apply.addEventListener("command", applyAndClose);

  if (elements.cancel) {
    elements.cancel.addEventListener("command", function () {
      request.result = { action: "cancel" };
      window.close();
    });
  }

  if (elements.clear) {
    elements.clear.addEventListener("command", function () {
      request.result = { action: "clear" };
      window.close();
    });
  }

  if (elements.searchAgain) {
    elements.searchAgain.addEventListener("command", function () {
      if (typeof request.searchAgain !== "function") return;

      elements.searchAgain.disabled = true;
      if (elements.apply) elements.apply.disabled = true;
      setStatus(text("searching", "Searching…"));

      request
        .searchAgain(request.paper)
        .then(function (results) {
          candidates = results || [];
          render();
          setStatus("");
        })
        .catch(function (error) {
          var message = String((error && error.message) || error);
          setStatus(text("searchFailed", "The search failed.") + " " + message);
        })
        .then(function () {
          elements.searchAgain.disabled = false;
          updateApplyState();
        });
    });
  }

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  function init() {
    document.title = text("title", "Find arXiv ID");

    setText(elements.itemTitle, request.itemTitle || "");
    setText(elements.itemSummary, request.itemSummary || "");
    setText(elements.heading, text("heading", "Candidate matches"));
    setText(elements.subheading, text("subheading", ""));

    if (elements.manualLabel) {
      elements.manualLabel.value = text(
        "manualLabel",
        "Enter an arXiv ID or URL",
      );
    }
    if (elements.manualInput) {
      elements.manualInput.setAttribute(
        "placeholder",
        text("manualPlaceholder", ""),
      );
    }

    setLabel(elements.searchAgain, text("search", "Search again"));
    setLabel(elements.clear, text("clear", "Remove AlphaLikes data"));
    setLabel(elements.cancel, text("cancel", "Cancel"));
    setLabel(elements.apply, text("apply", "Apply"));

    // Nothing cached and nothing found: say so rather than showing an empty box.
    if (!candidates.length) {
      setText(
        elements.subheading,
        text("noCandidates", "Nothing was found for this item yet."),
      );
    }

    if (!request.currentArxivID && elements.clear) {
      elements.clear.disabled = true;
    }

    render();
    hideManualError();
    setStatus("");

    try {
      if (elements.manualInput) elements.manualInput.focus();
    } catch {
      // Focus is a nicety only.
    }
  }

  init();
})();
