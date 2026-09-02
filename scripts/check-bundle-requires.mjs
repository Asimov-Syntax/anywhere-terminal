#!/usr/bin/env node
// scripts/check-bundle-requires.mjs — the built bundle can resolve what it requires.
//
// Runs after `esbuild.js --production`, on the ARTIFACT. A dependency's UMD
// factory left `require("./impl/format")` in the output once; it resolved
// against `dist/` at runtime, activation failed, and no suite could have caught
// it because every suite imports sources.
//
// See: asimov/changes/fail-a-build-whose-bundle-cannot-resolve-itself/design.md D1

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exitCodeFor, readBuild, unresolvableRequires } from "./bundleRequires.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.join(root, "dist", "extension.js");
const esbuild = path.join(root, "esbuild.js");

for (const required of [bundle, esbuild]) {
  if (!existsSync(required)) {
    // Fail closed. A missing artifact means the gate proved nothing, and
    // reporting success would be the same silence the defect shipped behind.
    console.error(`[bundle-requires] FAIL: ${path.relative(root, required)} not found — build first.`);
    process.exit(1);
  }
}

const { bundleSource, esbuildSource } = readBuild({ bundle, esbuild });
const bad = unresolvableRequires(bundleSource, {
  esbuildSource,
  // The bundle names its own config, so the externals cannot come from the
  // webview build that sits beside it in esbuild.js.
  outfile: "./dist/extension.js",
  resolvesFrom: path.dirname(bundle),
});

const line = ({ specifier, why }) => `  require(${JSON.stringify(specifier)}) — ${why}`;
const failing = bad.filter((verdict) => verdict.severity === "fails");
const warning = bad.filter((verdict) => verdict.severity === "warns");

if (warning.length > 0) {
  // Reported without a coverage claim: detection for these classes is known
  // incomplete, so it must not be able to reject a legitimate build.
  console.warn(`[bundle-requires] warning: ${warning.length} require(s) that may not resolve:`);
  for (const verdict of warning) {
    console.warn(line(verdict));
  }
}

if (failing.length > 0) {
  console.error(`[bundle-requires] FAIL: ${failing.length} relative require(s) the runtime cannot satisfy:`);
  for (const verdict of failing) {
    console.error(line(verdict));
  }
  console.error("\nA dependency shipped as a UMD bundle is the usual cause: its factory takes");
  console.error("`require` as a parameter, so esbuild cannot follow it. Alias the package to its");
  console.error("ESM build in esbuild.js, the way `jsonc-parser` already is.");
} else {
  console.log(`[bundle-requires] ok — every relative require in dist/extension.js resolves`);
}

process.exit(exitCodeFor(bad));
