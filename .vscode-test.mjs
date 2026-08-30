import { defineConfig } from "@vscode/test-cli";

// The extension-host lane. Everything else in this repository tests against
// `src/test/__mocks__/vscode.ts`, which by construction answers whatever the mock
// says — this lane exists for the questions only a real editor can settle.
//
// `version` is pinned to the floor `engines.vscode` declares rather than `stable`.
// An answer from a newer editor than the floor does not license a decision, because
// the floor is what users can be running.
export default defineConfig({
  files: "out/test/host/**/*.test.js",
  version: "1.105.0",
  workspaceFolder: ".",
});
