import * as os from "node:os";
import * as path from "node:path";
import { readClaudeSessions } from "../../../src/vault/readers/claudeReader";
import { readLatestTailTitles } from "../../../src/vault/readers/claudeRecords";

const dir = path.join(os.homedir(), ".claude", "projects", "-Users-huybuidac-Projects-ai-oss-anywhere-terminal");
const res = await readClaudeSessions({});
const mine = res.entries.filter((e) => (e.sessionPath ?? "").startsWith(dir));
mine.sort((a, b) => b.modified - a.modified);
for (const e of mine.slice(0, 12)) {
  const t = await readLatestTailTitles(e.sessionPath as string);
  const expected = t.customTitle ?? t.aiTitle ?? t.lastPrompt;
  const flag = expected === undefined ? "noTrailer" : expected === e.title ? "ok  " : "MISS";
  console.log(`${flag} listTitle=${JSON.stringify(e.title)} claude=${JSON.stringify(expected)}`);
}
