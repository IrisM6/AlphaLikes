/**
 * The settings pane, driven the way a user drives it.
 *
 * Everything else about the pane is checked statically (scripts/check-addon.py
 * looks at the markup and the script), which cannot tell whether the colour
 * picker actually appears, whether clicking it writes a colour, or whether the
 * quantile and threshold rows swap over. Those are the parts of this round the
 * user sees first, so they are worth opening the real window for: this file
 * registers the same pane Zotero does, opens the settings window, and clicks.
 */

import { assert } from "chai";
import { getScholarPacing } from "../src/modules/prefs";
import { config } from "../package.json";

const ADDON_ID = config.addonID;
const PREFIX = "extensions.zotero.alphalikes.";

function pref(name: string): unknown {
  return Zotero.Prefs.get(PREFIX + name, true);
}

function setPref(name: string, value: unknown): void {
  Zotero.Prefs.set(PREFIX + name, value, true);
}

interface PaneWindow {
  document: Document;
  MouseEvent: typeof MouseEvent;
  close(): void;
}

/** Turns anything thrown into a string a failing run can show. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    // Gecko's stack is the frame list alone, so the message must come first:
    // reading the stack alone loses the one line that explains the failure.
    return `${error.message} || ${error.stack ?? ""}`;
  }
  try {
    return JSON.stringify(error, Object.getOwnPropertyNames(error));
  } catch {
    return String(error);
  }
}

/** Opens the settings window and waits until AlphaLikes' pane is in it. */
async function openPane(): Promise<{
  win: PaneWindow;
  doc: Document;
  pane: HTMLElement;
}> {
  const internal = Zotero.Utilities.Internal as unknown as {
    openPreferences(id: string): void;
  };

  // Plugin panes get an id of `plugin-pane-<random>-<pluginID>`, so it cannot
  // be hard-coded: it is whatever the registration returned.
  const panes =
    (
      Zotero as unknown as {
        PreferencePanes: { pluginPanes: { id: string; pluginID: string }[] };
      }
    ).PreferencePanes?.pluginPanes ?? [];
  const paneId = panes.find((pane) => pane.pluginID === ADDON_ID)?.id ?? "";

  let failure = "";
  try {
    internal.openPreferences(paneId);
  } catch (error) {
    const detail =
      error && typeof error === "object"
        ? ((error as { message?: string; name?: string }).message ??
          (error as { name?: string }).name ??
          JSON.stringify(Object.keys(error)))
        : String(error);
    failure = `openPreferences threw: ${detail}`;
  }

  const deadline = Date.now() + 20_000;
  let settings: (PaneWindow & { Zotero_Preferences?: unknown }) | null = null;

  while (Date.now() < deadline && !settings) {
    // Zotero opens the window with the type `zotero:pref` (see
    // utilities_internal.js), not the URL's own name.
    settings = Services.wm.getMostRecentWindow(
      "zotero:pref",
    ) as unknown as PaneWindow | null;
    if (settings && !settings.Zotero_Preferences) settings = null;
    if (!settings) await Zotero.Promise.delay(100);
  }
  if (!settings) {
    assert.fail("the settings window never finished loading");
  }

  // Navigating is awaited on purpose: a pane whose markup does not parse, or
  // whose script throws, rejects here instead of leaving a blank page.
  try {
    await (
      settings.Zotero_Preferences as {
        navigateToPane(id: string): Promise<void>;
      }
    ).navigateToPane(paneId);
  } catch (error) {
    failure = `navigateToPane rejected: ${describeError(error)}`;
  }

  while (Date.now() < deadline) {
    const pane = settings.document.getElementById("zotero-prefpane-alphalikes");
    if (pane) {
      // The pane script polls for its own markup; give it the same 50ms turns
      // it uses before deciding something is missing.
      await Zotero.Promise.delay(300);
      return { win: settings, doc: settings.document, pane };
    }
    await Zotero.Promise.delay(200);
  }

  const open: string[] = [];
  try {
    const windows = Services.wm.getEnumerator(null);
    while (windows.hasMoreElements()) {
      try {
        const candidate = windows.getNext() as unknown as {
          location?: { href: string };
        };
        open.push(String(candidate.location?.href ?? "?"));
      } catch {
        open.push("(closed)");
      }
    }
  } catch {
    open.push("(the enumerator itself failed)");
  }
  throw new Error(
    [
      failure || "the AlphaLikes pane did not appear in the settings window",
      `pane id = ${paneId || "(the pane is not registered)"}`,
      `panes = ${panes.map((p) => `${p.id}/${p.pluginID}`).join(", ")}`,
      `windows = ${open.join(", ")}`,
    ].join(" | "),
  );
}

