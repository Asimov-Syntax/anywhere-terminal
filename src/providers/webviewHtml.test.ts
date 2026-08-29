import { describe, expect, it } from "vitest";
import * as vscode from "vscode";
import { getTerminalHtml } from "./webviewHtml";

function mockWebview(): vscode.Webview {
  return {
    cspSource: "https://mock.csp.source",
    // Matches the real signature shape used elsewhere in provider tests: returns
    // the fsPath string (NOT a Uri), so the cache-buster must compose in string space.
    asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
  } as unknown as vscode.Webview;
}

describe("getTerminalHtml webview.js cache-buster (D11)", () => {
  it("appends a ?v= version query to the webview.js script src", () => {
    const html = getTerminalHtml(mockWebview(), vscode.Uri.file("/ext"), "sidebar");
    const match = html.match(/src="([^"]*webview\.js[^"]*)"/);
    expect(match).not.toBeNull();
    // A reload must never serve a stale bundle: the script URL carries a version query.
    expect(match?.[1]).toMatch(/webview\.js\?v=.+/);
    // Exactly one query separator (no double "?").
    expect((match?.[1].match(/\?/g) ?? []).length).toBe(1);
  });

  it("allows blob: image sources in the CSP so pasted-image previews render (preview-pasted-images D6)", () => {
    const html = getTerminalHtml(mockWebview(), vscode.Uri.file("/ext"), "sidebar");
    const csp = html.match(/Content-Security-Policy"\s*content="([^"]*)"/)?.[1] ?? "";
    // Object-URL (blob:) previews are blocked under default-src 'none' without
    // an explicit img-src; the directive must permit blob:.
    expect(csp).toMatch(/img-src[^;]*blob:/);
  });

  it("resets [hidden] so a hidden control cannot be resurrected by an author display rule", () => {
    const html = getTerminalHtml(mockWebview(), vscode.Uri.file("/ext"), "sidebar");
    // The UA's `[hidden] { display: none }` is user-agent origin, so any author rule
    // setting `display` outranks it — which is how a hidden toolbar control stayed on
    // screen. Asserted on the HTML because jsdom reports `display: none` for a hidden
    // element with or without this rule, so computed style cannot fail for the defect.
    expect(html).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
    // After the panel stylesheets, or it loses the cascade to a later equal-weight rule.
    const reset = html.search(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
    expect(reset).toBeGreaterThan(html.lastIndexOf(".vault-folder-toggle"));
  });

  it("keeps the vault panel CSS INLINE (the externalization was reverted — D15)", () => {
    const html = getTerminalHtml(mockWebview(), vscode.Uri.file("/ext"), "sidebar");
    // The vault CSS is inlined into the host <style> (regenerated per render, so it
    // can never be served stale); it is NOT an external cache-busted <link>.
    expect(html).not.toMatch(/<link[^>]*vaultPanel\.css/);
  });
});

describe("the scope badge speaks the waiting vocabulary, and does not animate", () => {
  /** The declaration block for one selector, as written in the stylesheet. */
  function ruleFor(css: string, selector: string): string {
    const at = css.indexOf(`${selector} {`);
    expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  }

  it("colours the badge from the same variable a waiting tab uses, not an error one", () => {
    // One shape for one meaning: a user learns the waiting colour once. An error
    // treatment would claim something failed, and nothing has.
    const css = getTerminalHtml(mockWebview(), vscode.Uri.file("/ext"), "sidebar");
    const badge = ruleFor(css, ".tab-scope-badge");
    const waitingTab = ruleFor(css, ".tab-status-waiting");
    expect(waitingTab).toContain("--vscode-editorWarning-foreground");
    expect(badge).toContain("--vscode-editorWarning-foreground");
    expect(badge).not.toContain("errorForeground");
    expect(badge).not.toContain("testing-iconFailed");
  });

  it("gives the badge no animation, though the running status has one", () => {
    // A standing count is not work in progress. Asserted against the running
    // rule, so the test fails if the pulse is ever copied onto the badge.
    const css = getTerminalHtml(mockWebview(), vscode.Uri.file("/ext"), "sidebar");
    expect(ruleFor(css, ".tab-status-running")).toContain("animation:");
    expect(ruleFor(css, ".tab-scope-badge")).not.toContain("animation");
  });
});
