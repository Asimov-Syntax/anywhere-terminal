// The gate that would have caught the activation failure no suite could:
// a dependency's UMD factory left `require("./impl/format")` in the bundle,
// where it resolved against `dist/` and found nothing.
//
// Driven over fixture text rather than a rebuilt artifact, so the defect can be
// reintroduced deliberately — WT-011.12's acceptance requires that — without a
// test ever editing the build config it audits.
import { describe, expect, it } from "vitest";
// @ts-expect-error — a build script, deliberately outside the typed source tree
import {
  classify,
  declaredExternals,
  requiredSpecifiers,
  unresolvableRequires,
} from "../../../scripts/bundleRequires.mjs";

const ESBUILD = `
  external: [
    "vscode", // Provided by VS Code runtime
    "node-pty", // Loaded dynamically from VS Code internals
  ],
`;

/** Nothing is on disk, so a relative require resolves only if this says so. */
const nothingThere = (_p: string) => false;
const only =
  (...present: string[]) =>
  (p: string) =>
    present.some((q) => p.endsWith(q));

const verdicts = (bundle: string, exists: (p: string) => boolean = nothingThere) =>
  unresolvableRequires(bundle, { esbuildSource: ESBUILD, resolvesFrom: "/repo/dist", exists });

describe("the requires a built bundle still carries", () => {
  it("reads the externals the build declares, rather than a copy of them", () => {
    expect([...declaredExternals(ESBUILD)]).toEqual(["vscode", "node-pty"]);
  });

  it("refuses to judge a build whose externals it cannot find", () => {
    // Silently allowing nothing would turn every real failure into a pass.
    expect(() => declaredExternals("const x = 1;")).toThrow(/external/);
  });

  it("finds each specifier once, however esbuild spaced the call", () => {
    expect(requiredSpecifiers(`require("a");require( 'b' );require(  "a"  )`)).toEqual(["a", "b"]);
  });
});

describe("[WT-011.12] the defect this gate exists for", () => {
  it("catches the relative require a UMD factory left behind", () => {
    const bundle = `function(require, exports){ var f = require("./impl/format"); }`;

    expect(verdicts(bundle)).toEqual([expect.objectContaining({ specifier: "./impl/format", ok: false })]);
  });

  it("says where it would have resolved, which is the whole diagnosis", () => {
    expect(verdicts(`require("./impl/format")`)[0]?.why).toContain("/repo/dist/impl/format");
  });

  it("passes the same require once that file is actually beside the bundle", () => {
    // Not every relative require is the defect — one esbuild emitted for a
    // chunk it really wrote is fine.
    expect(verdicts(`require("./chunk")`, only("/repo/dist/chunk.js"))).toEqual([]);
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
    // It resolves against a node_modules the VSIX does not carry.
    expect(verdicts(`require("lodash")`)).toEqual([expect.objectContaining({ specifier: "lodash", ok: false })]);
  });

  it("does not treat a builtin as an external, nor the reverse", () => {
    const externals = declaredExternals(ESBUILD);
    expect(classify("node:fs", { externals, resolvesFrom: "/repo/dist" }).why).toBe("node builtin");
    expect(classify("vscode", { externals, resolvesFrom: "/repo/dist" }).why).toBe("declared external");
  });
});