function click(
  win: PaneWindow,
  doc: Document,
  el: Element,
  x = 0,
  y = 0,
): void {
  const box = el.getBoundingClientRect();
  const event = {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: box.left + x,
    clientY: box.top + y,
  };
  el.dispatchEvent(new win.MouseEvent("mousedown", event));
  doc.dispatchEvent(new win.MouseEvent("mouseup", event));
  // A real press produces a click as well, and it is the click the pane
  // listens for when it opens the picker.
  el.dispatchEvent(new win.MouseEvent("click", event));
}

/** Waits for `check` to hold, up to a few seconds. */
async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && !check()) {
    await Zotero.Promise.delay(50);
  }
}

function colorInputs(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll(".alphalikes-color-input"));
}

describe("AlphaLikes settings pane", function () {
  this.timeout(60_000);

  let win: PaneWindow;
  let doc: Document;
  const saved = new Map<string, unknown>();

  before(async function () {
    try {
      for (const name of [
        "likeStyle",
        "likeColorsCustomised",
        "highLikesColor",
        "midLikesColor",
        "lowLikesColor",
        "colorMode",
        "quantileLowPercent",
        "quantileHighPercent",
        "citationStyle",
        "citationColorsCustomised",
        "citationColorMode",
        "scholarIntervalMinSeconds",
      ]) {
        saved.set(name, pref(name));
      }

      ({ win, doc } = await openPane());
    } catch (error) {
      // assert.fail is the one channel whose text reaches the test log from
      // inside Zotero, so the failure is reported through it.
      assert.fail(`pane setup failed: ${describeError(error)}`);
    }
  });

  after(async function () {
    for (const [name, value] of saved) setPref(name, value);
    try {
      win?.close();
    } catch {
      // The window may already be gone when the run tears down.
    }
  });

  it("shows a colour preview next to every colour box", function () {
    const inputs = colorInputs(doc);
    assert.lengthOf(inputs, 6, "three like colours and three citation ones");

    for (const input of inputs) {
      const preview = input.parentNode?.querySelector(
        ".alphalikes-color-preview",
      );
      assert.isOk(
        preview,
        `no preview was built for ${input.getAttribute("preference")}`,
      );
      assert.isNotEmpty(
        preview?.getAttribute("style") ?? "",
        "the preview carries no colour",
      );
    }
  });

  it("opens one picker with a colour area and a hue bar", function () {
    const preview = colorInputs(doc)[0].parentNode?.querySelector(
      ".alphalikes-color-preview",
    ) as Element;
    click(win, doc, preview);

    const panel = doc.getElementById("alphalikes-color-panel");
    assert.isOk(panel, "clicking the preview built no panel");
    assert.equal(
      panel?.style.display,
      "grid",
      "the panel is in the document but not shown",
    );

    const area = panel?.querySelector(".alphalikes-color-area");
    const hue = panel?.querySelector(".alphalikes-color-hue");
    assert.isOk(area, "the panel has no colour area");
    assert.isOk(hue, "the panel has no hue bar");
    assert.lengthOf(
      panel?.querySelectorAll(".alphalikes-color-marker") ?? [],
      2,
      "one marker on the area, one on the hue bar",
    );

    // A panel that is in the document but has no box would be invisible to the
    // user, which no static check can tell apart from a working one.
    const box = panel?.getBoundingClientRect();
    assert.isAbove(box?.width ?? 0, 50, "the panel has no width");
    assert.isAbove(box?.height ?? 0, 50, "the panel has no height");
  });

  it("writes the picked colour to the box and to the setting", function () {
    const input = colorInputs(doc)[0];
    const name = String(input.getAttribute("preference")).replace(PREFIX, "");
    const panel = doc.getElementById("alphalikes-color-panel") as HTMLElement;
    const area = panel.querySelector(".alphalikes-color-area") as Element;

    // Top-right corner: fully saturated, fully bright — the pure hue.
    const box = area.getBoundingClientRect();
    click(win, doc, area, box.width - 2, 2);

    const value = (input as HTMLInputElement).value;
    assert.match(
      value,
      /^#[0-9a-f]{6}$/i,
      `the box holds ${value} instead of a hex colour`,
    );
    assert.equal(
      pref(name),
      value,
      "the setting did not follow the picked colour",
    );
    assert.isTrue(
      Boolean(pref("likeColorsCustomised")),
      "editing a colour has to mark the colours as edited",
    );

    const marker = panel.querySelector(
      ".alphalikes-color-area .alphalikes-color-marker",
    ) as HTMLElement;
    assert.notEqual(marker.style.left, "0%", "the marker did not move");
  });

  it("keeps only the rows of the selected banding rule on screen", function () {
    const menu = doc.getElementById("alphalikes-pref-color-mode") as
      (Element & { value: string }) | null;
    const thresholdRows = doc.getElementById("alphalikes-color-threshold-rows");
    const quantileRows = doc.getElementById("alphalikes-color-quantile-rows");
    assert.isOk(menu, "the pane has no banding-rule menu");
    assert.isOk(thresholdRows, "the pane has no threshold rows");
    assert.isOk(quantileRows, "the pane has no quantile rows");

    setPref("colorMode", "quantile");
    menu.value = "quantile";
    menu.dispatchEvent(new Event("command", { bubbles: true }));
    // The pane defers the swap by one turn so the binding can settle first.
    return Zotero.Promise.delay(50).then(() => {
      assert.isTrue(
        quantileRows.hasAttribute("hidden") === false,
        "quantile mode should show the percentile inputs",
      );
      assert.isTrue(
        thresholdRows.hasAttribute("hidden"),
        "quantile mode should hide the threshold inputs",
      );

      setPref("colorMode", "threshold");
      menu.value = "threshold";
      menu.dispatchEvent(new Event("command", { bubbles: true }));
      return Zotero.Promise.delay(50).then(() => {
        assert.isFalse(
          thresholdRows.hasAttribute("hidden"),
          "threshold mode should show the threshold inputs",
        );
        assert.isTrue(
          quantileRows.hasAttribute("hidden"),
          "threshold mode should hide the percentile inputs",
        );
      });
    });
  });

  it("puts a style's own colours back in one click", function () {
    setPref("likeStyle", "morandi");
    setPref("likeColorsCustomised", true);
    setPref("highLikesColor", "#ff00ff");
    setPref("midLikesColor", "#ff00ff");
    setPref("lowLikesColor", "#ff00ff");

    const button = doc.getElementById("alphalikes-pref-like-colors-reset");
    assert.isOk(button, "the pane has no restore button");
    button?.dispatchEvent(new Event("command", { bubbles: true }));

    assert.isFalse(
      Boolean(pref("likeColorsCustomised")),
      "restoring has to clear the edited flag",
    );
    assert.equal(
      pref("highLikesColor"),
      "#9FB3BF",
      "the high band did not go back to the style's own colour",
    );
    assert.equal(pref("midLikesColor"), "#DCD3C9");
    assert.equal(pref("lowLikesColor"), "#F1F1EF");

    // …and the boxes follow, so what is shown is what is drawn.
    const inputs = colorInputs(doc);
    assert.equal(
      (inputs[0] as HTMLInputElement).value,
      "#9FB3BF",
      "the colour box still shows the colour that was there before",
    );
  });

  it("names the paper each reading is waiting on, and its own wait", async function () {
    // The rhythm settings say how the reading is arranged; this line says what
    // each paper is doing right now. Reported: one line for the whole session
    // ("asked 2 times, next in about now") while one paper was stuck behind
    // Google's check - so the line names the paper, carries that paper's own
    // count, and says what that paper is waiting for.
    const line = doc.getElementById("alphalikes-scholar-activity");
    assert.isOk(line, "the pane does not say what the reading is doing");

    // The pane asks `Zotero.AlphaPulse.api` for the reading. The tests run in
    // a second copy of the plugin, whose own service is a different instance,
    // so the reading is handed over the way the add-on hands it over and what
    // is checked here is the rendering. What the payload itself says is
    // asserted where it is made, in the reading tests.
    const instance = (
      Zotero as unknown as {
        AlphaPulse?: { api: { scholarActivity: () => unknown } };
      }
    ).AlphaPulse;
    assert.isOk(instance, "the pane's window carries the add-on instance");
    const api = instance.api;
    const original = api.scholarActivity;
    let activity: unknown = {
      requests: 0,
      nextInMs: 0,
      paused: false,
      burstLeft: 1,
      autoPaused: false,
      items: [],
    };
    api.scholarActivity = () => activity;

    try {
      // Two papers, as the service reports them: one whose turn it is, waiting
      // out Google's check, and one behind it that has a place in the list
      // rather than a time of its own.
      activity = {
        requests: 4,
        nextInMs: 0,
        paused: false,
        burstLeft: 1,
        autoPaused: false,
        items: [
          {
            itemID: 1,
            title: "AlphaPulse pane activity probe",
            attempts: 2,
            reading: false,
            ahead: 0,
            nextInMs: 5 * 60_000,
          },
          {
            itemID: 2,
            title: "AlphaPulse pane queued probe",
            attempts: 0,
            reading: false,
            ahead: 1,
            nextInMs: 0,
          },
        ],
      };

      await Zotero.Promise.delay(2_400);
      const waiting = (line?.textContent ?? "").replace(/\s+/g, " ");
      assert.include(
        waiting,
        "pane activity probe",
        "the line has to say which paper it is about",
      );
      assert.match(
        waiting,
        /(本条已请求|request\(s\) for this item)/,
        "and how many searches that paper has cost",
      );
      assert.match(waiting, /(5|约 5)/, "and when that paper is tried again");
      assert.include(
        waiting,
        "pane queued probe",
        "the paper behind it is named too",
      );
      assert.match(
        waiting,
        /(前面还有|ahead of it)/,
        "and is described by its place in the queue, not by a borrowed time",
      );
      // Reported: the line led with 「本会话已请求 N 次」, a count for the whole
      // run of Zotero. The reading is sequential, so that number describes no
      // paper in particular; the pane shows per-paper progress and nothing
      // else.
      assert.notMatch(
        waiting,
        /(本次会话已请求|本会话已请求|has asked Scholar\s*\d)/,
        "the session's own request count does not belong in the pane",
      );

      // A session with nothing in the list says so instead of describing a
      // wait that is not there.
      activity = { ...(activity as Record<string, unknown>), items: [] };
      await Zotero.Promise.delay(2_400);
      assert.include(
        (line?.textContent ?? "").replace(/\s+/g, " "),
        "没有正在读取或等待重试的条目",
        "an idle session says so",
      );
    } finally {
      api.scholarActivity = original;
    }
  });

  it("offers every reading-rhythm range, with the number it suggests", async function () {
    // The pacing is a set of ranges, and a range field without a suggested
    // value is a question the user has to answer from nothing. The pane has to
    // show the number next to the field - and it has to be in the unit the
    // label says, because a range stored in milliseconds under a label that
    // says seconds is wrong the first time someone types 16.
    const fields: Array<[string, string, string]> = [
      ["scholarIntervalMinSeconds", "pref-scholar-interval-min-hint", "16"],
      ["scholarIntervalMaxSeconds", "pref-scholar-interval-max-hint", "30"],
      ["scholarDwellMinSeconds", "pref-scholar-dwell-min-hint", "4"],
      ["scholarDwellMaxSeconds", "pref-scholar-dwell-max-hint", "8"],
      ["scholarBatchMin", "pref-scholar-batch-min-hint", "8"],
      ["scholarBatchMax", "pref-scholar-batch-max-hint", "15"],
      ["scholarPauseMinMinutes", "pref-scholar-pause-min-hint", "15"],
      ["scholarPauseMaxMinutes", "pref-scholar-pause-max-hint", "40"],
    ];

    for (const [preference, hintId, suggested] of fields) {
      // The build prefixes the preference name with its own branch, so the
      // field is found by what its name ends with.
      const input = doc.querySelector(`input[preference$="${preference}"]`);
      assert.isOk(input, `the pane offers no field for ${preference}`);
      if (!input) continue;

      const hint = input.parentNode?.querySelector(
        `[data-l10n-id$="${hintId}"]`,
      );
      assert.isOk(hint, `no suggested value next to ${preference}`);
      assert.include(
        (hint as Element | null)?.textContent ?? "",
        suggested,
        `the hint next to ${preference} has to name the value it suggests`,
      );
    }

    assert.isAtLeast(
      doc.querySelectorAll('input[preference*="alphalikes.scholar"]').length,
      7,
      "the rhythm is seven ranges the user can adjust",
    );
  });

  it("writes the pace the user typed, in the unit the label promises", async function () {
    const input = doc.querySelector(
      'input[preference$="scholarIntervalMinSeconds"]',
    ) as HTMLInputElement | null;
    assert.isOk(input, "the shortest gap is adjustable");

    (input as HTMLInputElement).value = "20";
    (input as HTMLInputElement).dispatchEvent(
      new Event("input", { bubbles: true }),
    );
    (input as HTMLInputElement).dispatchEvent(
      new Event("change", { bubbles: true }),
    );

    await waitFor(() => pref("scholarIntervalMinSeconds") === 20);
    assert.equal(pref("scholarIntervalMinSeconds"), 20);
    assert.equal(
      getScholarPacing().intervalMinMs,
      20_000,
      "20 in the pane is twenty seconds, not twenty milliseconds",
    );

    // Put the field back: the pane is one document for the whole file, and a
    // borrowed value would otherwise be read by whatever runs next.
    (input as HTMLInputElement).value = "16";
    (input as HTMLInputElement).dispatchEvent(
      new Event("input", { bubbles: true }),
    );
    (input as HTMLInputElement).dispatchEvent(
      new Event("change", { bubbles: true }),
    );
    await waitFor(() => pref("scholarIntervalMinSeconds") === 16);
  });

  it("explains a failed read instead of offering a diagnostic read", function () {
    // The user cannot act on a report, and running one request per source is
    // exactly the traffic that gets a Google read blocked. What the pane shows
    // instead is the rhythm the reads run at; the reason a read failed is in
    // the cell's own tooltip, next to the number it belongs to.
    assert.isNull(
      doc.querySelector('[id^="alphalikes-diagnose"]'),
      "the pane still carries a diagnostic control",
    );
    assert.isOk(
      doc.querySelector('[data-l10n-id$="pref-scholar-pacing"]'),
      "the pane has to explain the reading rhythm instead",
    );
  });

  it("reads the rhythm back as a sentence, and follows the fields", async function () {
    // Seven number boxes are hard to read as a rhythm. The line under them
    // says what the settings currently add up to, and follows an edit, so a
    // value that has drifted from the suggestion next to it is visible.
    const summary = doc.getElementById("alphalikes-scholar-pace-current");
    assert.isOk(summary, "the pane does not say what the rhythm currently is");

    // The pane asks the window's localization for the sentence and fills the
    // values in when the promise resolves, so a read has to wait a turn.
    await Zotero.Promise.delay(200);
    const text = (summary?.textContent ?? "").replace(/\s+/g, " ");

    // What the sentence has to name is the settings as they stand, not a
    // hard-coded set of numbers: the pane is shared by the whole file.
    for (const name of [
      "scholarIntervalMinSeconds",
      "scholarIntervalMaxSeconds",
      "scholarDwellMinSeconds",
      "scholarDwellMaxSeconds",
      "scholarBatchMin",
      "scholarBatchMax",
      "scholarPauseMinMinutes",
      "scholarPauseMaxMinutes",
    ]) {
      assert.include(
        text,
        String(pref(name)),
        `the summary does not name the current ${name}`,
      );
    }

    // The stay on a page became a range, so the sentence has to carry both of
    // its ends - either one alone would be a sentence about the wrong rhythm.
    assert.include(
      text,
      String(pref("scholarDwellMinSeconds")),
      "the summary leaves the shortest stay out",
    );

    // And it has to be a sentence: the build renames the message's variables,
    // so a name the pane forgets to fill in comes out as `{ alphalikes-... }`
    // in the middle of the line. That is not a number, whatever the numbers
    // around it happen to match.
    assert.notInclude(
      text,
      "{",
      "the summary still carries an unfilled placeholder",
    );

    const field = doc.querySelector(
      '[preference="extensions.zotero.alphalikes.scholarIntervalMaxSeconds"]',
    ) as HTMLInputElement | null;
    assert.isOk(field, "the interval maximum field is missing");

    const before = String(pref("scholarIntervalMaxSeconds"));
    const changed = Number(before) === 45 ? 46 : 45;
    (field as HTMLInputElement).value = String(changed);
    field?.dispatchEvent(new win.Event("input", { bubbles: true }));
    field?.dispatchEvent(new win.Event("change", { bubbles: true }));

    try {
      await Zotero.Promise.delay(200);
      const updated = (summary?.textContent ?? "").replace(/\s+/g, " ");
      assert.include(
        updated,
        String(changed),
        "an edited field has to show up in the summary",
      );
    } finally {
      (field as HTMLInputElement).value = before;
      field?.dispatchEvent(new win.Event("input", { bubbles: true }));
      field?.dispatchEvent(new win.Event("change", { bubbles: true }));
      await Zotero.Promise.delay(50);
    }
  });

  it("shows the style's colours when nothing has been edited", function () {
    setPref("likeColorsCustomised", false);
    setPref("likeStyle", "dot");

    const menu = doc.getElementById("alphalikes-pref-style") as
      (Element & { value: string }) | null;
    assert.isOk(menu, "the pane has no style menu");
    menu.value = "dot";
    menu.dispatchEvent(new Event("command", { bubbles: true }));

    return Zotero.Promise.delay(50).then(() => {
      const inputs = colorInputs(doc);
      assert.equal(
        (inputs[0] as HTMLInputElement).value,
        "#FF3B30",
        "the boxes should show the selected style's colours",
      );
    });
  });
});
