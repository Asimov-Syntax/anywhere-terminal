import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Worker threads, not forked child processes. Same 251 files pass either way, but forks
    // cost ~29% more wall clock and spawn a process per file — every fresh exec pays for a
    // macOS Gatekeeper signature check, which is what turns a repeated full run into heat.
    // Isolation stays ON: --no-isolate leaks state and fails 22 tests (PTY_LOAD_FAILED,
    // SessionManager.*).
    pool: "threads",
    // Discover colocated test files under src/
    include: ["src/**/*.test.ts"],
    // Exclude integration tests and build artifacts
    exclude: ["node_modules", "dist", "out", "src/test/extension.test.ts"],
    // Resolve `vscode` module to our manual mock; `vs/*` to vendored VS Code list widget
    // (see asimov/changes/port-vscode-async-data-tree/design.md D2)
    alias: {
      vscode: path.resolve(__dirname, "src/test/__mocks__/vscode.ts"),
      vs: path.resolve(__dirname, "src/vendor/vscode"),
    },
    // Coverage configuration
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/test/**",
        "src/webview/**",
        "src/types/messages.ts",
        "src/**/*.test.ts",
        "src/extension.ts",
        "src/providers/**",
      ],
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
