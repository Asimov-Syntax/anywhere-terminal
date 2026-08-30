import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
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
