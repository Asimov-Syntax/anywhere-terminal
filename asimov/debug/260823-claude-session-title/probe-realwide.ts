import { readClaudeSessions } from "../../../src/vault/readers/claudeReader";
import { readLatestTailTitles } from "../../../src/vault/readers/claudeRecords";

const { entries } = await readClaudeSessions({});
entries.sort((a, b) => b.modified - a.modified);
let ok = 0;
let miss = 0;
let none = 0;
for (const e of entries.slice(0, 150)) {
  const t = await readLatestTailTitles(e.sessionPath as string);
  const expected = t.customTitle ?? t.aiTitle ?? t.lastPrompt;
  if (expected === undefined) {
    none++;
  } else if (e.title === expected.replace(/\s+/g, " ").trim().slice(0, 120)) {
    ok++;
  } else {
    miss++;
    console.log(`MISS ${JSON.stringify(e.title)} != ${JSON.stringify(expected)}`);
  }
}
console.log({ ok, miss, noTrailer: none });
