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

/** Parentheses are syntax, not a value — `(f)(x)` calls `f`. */
function unwrap(node) {
  let cur = node;
  while (cur !== undefined && ts.isParenthesizedExpression(cur)) {
    cur = cur.expression;
  }
  return cur;
}

const isFunction = (node) => node !== undefined && (ts.isFunctionExpression(node) || ts.isArrowFunction(node));

/**
 * A checker over one in-memory bundle.
 *
 * Lexical identity is the binder's job, not this file's. Three rounds of
 * hand-rolled resolution each missed a spelling that ships — a text scan, then
 * an identifier match, then a scope walk that could not see a function
 * declaration, could not follow an assignment, and could not tell an ambient
 * `require` from a local binding of the same name. `typescript` already answers
 * all three correctly and is already the dependency this file parses with.
 *
 * `noResolve`/`noLib` keep it to the one file: nothing here needs types, only
 * bindings.
 */
function checkerFor(bundleSource) {
  const name = "/bundle.js";
  const file = parse(bundleSource, name);
  const host = {
    getSourceFile: (requested) => (requested === name ? file : undefined),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getDirectories: () => [],
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => f === name,
    readFile: (f) => (f === name ? bundleSource : undefined),
  };
  const program = ts.createProgram([name], { allowJs: true, noResolve: true, noLib: true, types: [] }, host);
  return { checker: program.getTypeChecker(), root: program.getSourceFile(name) ?? file };
}

/**
 * Which symbols hold `require`, resolved by the binder rather than by spelling.
 *
 * The gate reads a `--production` bundle, and minification renames parameters,
 * so the shipped defect is a call on a renamed binding and `require` itself is
 * often only an argument (.reviews/round-2.md F002). Taint therefore flows over
 * SYMBOLS: from a call argument to a parameter, and from an initializer or
 * assignment to the name it binds (.reviews/round-3.md F005). Function
 * declarations are callable targets too (F004). Monotone, so it terminates.
 */
function requireBindings(root, checker) {
  const symbolOf = (identifier) => checker.getSymbolAtLocation(identifier);

  /**
   * Ambient exactly: a symbol the bundle never declares. This replaces the
   * spelling seed, which tainted any binding named `require` and so rejected a
   * legitimate local callback of that name (.reviews/round-3.md F007).
   */
  const isAmbientRequire = (identifier) => {
    if (identifier.text !== "require") {
      return false;
    }
    const symbol = symbolOf(identifier);
    return symbol === undefined || symbol.declarations === undefined || symbol.declarations.length === 0;
  };

  const tainted = new Set();
  const holds = new Map();
  const calls = [];
  const assignments = [];

  walk(root, (node) => {
    if (ts.isCallExpression(node)) {
      calls.push(node);
    }
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      const symbol = symbolOf(node.name);
      if (symbol !== undefined) {
        holds.set(symbol, new Set([node]));
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      assignments.push([node.name, node.initializer]);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = unwrap(node.left);
      if (left !== undefined && ts.isIdentifier(left)) {
        assignments.push([left, node.right]);
      }
    }
  });

  const hold = (symbol, fn) => {
    const held = holds.get(symbol);
    if (held === undefined) {
      holds.set(symbol, new Set([fn]));
      return true;
    }
    if (held.has(fn)) {
      return false;
    }
    held.add(fn);
    return true;
  };

  const taint = (symbol) => {
    if (symbol === undefined || tainted.has(symbol)) {
      return false;
    }
    tainted.add(symbol);
    return true;
  };

  const valueOf = (node) => {
    const value = unwrap(node);
    if (value === undefined) {
      return undefined;
    }
    if (isFunction(value)) {
      return { fn: value };
    }
    if (ts.isIdentifier(value)) {
      return { via: symbolOf(value), ambient: isAmbientRequire(value) };
    }
    return undefined;
  };

  const flow = (target, source) => {
    if (target === undefined || source === undefined) {
      return false;
    }
    if (source.fn !== undefined) {
      return hold(target, source.fn);
    }
    let grew = false;
    if (source.ambient === true) {
      grew = taint(target) || grew;
    }
    if (source.via !== undefined) {
      if (tainted.has(source.via)) {
        grew = taint(target) || grew;
      }
      for (const fn of holds.get(source.via) ?? []) {
        grew = hold(target, fn) || grew;
      }
    }
    return grew;
  };

  const targetsOf = (call) => {
    const callee = unwrap(call.expression);
    if (callee === undefined) {
      return [];
    }
    if (isFunction(callee)) {
      return [callee];
    }
    if (!ts.isIdentifier(callee)) {
      return [];
    }
    const symbol = symbolOf(callee);
    return symbol === undefined ? [] : [...(holds.get(symbol) ?? [])];
  };

  for (let growing = true; growing; ) {
    growing = false;
    for (const [name, initializer] of assignments) {
      growing = flow(symbolOf(name), valueOf(initializer)) || growing;
    }
    for (const call of calls) {
      for (const target of targetsOf(call)) {
        target.parameters.forEach((parameter, position) => {
          if (ts.isIdentifier(parameter.name)) {
            growing = flow(symbolOf(parameter.name), valueOf(call.arguments[position])) || growing;
          }
        });
      }
    }
  }

  return (identifier) => isAmbientRequire(identifier) || tainted.has(symbolOf(identifier));
}

