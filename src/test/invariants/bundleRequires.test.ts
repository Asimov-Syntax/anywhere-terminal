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
  readFile: (p: string) => string = () => "{}",
) =>
  unresolvableRequires(bundle, {
    esbuildSource: ESBUILD,
    outfile: OUT,
    resolvesFrom: DIST,
    exists,
    isDirectory,
    readFile,
  });

const one = (
  bundle: string,
  exists?: (p: string) => boolean,
  isDirectory?: (p: string) => boolean,
  readFile?: (p: string) => string,
) => verdicts(bundle, exists, isDirectory, readFile)[0];

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
    // INVOKED. The uninvoked spelling this once used is source-only — it never
    // reaches a bundle — and keeping it forced a spelling seed that falsely
    // rejected a legitimate local binding named `require` (round-3 F007).
    expect(
      requiredSpecifiers(`(function(require, exports){ var f = require("./impl/format"); })(require, {});`),
    ).toEqual(["./impl/format"]);
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
    const withManifest = (p: string) => isDir(p) || p === "/repo/dist/pkg/package.json" || p === "/repo/dist/pkg/m.js";
    expect(verdicts(`require("./pkg")`, withManifest, isDir, () => `{"main":"./m.js"}`)).toEqual([]);
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

// [round-2 F001] A manifest is a POINTER, not a resolution. `main` can name a
// file the VSIX does not carry, escape the artifact directory, or be missing
// entirely — Node throws MODULE_NOT_FOUND for each, while stopping at "the
// package.json is there" returns ok.
describe("[round-2 F001] a directory resolves only when its main does", () => {
  const isDir = (p: string) => p === "/repo/dist/pkg";
  const manifestOnly = (p: string) => isDir(p) || p === "/repo/dist/pkg/package.json";

  it("fails a main that names no shipped file", () => {
    const v = one(`require("./pkg")`, manifestOnly, isDir, () => `{"main":"./missing.js"}`);
    expect(v).toMatchObject({ ok: false });
    expect(v.why).toContain("missing.js");
  });

  it("fails a manifest with no main and no index", () => {
    const v = one(`require("./pkg")`, manifestOnly, isDir, () => "{}");
    expect(v).toMatchObject({ ok: false });
    expect(v.why).toContain("main");
  });

  it("fails a manifest that does not parse", () => {
    const v = one(`require("./pkg")`, manifestOnly, isDir, () => "{not json");
    expect(v).toMatchObject({ ok: false });
    expect(v.why).toContain("parse");
  });

  it("fails a main that escapes the packaged directory", () => {
    const out = (p: string) => manifestOnly(p) || p === "/repo/scripts/x.js";
    const v = one(`require("./pkg")`, out, isDir, () => `{"main":"../../scripts/x.js"}`);
    expect(v).toMatchObject({ ok: false });
    expect(v.why).toContain("outside the packaged");
  });

  it("resolves a main through the same extension fallback Node uses", () => {
    const withMain = (p: string) => manifestOnly(p) || p === "/repo/dist/pkg/lib/entry.js";
    expect(verdicts(`require("./pkg")`, withMain, isDir, () => `{"main":"./lib/entry"}`)).toEqual([]);
  });
});

// [round-2 F003] The allowlist is an authority, so it fails closed. An object
// can be composed with a spread, a computed key, or an accessor, and then the
// property esbuild consumes is not the one a literal read returns — an earlier
// `external: ["stale"]` overridden later leaves the extractor reporting `stale`
// while the build externalizes something else. That direction allowlists a
// dependency the VSIX does not carry.
describe("[round-2 F003] a config the extractor cannot read is refused", () => {
  const config = (body: string) => `const extensionConfig = { outfile: "./dist/extension.js", ${body} };`;

  it("refuses a spread that could override the externals", () => {
    expect(() => declaredExternals(config(`external: ["stale"], ...overrides`), OUT)).toThrow(/spread|cannot read/i);
  });

  it("refuses a computed property name", () => {
    expect(() => declaredExternals(config(`external: ["stale"], [key]: 1`), OUT)).toThrow(/computed|cannot read/i);
  });

  it("refuses an accessor", () => {
    expect(() => declaredExternals(config(`get external() { return ["live"]; }`), OUT)).toThrow(
      /accessor|cannot read/i,
    );
  });

  it("still reads the plain literal shape the repo actually has", () => {
    expect([...declaredExternals(ESBUILD, OUT)]).toEqual(["vscode", "node-pty"]);
  });
});


// [round-3 F004/F005/F007] Lexical identity comes from TypeScript's binder, so a
// callee is judged by what it RESOLVES to. `declarations === null` is the exact
// ambient test; a local binding that merely spells `require` has a declaration.
describe("[round-3] a callee is judged by what it resolves to", () => {
  it("follows a scalar alias of require", () => {
    expect(requiredSpecifiers(`var r = require; r("./alias");`)).toEqual(["./alias"]);
  });

  it("follows a factory declared with a function declaration", () => {
    expect(requiredSpecifiers(`function factory(req){ req("./decl"); } factory(require);`)).toEqual(["./decl"]);
  });

  it("does not report a declared local that merely spells require", () => {
    expect(requiredSpecifiers(`function outer(require){ return require("./local-cb"); } outer(function (x) { return x; });`)).toEqual([]);
  });

  it("still reports the ambient require", () => {
    expect(requiredSpecifiers(`require("./direct");`)).toEqual(["./direct"]);
  });
});
