// @vitest-environment jsdom

import { expect, it } from "vitest";
import { renderMarkdownLite } from "../../../src/webview/vault/markdownLite";

it("preserves ordered numbering and nested bullets in the reported session preview", () => {
  const host = document.createElement("div");
  host.appendChild(
    renderMarkdownLite(`1. **Blueprint decision registry + validator**
   - owner, rejected alternative, revisit trigger, enforcement class;
   - kiểm tra reference, orphan, placeholder, diagram/registry drift.
   - Đây là phần tiếp theo có giá trị thực tế nhất.

2. **Standalone ADR lifecycle**
   - status, supersession, search/recall, one-decision-per-file.
   - Chỉ nên phục hồi nếu decision cần sống độc lập qua nhiều blueprint section/release.

3. **Telemetry/fitness validation**
   - pattern heuristics, shape thresholds, gate effectiveness, refactor outcomes.
   - Research có đề cập nhưng chưa đủ evidence để biến thành enforcement.`),
  );

  const topLevelLists = Array.from(host.children).filter((element) => element.matches("ol.md-list"));
  const orderedItems = topLevelLists[0]?.querySelectorAll(":scope > li") ?? [];
  const numberingPreserved = topLevelLists.length === 1 && orderedItems.length === 3;
  const nestedBulletsPreserved =
    orderedItems.length === 3 && Array.from(orderedItems).every((item) => item.querySelector(":scope > ul.md-list"));

  console.log(`OBSERVES 1: ${numberingPreserved ? "GREEN" : "RED"}`);
  console.log(`OBSERVES 2: ${nestedBulletsPreserved ? "GREEN" : "RED"}`);
  expect([numberingPreserved, nestedBulletsPreserved]).toEqual([true, true]);
});
