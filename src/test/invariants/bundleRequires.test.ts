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
  exitCodeFor,
  parseCount,
  relativeLiterals,
  relativeTemplates,
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
    // the extension bundle is the drift D2 exists to prevent. Driven through
    // `classify` since round 7: bare specifiers no longer reach the sweep, so
    // `verdicts` can no longer witness which config was read.
    expect(declaredExternals(ESBUILD, OUT).has("never-allowlist-me")).toBe(false);
    const externals = declaredExternals(ESBUILD, OUT);
    expect(classify("never-allowlist-me", { externals, resolvesFrom: DIST }).ok).toBe(false);
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

  it("does not report a bare specifier at all, which is round 7's stated price", () => {
    // design.md D2 § the round-7 scope cut. Telling a bare specifier from
    // ordinary text is exactly the question that needed the checker, and the
    // checker is gone. PLAN WT-011.12's acceptance never asked for this class.
    expect(verdicts(`require("lodash")`)).toEqual([]);
  });

  it("does not treat a builtin as an external, nor the reverse", () => {
    const externals = declaredExternals(ESBUILD, OUT);
    expect(classify("node:fs", { externals, resolvesFrom: DIST }).why).toBe("node builtin");
    expect(classify("vscode", { externals, resolvesFrom: DIST }).why).toBe("declared external");
  });
});

// The gate reads a --production bundle, and minification renames the UMD
// factory's `require` parameter. The literal below is esbuild's own output for a
// jsonc-parser-shaped dependency under `--bundle --platform=node --minify`:
// `require` survives only as an ARGUMENT, and the call that carries the defect
// is on the renamed binding `e`. Round 2 used it to prove call detection
// followed the rename; round 7 uses it to prove the sweep never needed to.
const MINIFIED_UMD = `var i=(e,o)=>()=>(o||e((o={exports:{}}).exports,o),o.exports);var f=i((r,t)=>{(function(e){if(typeof t=="object"&&typeof t.exports=="object"){var o=e(require,r);o!==void 0&&(t.exports=o)}})(function(e,o){"use strict";var n=e("./impl/format");o.go=function(){return n}})});var c=f();console.log(c.go());`;
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
// [round-3 F001] A malformed manifest is fatal to the directory. Accepting a
// sibling index first let a directory both Node 18 and Node 24 throw on pass.
describe("[round-3 F001] a manifest is read before its sibling index", () => {
  const isDir = (p: string) => p === "/repo/dist/pkg";
  const both = (p: string) => isDir(p) || p === "/repo/dist/pkg/index.js" || p === "/repo/dist/pkg/package.json";

  it("fails an index sitting beside a manifest that does not parse", () => {
    const v = one(`require("./pkg")`, both, isDir, () => "{not json");
    expect(v).toMatchObject({ ok: false });
    expect(v.why).toContain("parse");
  });

  it("still falls back to the index for a valid manifest with no main", () => {
    expect(verdicts(`require("./pkg")`, both, isDir, () => "{}")).toEqual([]);
  });
});

// [round-3 F003] The guard names element forms the extractor cannot interpret,
// and shorthand was the one the first cut forgot: a trailing `{ external }`
// overrides an earlier literal at runtime while a literal read keeps the stale
// value — the fail-open direction.
describe("[round-3 F003] a shorthand property is refused too", () => {
  it("refuses a shorthand that could override the externals", () => {
    const config = `const external = ["live"]; const c = { outfile: "./dist/extension.js", external: ["stale"], external };`;
    expect(() => declaredExternals(config, OUT)).toThrow(/shorthand|cannot read/i);
  });

  it("still reads the plain literal shape the repo actually has", () => {
    expect([...declaredExternals(ESBUILD, OUT)]).toEqual(["vscode", "node-pty"]);
  });
});

