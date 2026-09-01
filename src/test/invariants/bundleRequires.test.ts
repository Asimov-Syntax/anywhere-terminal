// The gate that would have caught the activation failure no suite could:
// a dependency's UMD factory left `require("./impl/format")` in the bundle,
// where it resolved against `dist/` and found nothing.
//
// Driven over fixture text rather than a rebuilt artifact, so the defect can be
// reintroduced deliberately — WT-011.12's acceptance requires that — without a
// test ever editing the build config it audits.
import { describe, expect, it } from "vitest";
import {
  classify,
  declaredExternals,
  requiredSpecifiers,
  unresolvableRequires,
} from "../../../scripts/bundleRequires.mjs";

const OUT = "./dist/extension.js";

/** Both configs, because esbuild.js really does carry two. */
const ESBUILD = `
const extensionConfig = {
  entryPoints: ["./src/extension.ts"],
  outfile: "./dist/extension.js",
  external: [
    "vscode", // Provided by VS Code runtime
    "node-pty",
    // "removed-package"
  ],
};
const webviewConfig = {
  outfile: "./media/webview.js",
  external: ["never-allowlist-me"],
};
`;

const DIST = "/repo/dist";
const nowhere = (_p: string) => false;
const notADirectory = (_p: string) => false;

/** Files that exist, as absolute paths; everything else is absent. */
const files =
  (...present: string[]) =>
  (p: string) =>
    present.includes(p);

const verdicts = (
  bundle: string,
  exists: (p: string) => boolean = nowhere,
  isDirectory: (p: string) => boolean = notADirectory,
) => unresolvableRequires(bundle, { esbuildSource: ESBUILD, outfile: OUT, resolvesFrom: DIST, exists, isDirectory });

const one = (bundle: string, exists?: (p: string) => boolean, isDirectory?: (p: string) => boolean) =>
  verdicts(bundle, exists, isDirectory)[0];

describe("[round-1 F003] the externals come from the bundle's own build", () => {
  it("reads them off the config whose outfile is the bundle", () => {
    expect([...declaredExternals(ESBUILD, OUT)]).toEqual(["vscode", "node-pty"]);
  });

  it("does not take the other build's externals", () => {
    // The webview config sits in the same file; allowlisting its externals for
    // the extension bundle is the drift D2 exists to prevent.
    expect(declaredExternals(ESBUILD, OUT).has("never-allowlist-me")).toBe(false);
    expect(verdicts(`require("never-allowlist-me")`)).toHaveLength(1);
  });

  it("does not count a commented-out entry as declared", () => {
    // A comment is not a member of an array. The text scan thought it was, so
    // an external REMOVED from the build stayed allowlisted in the gate.
    expect(declaredExternals(ESBUILD, OUT).has("removed-package")).toBe(false);
  });

  it("refuses to judge a build it cannot find, or cannot tell apart", () => {
    expect(() => declaredExternals("const x = 1;", OUT)).toThrow(/exactly one/);
    expect(() => declaredExternals(`${ESBUILD}${ESBUILD}`, OUT)).toThrow(/found 2/);
  });

  it("refuses a computed externals list rather than reading past it", () => {
    const computed = `const c = { outfile: "./dist/extension.js", external: [NAMES] };`;
    expect(() => declaredExternals(computed, OUT)).toThrow(/computed/);
  });
});

describe("[round-1 F002] a require is a call, not a piece of text", () => {
  it("catches the relative require a UMD factory left behind", () => {
    expect(requiredSpecifiers(`function(require, exports){ var f = require("./impl/format"); }`)).toEqual([
      "./impl/format",
    ]);
  });

  it("does not report one written inside a comment", () => {
    expect(requiredSpecifiers(`// require("./missing")\n/* require("./missing") */`)).toEqual([]);
  });

  it("does not report one quoted inside a diagnostic string", () => {
    expect(requiredSpecifiers(`var msg = "Cannot find module: require(\\"./missing\\")";`)).toEqual([]);
  });

  it("does not report a method that merely shares the name", () => {
    // `loader.require(...)` is a property access, not this `require`.
    expect(requiredSpecifiers(`loader.require("./missing"); mod.require("./missing");`)).toEqual([]);
  });

  it("still catches a call the old spelling would have missed", () => {
    expect(requiredSpecifiers(`require\n(\n  /* here */ "./spaced"\n)`)).toEqual(["./spaced"]);
  });

  it("ignores a computed require, which is the stated limit", () => {
    expect(requiredSpecifiers("require(name); require(a + b);")).toEqual([]);
  });
});