/**
 * The specifier a call requires — never `x.require(...)`, never a computed
 * argument, and never text that merely looks like one.
 */
function requireLiteral(node, isTainted) {
  if (!ts.isCallExpression(node) || node.arguments.length !== 1) {
    return undefined;
  }
  // `ts.isIdentifier` is what rejects `loader.require`: a property access is a
  // PropertyAccessExpression, not an Identifier.
  const callee = unwrap(node.expression);
  if (!ts.isIdentifier(callee) || !isTainted(callee)) {
    return undefined;
  }
  const arg = unwrap(node.arguments[0]);
  return ts.isStringLiteralLike(arg) ? arg.text : undefined;
}

/** Every distinct specifier the bundle still requires, in first-seen order. */
export function requiredSpecifiers(bundleSource) {
  const { checker, root } = checkerFor(bundleSource);
  const isTainted = requireBindings(root, checker);
  const seen = new Set();
  walk(root, (node) => {
    const specifier = requireLiteral(node, isTainted);
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
    // Fails CLOSED. A spread, a computed key, or an accessor can supply the
    // `external` esbuild actually consumes, and reading past them leaves an
    // earlier literal authoritative — allowlisting a dependency the build
    // stopped externalizing and the VSIX does not carry (.reviews/round-2.md
    // F003). The current config is a plain literal, so strictness costs nothing
    // today and is loud on the day it stops being free.
    const unreadable = node.properties.find(
      (p) =>
        ts.isSpreadAssignment(p) ||
        ts.isGetAccessorDeclaration(p) ||
        ts.isSetAccessorDeclaration(p) ||
        (p.name !== undefined && ts.isComputedPropertyName(p.name)),
    );
    if (unreadable !== undefined) {
      const kind = ts.isSpreadAssignment(unreadable)
        ? "a spread"
        : unreadable.name !== undefined && ts.isComputedPropertyName(unreadable.name)
          ? "a computed property name"
          : "an accessor";
      throw new Error(`the esbuild config for ${outfile} uses ${kind} — this gate cannot read it, so it refuses to guess`);
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
/**
 * The file a directory's manifest points at, resolved the way Node would.
 *
 * A `package.json` sitting there is a POINTER, not a resolution: its `main` can
 * name a file the VSIX does not carry, escape the artifact directory, or be
 * absent, and Node throws MODULE_NOT_FOUND for each (.reviews/round-2.md F001).
 */
function resolveManifest(target, root, { exists, isDirectory, readFile }) {
  const at = path.join(target, "package.json");
  let main;
  try {
    main = JSON.parse(readFile(at)).main;
  } catch {
    return { ok: false, why: `resolves to ${target}, whose package.json does not parse` };
  }
  if (typeof main !== "string" || main.trim() === "") {
    return { ok: false, why: `resolves to ${target}, whose package.json declares no main and which has no index` };
  }
  const entry = path.resolve(target, main);
  if (entry !== root && !entry.startsWith(root + path.sep)) {
    return { ok: false, why: `main "${main}" resolves to ${entry}, which is outside the packaged ${path.basename(root)}/` };
  }
  const file = (p) => exists(p) && !isDirectory(p);
  const candidates = [entry, `${entry}.js`, `${entry}.json`, `${entry}.node`];
  if (exists(entry) && isDirectory(entry)) {
    candidates.push(...["index.js", "index.json", "index.node"].map((n) => path.join(entry, n)));
  }
  if (candidates.some(file)) {
    return { ok: true, why: "resolves through its package.json main" };
  }
  return { ok: false, why: `main "${main}" names ${entry}, which the packaged extension does not carry` };
}

function resolveShipped(specifier, { resolvesFrom, exists, isDirectory, readFile }) {
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
    if (file(path.join(target, "package.json"))) {
      return resolveManifest(target, root, { exists, isDirectory, readFile });
    }
    return { ok: false, why: `resolves to ${target}, a directory with no index and no package.json` };
  }
  return { ok: false, why: `resolves to ${target}, which is not there` };
}

/** Classify one specifier. */
export function classify(specifier, {
  externals,
  resolvesFrom,
  exists = existsSync,
  isDirectory = defaultIsDirectory,
  readFile = defaultReadFile,
}) {
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
    return { specifier, ...resolveShipped(specifier, { resolvesFrom, exists, isDirectory, readFile }) };
  }
  return {
    specifier,
    ok: false,
    why: "bare specifier that was never bundled and is not a declared external",
  };
}

function defaultReadFile(p) {
  return readFileSync(p, "utf8");
}

function defaultIsDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Every specifier the packaged extension could not satisfy. */
export function unresolvableRequires(bundleSource, { esbuildSource, outfile, resolvesFrom, exists, isDirectory, readFile }) {
  const externals = declaredExternals(esbuildSource, outfile);
  return requiredSpecifiers(bundleSource)
    .map((specifier) => classify(specifier, { externals, resolvesFrom, exists, isDirectory, readFile }))
    .filter((verdict) => !verdict.ok);
}

/** Read the two files the gate needs. Separate so tests never touch the disk. */
export function readBuild({ bundle, esbuild }) {
  return { bundleSource: readFileSync(bundle, "utf8"), esbuildSource: readFileSync(esbuild, "utf8") };
}