// [round-4 D6] The sweep asks what a specifier IS, not how it is called. Every
// shape below defeated a call-analysis mechanism in some earlier round; none of
// them can hide a relative string literal, because a call has to name its target.
describe("[round-4 D6] a relative specifier is resolved however it is called", () => {
  const swept = (bundle: string) =>
    unresolvableRequires(bundle, {
      esbuildSource: ESBUILD,
      outfile: OUT,
      resolvesFrom: DIST,
      exists: nowhere,
      isDirectory: notADirectory,
      readFile: () => "{}",
    }).map((v) => v.specifier);

  it("reports a conditional alias of require", () => {
    expect(swept(`var r = typeof require === "function" ? require : f; r("./cond");`)).toContain("./cond");
  });

  it("reports a factory invoked through call", () => {
    expect(swept(`function factory(req){ req("./via-call"); } factory.call(null, require);`)).toContain("./via-call");
  });

  it("reports a specifier held in a constant", () => {
    expect(swept(`var r = require, p = "./constant"; r(p);`)).toContain("./constant");
  });

  it("reports a loader carried on an object", () => {
    expect(swept(`var box = { r: require }; box.r("./boxed");`)).toContain("./boxed");
  });

  it("does not report a relative literal that resolves", () => {
    const there = (p: string) => p === "/repo/dist/real.js";
    expect(
      unresolvableRequires(`var x = "./real.js";`, {
        esbuildSource: ESBUILD,
        outfile: OUT,
        resolvesFrom: DIST,
        exists: there,
        isDirectory: notADirectory,
        readFile: () => "{}",
      }),
    ).toEqual([]);
  });

  it("does not report a bare prefix that is not a specifier", () => {
    expect(swept(`var isUp = (p) => p.startsWith("../");`)).not.toContain("../");
  });
});

// [round-5 F013] The allowlist keyed suppression on the decoded string, so one
// unrelated `.startsWith("../")` hid every real request spelling it. An oracle
// attack then refuted the occurrence-scoped exemption drafted to replace it:
// `require("".concat("./x"))` sits in a String method's argument. So there is
// no exemption at all — a prefixed literal is swept wherever it sits (D6).
describe("[round-5 F013] a prefixed literal is swept from any position", () => {
  const swept = (bundle: string) => verdicts(bundle).map((v) => v.specifier);

  it("reports a genuine request sharing a bundle with an unrelated prefix test", () => {
    expect(swept(`var isUp = (p) => p.startsWith("../"); var r = require; r("./gone");`)).toContain("./gone");
  });

  it("reports a literal a string method carries into require", () => {
    expect(swept(`require("".concat("./gone"));`)).toContain("./gone");
  });

  it("reports one an object method carries, where a name-based exemption would not", () => {
    expect(swept(`var box = { startsWith: (s) => require(s) }; box.startsWith("./gone");`)).toContain("./gone");
  });

  it("leaves the real artifact's own prefix test alone", () => {
    expect(swept('var f = (rel) => rel === ".." || rel.startsWith("../") || rel.startsWith("..\\");')).toEqual([]);
  });
});

