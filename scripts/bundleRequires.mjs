// scripts/bundleRequires.mjs — which `require()` calls a built bundle still
// carries, and whether the PACKAGED extension could satisfy them.
//
// A dependency whose package `main` is a UMD bundle calls its factory with
// `require` as a PARAMETER, and the factory then requires a relative path.
// esbuild cannot follow a require reached through a parameter, so the call
// survives into the output and resolves against `dist/` — where nothing is.
// The extension failed to activate; every suite stayed green, because every
// suite imports sources and none of them loads the artifact.
//
// Syntax, not text. A regex over the bundle reported `require("./x")` written
// inside a comment or a diagnostic STRING, and reported `loader.require("./x")`
// — a method call that is not this `require` at all (.reviews/round-1.md F002).
// `typescript` is a direct devDependency and already carries a gate here
// (`src/test/invariants/fsDeletionGate.ts`), so the AST is the repo's own idiom.
//
// See: asimov/changes/fail-a-build-whose-bundle-cannot-resolve-itself/design.md D2

import { existsSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import ts from "typescript";

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

const parse = (source, name) => ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/**
 * A direct `require("literal")` call — never `x.require(...)`, never a
 * computed argument, and never text that merely looks like one.
 */
function requireLiteral(node) {
  if (!ts.isCallExpression(node) || node.arguments.length !== 1) {
    return undefined;
  }
  // `ts.isIdentifier` is what rejects `loader.require`: a property access is a
  // PropertyAccessExpression, not an Identifier.
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "require") {
    return undefined;
  }
  const [arg] = node.arguments;
  return ts.isStringLiteralLike(arg) ? arg.text : undefined;
}

/** Every distinct specifier the bundle still requires, in first-seen order. */
export function requiredSpecifiers(bundleSource) {
  const seen = new Set();
  walk(parse(bundleSource, "bundle.js"), (node) => {
    const specifier = requireLiteral(node);
    if (specifier !== undefined) {
      seen.add(specifier);
    }
  });
  return [...seen];
}

/**
 * The externals declared by the build that produces `outfile`.
 *
 * Found by its OWN config object, not by the first `external:` in the file:
 * `esbuild.js` configures the extension and the webview, and taking whichever
 * array appeared first would allowlist the wrong build's externals. A commented
 * -out entry is not a member of an array, which is the other thing the text
 * scan got wrong (.reviews/round-1.md F003).
 */
export function declaredExternals(esbuildSource, outfile) {
  const found = [];
  walk(parse(esbuildSource, "esbuild.js"), (node) => {
    if (!ts.isObjectLiteralExpression(node)) {
      return;
    }
    const props = new Map();
    for (const p of node.properties) {
      if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name))) {
        props.set(p.name.text, p.initializer);
      }
    }
    const out = props.get("outfile");
    if (out === undefined || !ts.isStringLiteralLike(out) || out.text !== outfile) {
      return;
    }
    const external = props.get("external");
    if (external === undefined) {
      found.push(new Set());
      return;
    }
    if (!ts.isArrayLiteralExpression(external)) {
      throw new Error(`\`external\` for ${outfile} is not an array literal — this gate cannot read it`);
    }
    const names = external.elements.map((e) => {
      if (!ts.isStringLiteralLike(e)) {
        throw new Error(`\`external\` for ${outfile} holds a computed entry — this gate cannot read it`);
      }
      return e.text;
    });
    found.push(new Set(names));
  });
  if (found.length !== 1) {
    // Loud, both ways. Zero means the build moved and this gate is judging
    // nothing; more than one means it cannot tell which config is the bundle's.
    throw new Error(`expected exactly one esbuild config with outfile ${outfile}, found ${found.length}`);
  }
  return found[0];
}

const isFile = (p, exists, stat) => exists(p) && stat(p);

/**
 * Would the PACKAGED extension resolve this relative specifier?
 *
 * Two things the builder's filesystem cannot be asked directly (F001):
 * existence in the checkout is not existence in the VSIX — `scripts/` and
 * `node_modules/` are not shipped — and a directory that merely exists is not a
 * module. So resolution must land on a real FILE, and that file must be inside
 * the artifact directory.
 */
function resolveShipped(specifier, { resolvesFrom, exists, isDirectory }) {
  const target = path.resolve(resolvesFrom, specifier);
  const root = path.resolve(resolvesFrom);
  const inside = target === root || target.startsWith(root + path.sep);
  if (!inside) {
    return { ok: false, why: `resolves to ${target}, which is outside the packaged ${path.basename(root)}/` };
  }
  const file = (p) => exists(p) && !isDirectory(p);
  for (const candidate of [target, `${target}.js`, `${target}.json`, `${target}.node`]) {
    if (file(candidate)) {
      return { ok: true, why: "resolves beside the bundle" };
    }
  }
  if (exists(target) && isDirectory(target)) {
    for (const candidate of ["index.js", "index.json", "index.node"].map((n) => path.join(target, n))) {
      if (file(candidate)) {
        return { ok: true, why: "resolves to a directory index beside the bundle" };
      }
    }
    const manifest = path.join(target, "package.json");
    if (file(manifest)) {
      return { ok: true, why: "resolves to a directory with its own package.json" };
    }
    return { ok: false, why: `resolves to ${target}, a directory with no index and no package.json` };
  }
  return { ok: false, why: `resolves to ${target}, which is not there` };
}

/** Classify one specifier. */
export function classify(specifier, { externals, resolvesFrom, exists = existsSync, isDirectory = defaultIsDirectory }) {
  if (BUILTINS.has(specifier)) {
    return { specifier, ok: true, why: "node builtin" };
  }
  if (externals.has(specifier)) {
    return { specifier, ok: true, why: "declared external" };
  }
  if (path.isAbsolute(specifier)) {
    // A machine path baked into a shipped bundle is wrong even when it exists
    // on the builder — it names the build machine, not the user's.
    return { specifier, ok: false, why: "absolute path baked into the bundle — it names the build machine" };
  }
  if (specifier.startsWith(".")) {
    return { specifier, ...resolveShipped(specifier, { resolvesFrom, exists, isDirectory }) };
  }
  return {
    specifier,
    ok: false,
    why: "bare specifier that was never bundled and is not a declared external",
  };
}

function defaultIsDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Every specifier the packaged extension could not satisfy. */
export function unresolvableRequires(bundleSource, { esbuildSource, outfile, resolvesFrom, exists, isDirectory }) {
  const externals = declaredExternals(esbuildSource, outfile);
  return requiredSpecifiers(bundleSource)
    .map((specifier) => classify(specifier, { externals, resolvesFrom, exists, isDirectory }))
    .filter((verdict) => !verdict.ok);
}

/** Read the two files the gate needs. Separate so tests never touch the disk. */
export function readBuild({ bundle, esbuild }) {
  return { bundleSource: readFileSync(bundle, "utf8"), esbuildSource: readFileSync(esbuild, "utf8") };
}
