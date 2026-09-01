// esbuild.js — Dual-target build for AnyWhere Terminal
//
// Extension bundle: dist/extension.js (CJS, Node.js)
// WebView bundle:   media/webview.js  (IIFE, browser)

const esbuild = require("esbuild");
const { copyFileSync, mkdirSync, existsSync } = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * esbuild problem matcher plugin for VS Code task integration.
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`\u2718 [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      }
      console.log("[watch] build finished");
    });
  },
};

/**
 * Plugin to copy xterm.css to media/ after a successful build.
 * @type {import('esbuild').Plugin}
 */
const copyXtermCssPlugin = {
  name: "copy-xterm-css",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length === 0) {
        const src = require.resolve("@xterm/xterm/css/xterm.css");
        const dest = path.join(__dirname, "media", "xterm.css");

        // Ensure media/ directory exists
        const mediaDir = path.join(__dirname, "media");
        if (!existsSync(mediaDir)) {
          mkdirSync(mediaDir, { recursive: true });
        }

        try {
          copyFileSync(src, dest);
          console.log("[copy] xterm.css -> media/xterm.css");
        } catch (err) {
          console.warn("[copy] Failed to copy xterm.css:", err.message);
        }
      }
    });
  },
};

// --- Extension Host Bundle ---
const extensionConfig = {
  entryPoints: ["./src/extension.ts"],
  bundle: true,
  outfile: "./dist/extension.js",
  format: "cjs",
  platform: "node",
  target: "node18",
  external: [
    "vscode", // Provided by VS Code runtime
    "node-pty", // Loaded dynamically from VS Code internals
  ],
  alias: {
    // `jsonc-parser`'s `main` is a UMD bundle: its CJS branch calls
    // `factory(require, exports)` and the factory then does
    // `require("./impl/format")`. esbuild cannot follow a require reached
    // through a parameter, so it leaves the call alone — and at runtime that
    // relative path resolves against `dist/`, not against the package, so
    // activation fails with "Cannot find module './impl/format'". The ESM
    // build has the same code behind static imports esbuild can inline.
    "jsonc-parser": require.resolve("jsonc-parser/lib/esm/main.js"),
  },
  loader: {
    // webviewHtml.ts inlines vendored VS Code CSS strings into a <style> block.
    // See: asimov/changes/port-vscode-async-data-tree/design.md D7
    ".css": "text",
  },
  sourcemap: !production,
  sourcesContent: false,
  minify: production,
  logLevel: "silent",
  plugins: [esbuildProblemMatcherPlugin],
};

// --- WebView Bundle ---
const webviewConfig = {
  entryPoints: ["./src/webview/main.ts"],
  bundle: true,
  outfile: "./media/webview.js",
  format: "iife",
  platform: "browser",
  target: "es2020",
  alias: {
    // Vendored VS Code list widget — see asimov/changes/port-vscode-async-data-tree/design.md D2
    vs: path.resolve(__dirname, "src/vendor/vscode"),
  },
  loader: {
    // Vendored Seti file-icon font — imported as a data URL so the entire
    // font ships inside webview.js, no extra HTTP roundtrip in the webview
    // sandbox. (~37 KB raw → ~50 KB base64.)
    ".woff": "dataurl",
  },
  // No externals — everything is bundled:
  //   @xterm/xterm, @xterm/addon-fit, @xterm/addon-web-links, @xterm/addon-webgl
  sourcemap: !production,
  sourcesContent: false,
  // xterm.js v6 breaks under esbuild minifySyntax and minifyIdentifiers
  // (ReferenceError in requestMode / DECRQM parser). This is consistent with
  // how other projects handle it:
  //   - VS Code: xterm.js loaded as external AMD module, never minified by esbuild
  //   - vscode-sidebar-terminal: webpack { minimize: false }
  // We only apply whitespace minification which is safe (removes spaces/newlines).
  minifySyntax: false,
  minifyWhitespace: production,
  minifyIdentifiers: false,
  logLevel: "silent",
  plugins: [esbuildProblemMatcherPlugin, copyXtermCssPlugin],
};

// --- Build Entry Point ---
async function main() {
  if (watch) {
    // Watch mode: both targets rebuild incrementally in parallel
    const [extCtx, wvCtx] = await Promise.all([esbuild.context(extensionConfig), esbuild.context(webviewConfig)]);
    await Promise.all([extCtx.watch(), wvCtx.watch()]);
    console.log("Watching for changes...");
  } else {
    // Single build: build both targets in parallel
    await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
    console.log("Build complete.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