// [round-5 F014] The sweep recognised only `./` and `../`, so four spellings
// Node accepts walked past it. The predicate covers every relative prefix, and
// excludes the six strings that are a prefix and nothing more (design.md D6).
describe("[round-5 F014] every relative spelling Node accepts is swept", () => {
  const swept = (bundle: string) => verdicts(bundle).map((v) => v.specifier);

  it("reports a posix relative request", () => {
    expect(swept(`var r = require; r("./posix");`)).toContain("./posix");
  });

  it("reports a posix parent request", () => {
    expect(swept(`var r = require; r("../parent");`)).toContain("../parent");
  });

  it("reports a win32 relative request", () => {
    expect(swept(`var r = require; r(".\\\\win");`)).toContain(".\\win");
  });

  it("reports a win32 parent request", () => {
    expect(swept(`var r = require; r("..\\\\winup");`)).toContain("..\\winup");
  });

  it("does not sweep a string that is a relative prefix and nothing more", () => {
    for (const bare of [".", "..", "./", "../", ".\\", "..\\"]) {
      expect(swept(`var probe = ${JSON.stringify(bare)};`)).not.toContain(bare);
    }
  });
});
// [round-5 F008/F009/F010] Five rounds could not make call detection sound for
// bare and absolute requests, and PLAN acceptance never asked it to be: it
// requires a RELATIVE require that will not resolve to fail the build. Those
// classes keep being reported, but as warnings — an incomplete detector that
// fails builds can reject a legitimate one for a guarantee the gate no longer
// makes (design.md D2 § Coverage).
describe("[round-5 D2] only the relative class fails the build", () => {
  it("does not report a bare specifier, after round 7 deleted the pass that found one", () => {
    expect(verdicts(`require("lodash")`)).toEqual([]);
  });

  it("warns on an absolute path baked into the bundle", () => {
    expect(one(`require("/repo/dist/real.js")`, files("/repo/dist/real.js"))).toMatchObject({
      ok: false,
      severity: "warns",
    });
  });

  it("fails on a relative request that does not resolve", () => {
    expect(one(`require("./gone")`)).toMatchObject({ ok: false, severity: "fails" });
  });

  it("sets severity by specifier class, not by which mechanism found it", () => {
    // Swept by the literal pass rather than by call detection, still failing.
    expect(one(`var box = { r: require }; box.r("./gone");`)).toMatchObject({ severity: "fails" });
  });

  it("exits 0 when only warnings are present", () => {
    expect(exitCodeFor(verdicts(`var p = "/repo/dist/impl/format.js";`))).toBe(0);
  });

  it("exits nonzero when a relative request fails", () => {
    expect(exitCodeFor(verdicts(`require("./gone")`))).not.toBe(0);
  });

  it("exits nonzero when a failure sits behind warnings", () => {
    expect(exitCodeFor(verdicts(`var p = "/repo/dist/impl/format.js"; require("./gone")`))).not.toBe(0);
  });

  it("exits 0 when there is nothing to report", () => {
    expect(exitCodeFor(verdicts(`require("vscode")`))).toBe(0);
  });
});
// [round-5 D7] PLAN acceptance says "a relative `require`", not "a relative
// literal". esbuild preserves `r(`./${name}`)` when the loader reaches the
// factory as a parameter — the exact UMD shape this change exists to catch —
// and a TemplateExpression is invisible to both the sweep and call detection.
describe("[round-5 D7] a relative request the gate cannot resolve is reported", () => {
  const swept = (bundle: string) => verdicts(bundle).map((v) => v.specifier);

  // The opening delimiter is assembled rather than written: spelled out in a
  // plain string it trips noTemplateCurlyInString, and in a template literal it
  // trips noUnusedTemplateLiteral. The fixtures are bundle SOURCE, so they have
  // to carry a real one.
  const OPEN = `$${"{"}`;
  const posix = `var r = require; r(\`./${OPEN}name}\`);`;
  const viaFactory = `(function (factory) { factory(require) })(function (e) { e(\`../${OPEN}n}\`); });`;
  const bare = `var r = require; r(\`lodash/${OPEN}name}\`);`;

  it("reports a template whose head is a relative prefix", () => {
    expect(swept(posix).join(" ")).toContain("./");
  });

  it("reports it through a factory parameter, where call detection cannot follow", () => {
    expect(swept(viaFactory).join(" ")).toContain("../");
  });

  it("fails the build rather than warning", () => {
    expect(verdicts(posix)[0]).toMatchObject({ severity: "fails" });
  });

  it("does not report a template with a non-relative head", () => {
    expect(verdicts(bare)).toEqual([]);
  });

  it("does not report a template with no substitution, which is already a literal", () => {
    expect(verdicts("var msg = `./plain`;", files("/repo/dist/plain"))).toEqual([]);
  });
});

// [round-7 D2 ledger] The failing class must survive the deletion of call
// analysis. Every relative specifier a require call can carry is a string
// literal in the bundle, so D6's sweep is a superset there — these witnesses
// pin that, one shape per row, so the deletion in 8_4 cannot quietly lose one.
describe("[round-7 D2] the failing class does not depend on call analysis", () => {
  const OPEN = `$${"{"}`;
  const failing = (bundle: string) =>
    verdicts(bundle)
      .filter((v) => v.severity === "fails")
      .map((v) => v.specifier);

  it("still fails the minified UMD shape this change exists for", () => {
    // esbuild's own --minify output, kept from round 2: the call carrying the
    // defect is on the renamed binding `e`, which is why it took a checker.
    expect(failing(MINIFIED_UMD)).toContain("./impl/format");
    // The sweep is what carries it once call analysis is gone.
    expect(relativeLiterals(MINIFIED_UMD)).toContain("./impl/format");
  });

  it("still fails a parenthesized argument", () => {
    const bundle = `var r = require; r(("./paren-arg"));`;
    expect(failing(bundle)).toContain("./paren-arg");
    expect(relativeLiterals(bundle)).toContain("./paren-arg");
  });

  it("still fails a no-substitution template argument", () => {
    const bundle = "var r = require; r(`./tpl-arg`);";
    expect(failing(bundle)).toContain("./tpl-arg");
    expect(relativeLiterals(bundle)).toContain("./tpl-arg");
  });

  it("still fails the concat shape that refuted the old exemption", () => {
    const bundle = `var r = require; r("".concat("./concat-arg"));`;
    expect(failing(bundle)).toContain("./concat-arg");
    expect(relativeLiterals(bundle)).toContain("./concat-arg");
  });

  it("still fails a computed template argument, which the sweep cannot carry", () => {
    // D7's own pass owns this one — it is not a literal, so the subsumption
    // argument does not cover it and the template collector must.
    expect(failing(`var r = require; r(\`./${OPEN}n}\`);`).join(" ")).toContain("./");
    expect(relativeTemplates(`var r = require; r(\`./${OPEN}n}\`);`)).toEqual(["./"]);
  });
});

