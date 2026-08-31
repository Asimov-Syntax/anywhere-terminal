import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Worker threads, not forked child processes: same 251 files pass either way, and threads
    // are measurably faster here. Worker count is not the reason — vitest resolves `numCpus - 1`
    // for both pools; the saving is process spawn plus per-file module-graph setup.
    //
    // Nothing in this suite loads a native addon, which is what usually rules threads out:
    // `node-pty` is resolved out of `vscode.env.appRoot` at runtime (src/pty/PtyManager.ts),
    // and under the `vscode` mock that path never resolves, so tests exercise the PtyLoadError
    // branch instead. `node:sqlite` is a builtin and is worker-thread safe.
    //
    // Two constraints this depends on:
    //   - `isolate` must stay ON. PtyManager memoizes `cachedNodePty` at module scope, so
    //     without a fresh module registry per file whichever file runs first fixes the cache
    //     for every later one — that is the PTY_LOAD_FAILED / SessionManager state leak that
    //     fails 22 tests under --no-isolate.
    //   - libuv's threadpool is per-PROCESS, so all workers now share the 4 default slots
    //     where each fork had its own. This suite is fs-bound (32 files build real fixture
    //     trees), so `test:unit` sets UV_THREADPOOL_SIZE=16. It must be set on the parent
    //     process — `test.env` is applied too late, after the pool is initialized.
    pool: "threads",
    // Discover colocated test files under src/
    include: ["src/**/*.test.ts"],
    // Exclude build artifacts and the extension-host lane. The host lane runs under
    // Mocha inside a real VS Code (see .vscode-test.mjs); its files use Mocha globals
    // and the real `vscode` module, so Vitest must not collect them. The rule names
    // the directory rather than a filename so adding a host test cannot break it.
    exclude: ["node_modules", "dist", "out", "src/test/host/**"],
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
