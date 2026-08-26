// src/webview/terminal/paneEvidenceReporter.test.ts — the reporter's own
// bounds. The wiring is proved by the integration suite; what is proved here is
// that the advertised 1024-character cap bounds the WORK and not only the
// payload, which the first cut got wrong (.reviews/round-1.md W2).

import { describe, expect, it, vi } from "vitest";
import { MAX_REPORTED_TITLE_CHARS } from "../../shared/paneEvidence";
import type { PaneEvidenceMessage } from "../../types/messages";
import { createPaneEvidenceReporter } from "./paneEvidenceReporter";
import { boundedTitleSignature, titleSignature } from "./titleSignature";

function collect() {
  const sent: PaneEvidenceMessage[] = [];
  return { sent, post: (msg: PaneEvidenceMessage) => void sent.push(msg) };
}

describe("an oversized title", () => {
  it("reports the capped prefix of the FULL signature, not the signature of a raw prefix", () => {
    const { sent, post } = collect();
    const reporter = createPaneEvidenceReporter(post);
    // A spinner run longer than the cap, then real text. The full signature is
    // `X` — decorative glyphs are not part of it — so that is what the capped
    // value must begin with. Slicing the RAW string first would report "",
    // silently redefining the field. See .reviews/round-2.md B3.
    reporter.reportTitle("pane-1", `${"⠙".repeat(MAX_REPORTED_TITLE_CHARS + 1)}X`);

    expect(sent[0].title).toBe("X");
  });

  it("reports decoration as a fact about the whole title", () => {
    const { sent, post } = collect();
    const reporter = createPaneEvidenceReporter(post);
    // The spinner sits past the cap. `decorated` is specified as whether the
    // RAW title carried a frame, so a bounded scan must not turn that into
    // a claim about a prefix.
    reporter.reportTitle("pane-1", `${"a".repeat(MAX_REPORTED_TITLE_CHARS + 10)}⠙`);

    expect(sent[0].decorated).toBe(true);
  });

  it("caps the reported value at the transport limit", () => {
    const { sent, post } = collect();
    const reporter = createPaneEvidenceReporter(post);

    reporter.reportTitle("pane-1", "a".repeat(4_000_000));

    expect(sent).toHaveLength(1);
    expect(sent[0].title).toHaveLength(MAX_REPORTED_TITLE_CHARS);
  });

  it("does not allocate the whole payload to produce a capped value", () => {
    const { sent, post } = collect();
    const reporter = createPaneEvidenceReporter(post);
    // 8 MB. The original `titleSignature(raw).slice(...)` built two full-size
    // intermediates per title event; the bounded normalizer stops emitting at
    // the cap. Loose enough not to be flaky, tight enough to fail the
    // multi-pass form. See .reviews/round-1.md W2.
    const raw = "a".repeat(8_000_000);

    const started = performance.now();
    for (let i = 0; i < 20; i++) {
      reporter.reportTitle(`pane-${i}`, raw);
    }
    const elapsed = performance.now() - started;

    expect(sent).toHaveLength(20);
    expect(elapsed).toBeLessThan(200);
  });

  it("still deduplicates on the reported value", () => {
    const { sent, post } = collect();
    const reporter = createPaneEvidenceReporter(post);
    const raw = "a".repeat(MAX_REPORTED_TITLE_CHARS + 5000);

    reporter.reportTitle("pane-1", raw);
    reporter.reportTitle("pane-1", raw);

    expect(sent).toHaveLength(1);
  });
});

describe("a title within the cap", () => {
  it("reports the signature and the decoration it carried", () => {
    const { sent, post } = collect();
    const reporter = createPaneEvidenceReporter(post);

    reporter.reportTitle("pane-1", "⠙ Fix tests");
    reporter.reportTitle("pane-1", "⠋ Fix tests");
    reporter.reportTitle("pane-1", "Fix tests");

    expect(sent).toEqual([
      { type: "paneEvidence", paneId: "pane-1", title: "Fix tests", decorated: true },
      { type: "paneEvidence", paneId: "pane-1", title: "Fix tests", decorated: false },
    ]);
  });
});

describe("forget", () => {
  it("drops only the named pane's dedup state", () => {
    const { sent, post } = collect();
    const reporter = createPaneEvidenceReporter(post);
    reporter.reportTitle("pane-1", "one");
    reporter.reportTitle("pane-2", "two");

    reporter.forget("pane-1");
    reporter.reportTitle("pane-1", "one");
    reporter.reportTitle("pane-2", "two");

    expect(sent.filter((m) => m.paneId === "pane-1")).toHaveLength(2);
    expect(sent.filter((m) => m.paneId === "pane-2")).toHaveLength(1);
  });
});

describe("waiting", () => {
  it("travels alone, on the flip only", () => {
    const { sent, post } = collect();
    const reporter = createPaneEvidenceReporter(post);

    reporter.reportWaiting("pane-1", true);
    reporter.reportWaiting("pane-1", true);
    reporter.reportWaiting("pane-1", false);

    expect(sent).toEqual([
      { type: "paneEvidence", paneId: "pane-1", waiting: true },
      { type: "paneEvidence", paneId: "pane-1", waiting: false },
    ]);
  });
});

describe("a cleared title", () => {
  it("is reported, so the host stops holding a title the pane dropped", () => {
    const { sent, post } = collect();
    const reporter = createPaneEvidenceReporter(post);
    reporter.reportTitle("pane-1", "⠙ Fix tests");
    sent.length = 0;

    reporter.reportTitle("pane-1", "");

    expect(sent).toEqual([{ type: "paneEvidence", paneId: "pane-1", title: "", decorated: false }]);
  });

  it("is reported once, not on every repeat", () => {
    const { sent, post } = collect();
    const reporter = createPaneEvidenceReporter(post);
    reporter.reportTitle("pane-1", "Fix tests");
    sent.length = 0;

    reporter.reportTitle("pane-1", "");
    reporter.reportTitle("pane-1", "");

    expect(sent).toHaveLength(1);
  });

  it("is distinguishable from a pane that never reported a title", () => {
    const { sent, post } = collect();
    const reporter = createPaneEvidenceReporter(post);

    // Nothing has been observed for pane-2, so nothing is claimed about it.
    reporter.reportTitle("pane-1", "");

    expect(sent).toHaveLength(1);
    expect(sent.some((m) => m.paneId === "pane-2")).toBe(false);
  });
});

describe("the post throwing", () => {
  it("is not swallowed by the reporter", () => {
    const reporter = createPaneEvidenceReporter(
      vi.fn(() => {
        throw new Error("webview gone");
      }),
    );

    expect(() => reporter.reportTitle("pane-1", "x")).toThrow("webview gone");
  });
});

describe("boundedTitleSignature", () => {
  it("agrees with the unbounded signature it caps", () => {
    const cases = [
      "",
      "plain",
      "⠋ Fix tests",
      "  leading and   inner   runs  ",
      "◐◑◒◓",
      "\ttabs\tand\nnewlines\t",
      "⠙ Fix tests ⠙ again",
      "trailing spinner ⠙",
    ];

    for (const raw of cases) {
      expect(boundedTitleSignature(raw, MAX_REPORTED_TITLE_CHARS)).toBe(
        titleSignature(raw).slice(0, MAX_REPORTED_TITLE_CHARS),
      );
    }
  });

  it("agrees with it at the cap too", () => {
    const raw = `${"word ".repeat(600)}tail`;

    for (const max of [0, 1, 2, 5, 1023, 1024, 1025]) {
      expect(boundedTitleSignature(raw, max)).toBe(titleSignature(raw).slice(0, max));
    }
  });
});