// [round-7 D2] Deleting call analysis costs the absolute warning its precision:
// it had precision only because it read require-call ARGUMENTS. A path.isAbsolute
// sweep warns on 12 literals in the real artifact and not one is a module
// request — /bin/zsh, /bin/bash, / and Monaco CSS blocks opening with /*. The
// predicate is the one D2's wording always named: a path under the build root.
describe("[round-7 D2] an absolute path that names the build machine warns", () => {
  it("reports a literal under the build root", () => {
    const found = verdicts(`var p = "/repo/dist/impl/format.js";`);
    expect(found).toEqual([expect.objectContaining({ severity: "warns" })]);
    expect(found[0]?.why).toContain("build machine");
  });

  it("does not fail the build over it", () => {
    expect(exitCodeFor(verdicts(`var p = "/repo/dist/impl/format.js";`))).toBe(0);
  });

  it("reports one the artifact directory's parent carries", () => {
    expect(verdicts(`var p = "/repo/scripts/tool.js";`)).toHaveLength(1);
  });

  it("does not report the shapes the real artifact actually carries", () => {
    // All three pass path.isAbsolute. None names the build machine.
    expect(verdicts(`var a = "/bin/zsh"; var b = "/bin/bash"; var c = "/";`)).toEqual([]);
    expect(verdicts(`var css = "/*--- copyright ---*/\n.x { position: absolute; }";`)).toEqual([]);
  });
});

// [round-7 F019] The position test asked the template's IMMEDIATE parent, so one
// pair of parentheses put a ParenthesizedExpression in between and the request
// produced no verdict at all. Parentheses are syntax, not a value.
describe("[round-7 F019] a computed request is found through the parentheses", () => {
  const OPEN = `$${"{"}`;
  const heads = (bundle: string) => verdicts(bundle).map((v) => v.specifier);

  it("reports a parenthesized template argument", () => {
    expect(heads(`var r = require; r((\`./${OPEN}name}\`));`).join(" ")).toContain("./");
  });

  it("reports it through several parentheses", () => {
    expect(heads(`var r = require; r((((\`../${OPEN}n}\`))));`).join(" ")).toContain("../");
  });

  it("reports the parenthesized UMD-factory shape", () => {
    const viaFactory = `(function (factory) { factory(require) })(function (e) { e((\`../${OPEN}n}\`)); });`;
    expect(heads(viaFactory).join(" ")).toContain("../");
  });

  it("still does not report a template in CALLEE position", () => {
    // `\`./${OPEN}x}\`()` parses as a call whose EXPRESSION is the template. Walking
    // out by parent kind alone would call that an argument; the membership test
    // is what refuses it.
    expect(verdicts(`var t = \`./${OPEN}x}\`();`)).toEqual([]);
  });

  it("still does not report parenthesized path data", () => {
    expect(verdicts(`var p = (\`./${OPEN}name}/icon.svg\`);`)).toEqual([]);
  });
});

