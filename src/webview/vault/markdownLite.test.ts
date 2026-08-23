// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderMarkdownLite } from "./markdownLite";

/** Render into a host div so we can query the produced structure. */
function render(text: string): HTMLElement {
  const host = document.createElement("div");
  host.appendChild(renderMarkdownLite(text));
  return host;
}

describe("renderMarkdownLite", () => {
  it("preserves line breaks within a paragraph (pre-wrap, the core ask)", () => {
    const host = render("line one\nline two\nline three");
    const p = host.querySelector("p.md-p");
    expect(p).not.toBeNull();
    // Newlines survive as text so `white-space: pre-wrap` can lay them out.
    expect(p?.textContent).toBe("line one\nline two\nline three");
  });

  it("splits paragraphs on blank lines", () => {
    const host = render("para one\n\npara two");
    expect(host.querySelectorAll("p.md-p")).toHaveLength(2);
  });

  it("renders a fenced code block verbatim (indentation preserved)", () => {
    const host = render("before\n```ts\nconst x = 1;\n    indented();\n```\nafter");
    const code = host.querySelector("pre.md-pre code");
    expect(code?.textContent).toBe("const x = 1;\n    indented();");
    // Surrounding prose still becomes paragraphs.
    expect(host.querySelectorAll("p.md-p")).toHaveLength(2);
  });

  it("renders a pipe table as a real table with header + body cells", () => {
    const host = render("| Name | Hours |\n| --- | --- |\n| Alpha | 12 |\n| Beta | 7 |");
    const table = host.querySelector("table.md-table");
    expect(table).not.toBeNull();
    expect(Array.from(host.querySelectorAll("thead th")).map((th) => th.textContent)).toEqual(["Name", "Hours"]);
    const rows = host.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(Array.from(rows[0].querySelectorAll("td")).map((td) => td.textContent)).toEqual(["Alpha", "12"]);
  });

  it("pads short table rows to the header width (stays rectangular)", () => {
    const host = render("| a | b | c |\n| - | - | - |\n| 1 |");
    const cells = Array.from(host.querySelectorAll("tbody tr td")).map((td) => td.textContent);
    expect(cells).toEqual(["1", "", ""]);
  });

  it("renders ATX headings with a level class", () => {
    const host = render("# Big\n## Smaller");
    expect(host.querySelector(".md-h.md-h1")?.textContent).toBe("Big");
    expect(host.querySelector(".md-h.md-h2")?.textContent).toBe("Smaller");
  });

  it("groups consecutive bullets into a <ul> and numbers into an <ol>", () => {
    const ul = render("- one\n- two\n- three");
    expect(ul.querySelectorAll("ul.md-list li")).toHaveLength(3);
    const ol = render("1. first\n2. second");
    expect(ol.querySelector("ol.md-list")).not.toBeNull();
    expect(ol.querySelectorAll("ol.md-list li")).toHaveLength(2);
  });

  it("keeps indented bullets nested inside one ordered sequence", () => {
    const host = render("1. first\n   - detail a\n\n2. second\n   - detail b\n\n3. third\n   - detail c");
    const lists = host.querySelectorAll(":scope > ol.md-list");
    expect(lists).toHaveLength(1);
    const items = lists[0].querySelectorAll(":scope > li");
    expect(items).toHaveLength(3);
    expect(Array.from(items).map((item) => item.querySelector(":scope > ul.md-list > li")?.textContent)).toEqual([
      "detail a",
      "detail b",
      "detail c",
    ]);
  });

  it("renders inline `code` and **bold** as elements, not literal markers", () => {
    const host = render("use `npm test` and **stop**");
    expect(host.querySelector("code.md-code-inline")?.textContent).toBe("npm test");
    expect(host.querySelector("strong")?.textContent).toBe("stop");
    expect(host.textContent).not.toContain("**");
    expect(host.textContent).not.toContain("`");
  });

  it("NEVER interprets HTML — angle-bracket content is inert text (XSS-safe)", () => {
    const host = render("<img src=x onerror=alert(1)>\n<script>alert(2)</script>");
    // No element was created from the payload; it is plain text.
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("script")).toBeNull();
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("gracefully renders an unterminated code fence (truncated transcript)", () => {
    const host = render("```\npartial code\nno closing fence");
    expect(host.querySelector("pre.md-pre code")?.textContent).toBe("partial code\nno closing fence");
  });

  it("does NOT merge a marker-type switch into one list (R5): `- ` then `1. ` → ul + ol", () => {
    const host = render("- bullet a\n- bullet b\n1. step one\n2. step two");
    const lists = host.querySelectorAll(".md-list");
    expect(lists).toHaveLength(2);
    expect(lists[0].tagName.toLowerCase()).toBe("ul");
    expect(lists[0].querySelectorAll("li")).toHaveLength(2);
    expect(lists[1].tagName.toLowerCase()).toBe("ol");
    expect(Array.from(lists[1].querySelectorAll("li")).map((li) => li.textContent)).toEqual(["step one", "step two"]);
  });
});
