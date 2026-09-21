/**
 * Google Scholar record picker.
 *
 * Runs as a standalone chrome script (it is not part of the TypeScript bundle)
 * and talks to the plugin exclusively through `window.arguments[0]`, which is a
 * `ScholarPickerRequest` built by src/modules/menu.ts.
 *
 * Loaded from the END of scholar-picker.xhtml so every element already exists.
 *
 * Clicking a row is deliberately handled on the row, on every child of it and
 * with a capture listener: a plain bubble listener on the row is enough in
 * principle, but Zotero's XUL boxes do not always deliver a click from a child
 * control, and "the result cannot be selected" is the one failure this dialog
 * must not have.
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
  var results = request.results || [];
  var searchURL = request.searchURL || "";
  var selectedIndex = -1;

  function byId(id) {
    return document.getElementById(id);
  }

  var elements = {
    itemTitle: byId("item-title"),
    itemSummary: byId("item-summary"),
    pinned: byId("pinned"),
    heading: byId("heading"),
    subheading: byId("subheading"),
    status: byId("status"),
    group: byId("result-group"),
    empty: byId("empty-message"),
    searchAgain: byId("search-again"),
    openBrowser: byId("open-browser"),
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
   * writing the attribute appends instead of replacing there.
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

  function clearChildren(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  var XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

  function xul(name) {
    return document.createElementNS(XUL_NS, name);
  }

  function format(template, values) {
    var out = template;
    Object.keys(values).forEach(function (key) {
      out = out.replace("{" + key + "}", String(values[key]));
    });
    return out;
  }

  function countLabel(result) {
    if (result.count === null || result.count === undefined) {
      return text("countUnknown", "No citation count shown");
    }
    return format(text("count", "Cited by {count}"), { count: result.count });
  }

  // -------------------------------------------------------------------------
  // Result list
  // -------------------------------------------------------------------------

  function selectIndex(index) {
    selectedIndex = index;
    if (elements.group) {
      var radios = elements.group.querySelectorAll("radio");
      for (var i = 0; i < radios.length; i++) {
        radios[i].selected = i === index;
      }
    }
    updateApplyState();
  }

  function buildRow(result, index) {
    var row = xul("hbox");
    row.setAttribute(
      "style",
      "padding: 6px; gap: 8px; border-radius: 4px; align-items: flex-start; cursor: pointer;",
    );

    var radio = xul("radio");
    radio.setAttribute("id", "result-radio-" + index);

    var details = xul("vbox");
    details.setAttribute("flex", "1");

    var title = xul("description");
    title.setAttribute("style", "font-weight: 600;");
    title.textContent = result.title || text("noTitle", "(no title)");

    var meta = xul("description");
    meta.setAttribute("style", "opacity: 0.78;");
    meta.textContent = result.meta || result.url || "";

    var count = xul("description");
    count.setAttribute("style", "opacity: 0.9;");
    count.textContent = countLabel(result);

    details.appendChild(title);
    details.appendChild(meta);
    details.appendChild(count);
    row.appendChild(radio);
    row.appendChild(details);

    function onPick(event) {
      if (event) event.preventDefault();
      selectIndex(index);
    }

    // Capture listener on the row covers every descendant, whatever the child
    // control does with the event; the direct listener covers the row itself.
    row.addEventListener("click", onPick, true);
    row.addEventListener("click", onPick);
    row.addEventListener("dblclick", function (event) {
      onPick(event);
      applyAndClose();
    });
    [radio, details, title, meta, count].forEach(function (node) {
      node.addEventListener("click", onPick);
    });
    radio.addEventListener("command", function () {
      onPick(null);
    });

    return { row: row, radio: radio, result: result };
  }

  function render() {
    clearChildren(elements.group);
    selectedIndex = -1;

    if (!results.length) {
      show(elements.empty, true);
      setText(
        elements.empty,
        request.blocked
          ? text("blocked", "Google answered with a human check.")
          : text("empty", "This search returned no results."),
      );
      updateApplyState();
      return;
    }

    show(elements.empty, false);

    var preselected = -1;
    results.forEach(function (result, index) {
      var built = buildRow(result, index);
      if (elements.group) elements.group.appendChild(built.row);
      // A remembered record comes back pre-selected, so pressing the apply
      // button again after a re-search keeps the same paper.
      if (
        preselected === -1 &&
        request.pinnedTitle &&
        result.title === request.pinnedTitle
      ) {
        preselected = index;
      }
    });

    if (preselected !== -1) selectIndex(preselected);
    updateApplyState();
  }

  function updateApplyState() {
    if (elements.apply) elements.apply.disabled = selectedIndex < 0;
  }

  function setStatus(message) {
    setText(elements.status, message || "");
  }

  function showPinned() {
    if (!request.pinnedTitle) {
      show(elements.pinned, false);
      return;
    }
    show(elements.pinned, true);
    setText(
      elements.pinned,
      format(text("pinned", "Currently used: {title}"), {
        title: request.pinnedTitle,
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  function applyAndClose() {
    if (selectedIndex < 0) return;
    request.result = { action: "apply", result: results[selectedIndex] };
    window.close();
  }

  function openInBrowser() {
    if (typeof request.openInBrowser !== "function") return;
    request.openInBrowser(searchURL);
  }

  function searchAgain() {
    if (typeof request.searchAgain !== "function") return;

    elements.searchAgain.disabled = true;
    if (elements.apply) elements.apply.disabled = true;
    setStatus(text("searching", "Searching Google Scholar…"));

    request
      .searchAgain()
      .then(function (lookup) {
        results = (lookup && lookup.results) || [];
        request.blocked = Boolean(lookup && lookup.blocked);
        searchURL = (lookup && lookup.url) || searchURL;
        render();
        setStatus(
          request.blocked
            ? text("blocked", "Google answered with a human check.")
            : lookup && lookup.error
              ? format(text("error", "The search failed: {message}"), {
                  message: lookup.error,
                })
              : "",
        );
      })
      .catch(function (error) {
        setStatus(
          format(text("error", "The search failed: {message}"), {
            message: String((error && error.message) || error),
          }),
        );
      })
      .then(function () {
        elements.searchAgain.disabled = false;
        updateApplyState();
      });
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
    elements.searchAgain.addEventListener("command", searchAgain);
  }

  if (elements.openBrowser) {
    elements.openBrowser.addEventListener("command", openInBrowser);
  }

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  function init() {
    document.title = text("title", "Choose the Google Scholar record");
    setText(elements.itemTitle, request.itemTitle || "");
    setText(elements.itemSummary, request.itemSummary || "");
    setText(elements.heading, text("heading", "Results for the paper's title"));
    setText(elements.subheading, text("subheading", ""));

    setLabel(elements.searchAgain, text("search", "Search again"));
    setLabel(elements.openBrowser, text("open", "Open the search in the browser"));
    setLabel(elements.clear, text("clear", "Forget the chosen record"));
    setLabel(elements.cancel, text("cancel", "Cancel"));
    setLabel(elements.apply, text("apply", "Use this record's citation count"));

    if (elements.clear) {
      elements.clear.disabled = !request.pinnedTitle;
    }

    showPinned();
    render();

    var initial = "";
    if (request.blocked) initial = text("blocked", "Google answered with a human check.");
    else if (request.error) {
      initial = format(text("error", "The search failed: {message}"), {
        message: request.error,
      });
    }
    setStatus(initial);
  }

  init();
})();