// [round-6 F015] Each collector parsed the artifact for itself, so a 1 MB
// bundle paid an AST construction and a walk apiece per gate run, and the
// relative-prefix conditions could drift apart. One AST now serves them all.
describe("[round-6 F015] one parse of the bundle serves every collector", () => {
  const OPEN = `$${"{"}`;
  const BUNDLE = [
    'var r = require; r("./impl/format");',
    'r("lodash");',
    `r(\`../${OPEN}n}\`);`,
    'var data = "./swept-only";',
  ].join("\n");

  it("builds one AST for the bundle, plus the one the esbuild config needs", () => {
    const before = parseCount();
    verdicts(BUNDLE);
    expect(parseCount() - before).toBe(2);
  });

  it("charges the esbuild config exactly one of those two", () => {
    const before = parseCount();
    declaredExternals(ESBUILD, OUT);
    expect(parseCount() - before).toBe(1);
  });

  it("agrees with each collector's own string-taking form", () => {
    const shared = verdicts(BUNDLE).map((v) => v.specifier);
    expect(shared).toContain("./impl/format");
    expect(shared).toContain("./swept-only");
    expect(relativeLiterals(BUNDLE)).toContain("./swept-only");
    expect(relativeTemplates(BUNDLE)).toEqual(["../"]);
  });
});
// [round-6 F018] D7 narrows the template sweep to call-argument positions. A
// relative-headed template is overwhelmingly path DATA — a URL, a CSS url(), a
// message — and only an argument can be a module request. A tagged template is
// its tag's input, never a request.
describe("[round-6 F018] a template is reported only where a request can occur", () => {
  const OPEN = `$${"{"}`;

  it("does not report relative-headed path data", () => {
    expect(verdicts(`var p = \`./${OPEN}name}/icon.svg\`;`)).toEqual([]);
  });

  it("does not report one assigned into an object the bundle carries", () => {
    expect(verdicts(`var cfg = { base: \`../${OPEN}n}\` };`)).toEqual([]);
  });

  it("does not report a tagged template, which is its tag's input", () => {
    expect(verdicts(`var t = tag; var s = t\`./${OPEN}n}\`;`)).toEqual([]);
  });

  it("still reports the UMD call shape this sweep exists for", () => {
    const viaFactory = `(function (factory) { factory(require) })(function (e) { e(\`../${OPEN}n}\`); });`;
    expect(
      verdicts(viaFactory)
        .map((v) => v.specifier)
        .join(" "),
    ).toContain("../");
  });
});

// [round-6 F016] Detection used the four-prefix predicate while `classify` kept
// its own `startsWith(".")` test. They disagree on a bare package whose NAME
// begins with a dot — `.pkg` resolves from `node_modules/.pkg/` at runtime — so
// the gate failed a build over a request D2 says may only warn.
describe("[round-6 F016] one predicate decides the class", () => {
  it("does not sweep a dot-prefixed bare specifier as a relative one", () => {
    // A `startsWith(".")` predicate would sweep `.pkg` and FAIL the build over
    // a package that resolves from `node_modules/.pkg/` at runtime.
    expect(verdicts(`require(".pkg")`)).toEqual([]);
    expect(relativeLiterals(`require(".pkg")`)).toEqual([]);
  });

  it("exits 0 on it", () => {
    expect(exitCodeFor(verdicts(`require(".pkg")`))).toBe(0);
  });

  it("still fails each of the four relative spellings", () => {
    for (const specifier of ["./a", "../b", ".\\c", "..\\d"]) {
      expect(verdicts(`var r = require; r(${JSON.stringify(specifier)});`)[0]).toMatchObject({
        severity: "fails",
      });
    }
  });
});

// [round-6 F017] A Win32-spelled specifier was handed to the host's own
// resolver, so on POSIX `.\lib\thing.js` became one filename containing
// backslashes and could never resolve. The spelling picks the flavour, never
// the build host (design.md D6).
const WIN32_SPELLING = ".\\lib\\thing.js";

describe("[round-6 F017] a Win32 spelling resolves by its spelling", () => {
  it("resolves against the file it names beside the bundle", () => {
    const bundle = `var r = require; r(${JSON.stringify(WIN32_SPELLING)});`;
    expect(verdicts(bundle, files("/repo/dist/lib/thing.js"))).toEqual([]);
  });

  it("still fails when that file is not there", () => {
    const bundle = `var r = require; r(${JSON.stringify(WIN32_SPELLING)});`;
    expect(one(bundle)).toMatchObject({ severity: "fails", ok: false });
    expect(one(bundle).why).toContain("/repo/dist/lib/thing.js");
  });

  it("still refuses a Win32-spelled traversal out of the artifact", () => {
    const bundle = `var r = require; r(${JSON.stringify("..\\..\\etc\\passwd")});`;
    expect(one(bundle, () => true).why).toContain("outside the packaged");
  });
});
