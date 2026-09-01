// scripts/bundleRequires.mjs — which `require()` calls a built bundle still
// carries, and whether the runtime could satisfy them.
//
// A dependency whose package `main` is a UMD bundle calls its factory with
// `require` as a PARAMETER, and the factory then requires a relative path.
// esbuild cannot follow a require reached through a parameter, so the call
// survives into the output and resolves against `dist/` — where nothing is.
// The extension failed to activate; every suite stayed green, because every
// suite imports sources and none of them loads the artifact.
//
// See: asimov/changes/fail-a-build-whose-bundle-cannot-resolve-itself/design.md D2

import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";

/** `require("x")` / `require('x')`, with the whitespace esbuild may leave. */
const REQUIRE_LITERAL = /\brequire\(\s*(["'])([^"'\n]+)\1\s*\)/g;

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/**
 * The externals the build itself declares, read from `esbuild.js`.
 *
 * Never a second hand-maintained list: an external dropped from the build but
 * left in a gate's allowlist turns a real failure into a pass, and nothing
 * about that drift is visible (design.md D2).
 */
export function declaredExternals(esbuildSource) {
  const block = /external:\s*\[([^\]]*)\]/s.exec(esbuildSource);
  if (block === null) {
    // Fail loud rather than silently allowing nothing: a build whose externals
    // this cannot find is a build this gate cannot judge.
    throw new Error("could not read `external: [...]` from esbuild.js");
  }
  return new Set([...block[1].matchAll(/(["'])([^"']+)\1/g)].map((m) => m[2]));
}

/** Every distinct specifier the bundle still requires, in first-seen order. */
export function requiredSpecifiers(bundleSource) {
  const seen = new Set();
  for (const match of bundleSource.matchAll(REQUIRE_LITERAL)) {
    seen.add(match[2]);
  }
  return [...seen];
}

const isRelative = (specifier) => specifier.startsWith(".") || path.isAbsolute(specifier);

/**
 * Classify one specifier. `resolvesFrom` is the directory the bundle will sit
 * in, so a relative require is judged where the runtime would judge it.
 */
export function classify(specifier, { externals, resolvesFrom, exists = existsSync }) {
  if (BUILTINS.has(specifier)) {
    return { specifier, ok: true, why: "node builtin" };
  }
  if (externals.has(specifier)) {
    return { specifier, ok: true, why: "declared external" };
  }
  if (isRelative(specifier)) {
    const target = path.resolve(resolvesFrom, specifier);
    // The runtime tries these in this order; any one of them is a resolution.
    const found = [target, `${target}.js`, `${target}.json`, path.join(target, "index.js")].some(exists);
    return found
      ? { specifier, ok: true, why: "resolves beside the bundle" }
      : { specifier, ok: false, why: `relative require resolves to ${target}, which is not there` };
  }
  return {
    specifier,
    ok: false,
    why: "bare specifier that was never bundled and is not a declared external",
  };
}

/** Every specifier the runtime could not satisfy. Empty means the bundle is loadable by this test. */
export function unresolvableRequires(bundleSource, { esbuildSource, resolvesFrom, exists }) {
  const externals = declaredExternals(esbuildSource);
  return requiredSpecifiers(bundleSource)
    .map((specifier) => classify(specifier, { externals, resolvesFrom, exists }))
    .filter((verdict) => !verdict.ok);
}

/** Read the two files the gate needs. Separate so tests never touch the disk. */
export function readBuild({ bundle, esbuild }) {
  return { bundleSource: readFileSync(bundle, "utf8"), esbuildSource: readFileSync(esbuild, "utf8") };
}