describe("[round-1 F001] resolution is what the PACKAGED extension could load", () => {
  it("fails the defect's own require when nothing is beside the bundle", () => {
    expect(one(`require("./impl/format")`)).toMatchObject({ specifier: "./impl/format", ok: false });
    expect(one(`require("./impl/format")`).why).toContain("/repo/dist/impl/format");
  });

  it("passes a chunk esbuild really wrote", () => {
    expect(verdicts(`require("./chunk")`, files("/repo/dist/chunk.js"))).toEqual([]);
  });

  it("does not accept a file that exists only in the checkout", () => {
    // `scripts/` is not in the VSIX, so its presence on the build machine says
    // nothing about what the installed extension can load.
    const inCheckout = files("/repo/scripts/check-bundle-size.mjs");
    expect(one(`require("../scripts/check-bundle-size.mjs")`, inCheckout)).toMatchObject({ ok: false });
    expect(one(`require("../scripts/check-bundle-size.mjs")`, inCheckout).why).toContain("outside the packaged");
  });

  it("does not accept a bare directory as a module", () => {
    // Node throws MODULE_NOT_FOUND for a directory with no index and no
    // package.json; existence alone is not resolution.
    const emptyDir = (p: string) => p === "/repo/dist/empty";
    expect(one(`require("./empty")`, emptyDir, emptyDir)).toMatchObject({ ok: false });
    expect(one(`require("./empty")`, emptyDir, emptyDir).why).toContain("no index");
  });

  it("accepts a directory that has an index or its own package.json", () => {
    const isDir = (p: string) => p === "/repo/dist/pkg";
    const withIndex = (p: string) => isDir(p) || p === "/repo/dist/pkg/index.js";
    expect(verdicts(`require("./pkg")`, withIndex, isDir)).toEqual([]);
    const withManifest = (p: string) => isDir(p) || p === "/repo/dist/pkg/package.json";
    expect(verdicts(`require("./pkg")`, withManifest, isDir)).toEqual([]);
  });

  it("accepts the other extensions Node really resolves", () => {
    expect(verdicts(`require("./n")`, files("/repo/dist/n.node"))).toEqual([]);
    expect(verdicts(`require("./j")`, files("/repo/dist/j.json"))).toEqual([]);
  });

  it("refuses an absolute path even when it exists on this machine", () => {
    expect(one(`require("/repo/dist/real.js")`, files("/repo/dist/real.js"))).toMatchObject({ ok: false });
    expect(one(`require("/repo/dist/real.js")`, files("/repo/dist/real.js")).why).toContain("build machine");
  });

  it("refuses traversal out of the artifact directory", () => {
    expect(one(`require("../../etc/passwd")`, () => true)).toMatchObject({ ok: false });
  });
});

describe("[WT-011.12] what the gate must not report", () => {
  it("passes node builtins, prefixed or not", () => {
    expect(verdicts(`require("node:fs");require("path");require("process");require("buffer")`)).toEqual([]);
  });

  it("passes the editor host and the other declared external", () => {
    expect(verdicts(`require("vscode");require("node-pty")`)).toEqual([]);
  });

  it("fails a bare specifier that was never bundled", () => {
    expect(verdicts(`require("lodash")`)).toEqual([expect.objectContaining({ specifier: "lodash", ok: false })]);
  });

  it("does not treat a builtin as an external, nor the reverse", () => {
    const externals = declaredExternals(ESBUILD, OUT);
    expect(classify("node:fs", { externals, resolvesFrom: DIST }).why).toBe("node builtin");
    expect(classify("vscode", { externals, resolvesFrom: DIST }).why).toBe("declared external");
  });
});

// [round-2 F002] The gate reads a --production bundle, and minification renames
// the UMD factory's `require` parameter. The literal below is esbuild's own
// output for a jsonc-parser-shaped dependency under
// `--bundle --platform=node --minify`: `require` survives only as an ARGUMENT,
// and the call that carries the defect is on the renamed binding `e`.
const MINIFIED_UMD = `var i=(e,o)=>()=>(o||e((o={exports:{}}).exports,o),o.exports);var f=i((r,t)=>{(function(e){if(typeof t=="object"&&typeof t.exports=="object"){var o=e(require,r);o!==void 0&&(t.exports=o)}})(function(e,o){"use strict";var n=e("./impl/format");o.go=function(){return n}})});var c=f();console.log(c.go());`;

describe("[round-2 F002] a require whose callee minification renamed", () => {
  it("reports the specifier the renamed binding requires", () => {
    expect(requiredSpecifiers(MINIFIED_UMD)).toContain("./impl/format");
  });

  it("still reports it as unresolvable against an artifact that lacks it", () => {
    const found = unresolvableRequires(MINIFIED_UMD, {
      esbuildSource: ESBUILD,
      outfile: OUT,
      resolvesFrom: "/nowhere/dist",
      exists: () => false,
      isDirectory: () => false,
    });
    expect(found.map((v) => v.specifier)).toContain("./impl/format");
  });

  it("does not taint a method that merely shares the name", () => {
    expect(requiredSpecifiers(`var loader={require(x){}};loader.require("./nope");`)).toEqual([]);
  });

  it("leaves an untainted local call alone", () => {
    expect(requiredSpecifiers(`function t(m){return m}t("./not-a-require");`)).toEqual([]);
  });
});
