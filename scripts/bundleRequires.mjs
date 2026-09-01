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
 * Name → declaration for one scope's own parameters and `var`/`let`/`const`.
 *
 * Built once per scope and cached. The first cut recomputed this on every
 * identifier on every pass of the fixed point, which on a real 1 MB minified
 * bundle did not terminate in any useful time — a gate that never answers is
 * worse than one that answers wrongly, because it stops the build either way.
 */
function scopeNames(scope, cache) {
  const hit = cache.get(scope);
  if (hit !== undefined) {
    return hit;
  }
  const names = new Map();
  if (ts.isFunctionLike(scope) && scope.parameters !== undefined) {
    for (const parameter of scope.parameters) {
      if (ts.isIdentifier(parameter.name)) {
        names.set(parameter.name.text, parameter);
      }
    }
  }
  const statements = ts.isSourceFile(scope)
    ? scope.statements
    : scope.body !== undefined && ts.isBlock(scope.body)
      ? scope.body.statements
      : undefined;
  for (const statement of statements ?? []) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && !names.has(declaration.name.text)) {
        names.set(declaration.name.text, declaration);
      }
    }
  }
  cache.set(scope, names);
  return names;
}

/**
 * The declaration an identifier resolves to, innermost scope first.
 *
 * `undefined` means nothing in this bundle declares it — which is how the
 * AMBIENT `require` is told apart from a parameter that merely shares its name.
 * Memoized per identifier node: the fixed point below asks repeatedly, and the
 * answer cannot change between passes.
 */
function makeResolver() {
  const scopes = new Map();
  const answers = new Map();
  return (identifier) => {
    const cached = answers.get(identifier);
    if (cached !== undefined) {
      return cached.binding;
    }
    let binding;
    for (let cur = identifier.parent; cur !== undefined && binding === undefined; cur = cur.parent) {
      if (ts.isSourceFile(cur) || ts.isFunctionLike(cur)) {
        binding = scopeNames(cur, scopes).get(identifier.text);
      }
    }
    answers.set(identifier, { binding });
    return binding;
  };
}

/**
 * Which names hold `require`, by BINDING rather than by spelling.
 *
 * The gate reads a `--production` bundle, and minification renames parameters.
 * A UMD dependency receives `require` as a factory ARGUMENT, so the shipped
 * defect is a call on a renamed binding and `require` itself is never the
 * callee (.reviews/round-2.md F002). One fixed point over the parsed bundle:
 * resolve a callee identifier back to the function it is bound to, bind that
 * function's parameters positionally to the call's arguments, and let taint
 * flow. Finite, and each pass only adds, so it terminates.
 */
function requireBindings(root) {
  /**
   * Binding declaration → every function expression it may hold.
   *
   * A SET, and only ever added to. Holding a single function let one binding
   * flip between two values on alternate passes — a minified bundle wraps every
   * module with the same helper, so one parameter legitimately receives dozens
   * of different factories — and `growing` then never went false. Monotone
   * growth is what makes the fixed point terminate at all.
   */
  const holds = new Map();
  /** Binding declarations that hold `require`. */
  const tainted = new Set();
  const calls = [];
  const resolve = makeResolver();

  walk(root, (node) => {
    if (ts.isCallExpression(node)) {
      calls.push(node);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isFunction(unwrap(node.initializer))) {
      holds.set(node, new Set([unwrap(node.initializer)]));
    }
  });

  /**
   * Two seeds. Ambient `require` — an identifier this bundle never declares —
   * and any binding still SPELLED `require`, which is the unminified factory
   * parameter. Spelling stays sufficient; round 2's defect was treating it as
   * necessary, so dropping it now would trade one blind spot for another.
   */
  const isTainted = (identifier) => {
    if (identifier.text === "require") {
      return true;
    }
    const binding = resolve(identifier);
    return binding !== undefined && tainted.has(binding);
  };

  /** Returns whether this added anything, which is the fixed point's clock. */
  const hold = (binding, fn) => {
    const held = holds.get(binding);
    if (held === undefined) {
      holds.set(binding, new Set([fn]));
      return true;
    }
    if (held.has(fn)) {
      return false;
    }
    held.add(fn);
    return true;
  };

  const targetsOf = (call) => {
    const callee = unwrap(call.expression);
    if (isFunction(callee)) {
      return [callee];
    }
    if (!ts.isIdentifier(callee)) {
      return [];
    }
    const binding = resolve(callee);
    return binding === undefined ? [] : [...(holds.get(binding) ?? [])];
  };

  for (let growing = true; growing; ) {
    growing = false;
    for (const call of calls) {
      for (const target of targetsOf(call)) {
        target.parameters.forEach((parameter, index) => {
          const argument = unwrap(call.arguments[index]);
          if (argument === undefined || !ts.isIdentifier(parameter.name)) {
            return;
          }
          if (isFunction(argument)) {
            growing = hold(parameter, argument) || growing;
            return;
          }
          if (!ts.isIdentifier(argument)) {
            return;
          }
          if (isTainted(argument) && !tainted.has(parameter)) {
            tainted.add(parameter);
            growing = true;
          }
          const from = resolve(argument);
          for (const fn of (from === undefined ? undefined : holds.get(from)) ?? []) {
            growing = hold(parameter, fn) || growing;
          }
        });
      }
    }
  }

  return isTainted;
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
  const root = parse(bundleSource, "bundle.js");
  const isTainted = requireBindings(root);
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
