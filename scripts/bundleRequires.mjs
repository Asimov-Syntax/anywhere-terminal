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

let parsesBuilt = 0;

const parse = (source, name) => {
  parsesBuilt += 1;
  return ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
};

/**
 * How many ASTs this module has built, so the one-parse claim is observable.
 *
 * Each collector used to parse the artifact for itself: a 1 MB bundle paid
 * three constructions and three walks per run, and the two relative-prefix
 * conditions could drift apart (.reviews/round-6.md F015).
 */
export function parseCount() {
  return parsesBuilt;
}

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
 * Whether `node` sits where a module request can be passed.
 *
 * The position is a fact about the CALL, not about the immediate parent:
 * `r((`./${name}`))` put a ParenthesizedExpression in between and the request
 * produced no verdict at all (.reviews/round-7.md F019). Parentheses are syntax,
 * so climb out of them first — the same thing `unwrap` does descending.
 *
 * `parent.arguments` is then checked by IDENTITY rather than by parent kind: a
 * tagged template's own template is a child of a call-like node too, and
 * `` `./${x}`() `` is a call whose EXPRESSION is the template, which kind alone
 * would call an argument.
 */
function isCallArgument(node) {
  let cur = node;
  let parent = cur.parent;
  while (parent !== undefined && ts.isParenthesizedExpression(parent)) {
    cur = parent;
    parent = cur.parent;
  }
  if (parent === undefined || !(ts.isCallExpression(parent) || ts.isNewExpression(parent))) {
    return false;
  }
  return (parent.arguments ?? []).some((argument) => unwrap(argument) === node);
}

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
function requireBindings(root, checker, stats) {
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

  /** (symbol, fn) pairs held since the last drain, so a call revisits only what is new. */
  const freshlyHeld = [];

  const hold = (symbol, fn) => {
    const held = holds.get(symbol);
    if (held === undefined) {
      holds.set(symbol, new Set([fn]));
      freshlyHeld.push([symbol, fn]);
      return true;
    }
    if (held.has(fn)) {
      return false;
    }
    held.add(fn);
    freshlyHeld.push([symbol, fn]);
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

  // Reverse indexes: symbol → the edges that READ it. A new fact enqueues only
  // those, instead of re-walking every assignment and every call (round-4 F006).
  // The rescan loop cost edges x facts — a 2000-link reverse chain took ~2s.
  /** symbol → assignment edges whose source reads it. */
  const readsInAssignment = new Map();
  /** symbol → calls whose callee is it, so new callables revisit them. */
  const calledAs = new Map();
  /** symbol → call edges passing it as an argument. */
  const passedAs = new Map();

  const under = (index, key, value) => {
    if (key === undefined) {
      return;
    }
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, [value]);
      return;
    }
    at.push(value);
  };

  for (const edge of assignments) {
    const source = valueOf(edge[1]);
    under(readsInAssignment, source?.via, edge);
  }
  for (const call of calls) {
    const callee = unwrap(call.expression);
    if (callee !== undefined && ts.isIdentifier(callee)) {
      under(calledAs, symbolOf(callee), call);
    }
    for (const argument of call.arguments) {
      const value = unwrap(argument);
      if (value !== undefined && ts.isIdentifier(value)) {
        under(passedAs, symbolOf(value), call);
      }
    }
  }

  const applyCall = (call, only) => {
    let grew = false;
    for (const target of only === undefined ? targetsOf(call) : [only]) {
      if (stats !== undefined) {
        stats.applications += 1;
        let applied = stats.pairs.get(call);
        if (applied === undefined) {
          applied = new Set();
          stats.pairs.set(call, applied);
        }
        applied.add(target);
      }
      target.parameters.forEach((parameter, position) => {
        if (ts.isIdentifier(parameter.name)) {
          grew = flow(symbolOf(parameter.name), valueOf(call.arguments[position])) || grew;
        }
      });
    }
    return grew;
  };

  /**
   * One argument symbol's newly grown facts, delivered to the targets already
   * held.
   *
   * A generic re-application traverses EVERY target and re-flows EVERY
   * position, which is what left argument-side growth quadratic after the
   * callee side was bounded: 40 targets against 40 argument callables cost 1640
   * applications for 40 distinct pairs. Only the positions this symbol occupies
   * can have changed (.reviews/round-6.md F006).
   */
  const deliverArgument = (call, symbol) => {
    const grown = [];
    for (const target of targetsOf(call)) {
      target.parameters.forEach((parameter, position) => {
        const argument = unwrap(call.arguments[position]);
        if (argument === undefined || !ts.isIdentifier(argument) || symbolOf(argument) !== symbol) {
          return;
        }
        if (!ts.isIdentifier(parameter.name)) {
          return;
        }
        const held = symbolOf(parameter.name);
        if (flow(held, valueOf(argument))) {
          grown.push(held);
        }
      });
    }
    return grown;
  };

  const queue = [...assignments.map((edge) => ({ assignment: edge })), ...calls.map((call) => ({ call }))];

  /**
   * A call whose CALLEE just gained a callable is revisited for that callable
   * alone. Re-applying every target each time one was discovered is what made
   * fanout quadratic: 800 callables cost 502ms (.reviews/round-5.md F006).
   */
  const drainFreshlyHeld = () => {
    while (freshlyHeld.length > 0) {
      const [symbol, fn] = freshlyHeld.pop();
      for (const call of calledAs.get(symbol) ?? []) {
        queue.push({ call, only: fn });
      }
    }
  };

  const enqueue = (symbol) => {
    for (const edge of readsInAssignment.get(symbol) ?? []) {
      queue.push({ assignment: edge });
    }
    for (const call of passedAs.get(symbol) ?? []) {
      queue.push({ call, fromArgument: symbol });
    }
  };

  while (queue.length > 0) {
    const work = queue.pop();
    if (work.assignment !== undefined) {
      const [name, initializer] = work.assignment;
      const symbol = symbolOf(name);
      if (flow(symbol, valueOf(initializer))) {
        enqueue(symbol);
      }
      drainFreshlyHeld();
      continue;
    }
    if (work.fromArgument !== undefined) {
      for (const grown of deliverArgument(work.call, work.fromArgument)) {
        enqueue(grown);
      }
      drainFreshlyHeld();
      continue;
    }
    if (applyCall(work.call, work.only)) {
      const revisited = work.only === undefined ? targetsOf(work.call) : [work.only];
      for (const parameter of revisited.flatMap((target) => target.parameters)) {
        if (ts.isIdentifier(parameter.name)) {
          enqueue(symbolOf(parameter.name));
        }
      }
    }
    drainFreshlyHeld();
  }

  return (identifier) => isAmbientRequire(identifier) || tainted.has(symbolOf(identifier));
}

/**
 * What the propagation actually did, so the edge-once claim is observable.
 *
 * `applications` counts every (call, target) application; `distinct` counts the
 * pairs those applications covered. A wall-clock budget cannot witness this —
 * the round-4 timing assertion passed while fanout was still quadratic
 * (.reviews/round-5.md F006).
 */
export function propagationStats(bundleSource) {
  const { checker, root } = checkerFor(bundleSource);
  const stats = { applications: 0, pairs: new Map() };
  requireBindings(root, checker, stats);
  let distinct = 0;
  for (const targets of stats.pairs.values()) {
    distinct += targets.size;
  }
  return { applications: stats.applications, distinct };
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

/** The relative prefixes Node accepts, POSIX and Win32 (design.md D6). */
export const RELATIVE_PREFIXES = ["./", "../", ".\\", "..\\"];

/**
 * The six strings that are exactly a relative prefix and nothing more.
 *
 * Legal requests, but in a bundle they are overwhelmingly path DATA: 95
 * occurrences on the real artifact and never one as a specifier. Excluded by
 * VALUE because that is a property of these six strings, not of where they sit
 * — the position-based exemption drafted here instead was refuted, since
 * `require("".concat("./x"))` puts a real specifier in a String method's
 * argument (design.md D6).
 */
const BARE_PREFIXES = new Set([".", "..", ...RELATIVE_PREFIXES]);

/** Whether a decoded string is a relative request with something after the prefix. */
export function isRelativeRequest(text) {
  return RELATIVE_PREFIXES.some((prefix) => text.startsWith(prefix)) && !BARE_PREFIXES.has(text);
}

/**
 * Every distinct relative string literal in the bundle, in first-seen order.
 *
 * Independent of how anything is CALLED. Four rounds of call analysis each
 * missed a spelling that ships — a conditional alias, `.call`, a constant
 * argument, a loader on an object property — and a call has to name its target,
 * so the literal is the one thing no spelling can hide (design.md D6).
 */
export function relativeLiterals(bundleSource) {
  return literalsIn(parse(bundleSource, "bundle.js"));
}

function literalsIn(root) {
  const seen = new Set();
  walk(root, (node) => {
    if (!ts.isStringLiteralLike(node)) {
      return;
    }
    const text = node.text;
    if (isRelativeRequest(text)) {
      seen.add(text);
    }
  });
  return [...seen];
}

/**
 * Every relative-headed template in the bundle, as its head text.
 *
 * A template whose head starts with a relative prefix is provably a relative
 * request whatever its substitutions evaluate to, but what it resolves to is
 * not knowable without running the program — so it is reported rather than
 * resolved (design.md D7). The bare-prefix limit does NOT apply here: a head of
 * exactly `./` is the dangerous case, not path data.
 *
 * Reported only in a CALL-ARGUMENT position. A relative-headed template is
 * overwhelmingly path data — a URL, a CSS `url()`, a message — and only an
 * argument can be a module request; a tagged template is its tag's input, not a
 * call's (.reviews/round-6.md F018).
 */
export function relativeTemplates(bundleSource) {
  return templatesIn(parse(bundleSource, "bundle.js"));
}

function templatesIn(root) {
  const seen = new Set();
  walk(root, (node) => {
    if (!ts.isTemplateExpression(node) || !isCallArgument(node)) {
      return;
    }
    const head = node.head.text;
    if (RELATIVE_PREFIXES.some((prefix) => head.startsWith(prefix))) {
      seen.add(head);
    }
  });
  return [...seen];
}

/**
 * Every absolute literal in the bundle that names the BUILD MACHINE.
 *
 * Not every absolute literal. Call analysis gave this class its precision by
 * reading require-call ARGUMENTS, and a literal sweep has none: 12 distinct
 * literals in the real artifact pass `path.isAbsolute` and not one is a module
 * request — `/bin/zsh`, `/bin/bash`, `/`, and CSS blocks that open `/*`. So the
 * predicate is the one D2's wording always named, a path under the build root
 * (design.md D2). An absolute path from elsewhere on the builder is a stated
 * limit: the gate can only attribute paths it can locate.
 */
export function buildMachineLiterals(bundleSource, resolvesFrom) {
  return machinePathsIn(parse(bundleSource, "bundle.js"), resolvesFrom);
}

function machinePathsIn(root, resolvesFrom) {
  const buildRoot = path.dirname(path.resolve(resolvesFrom));
  const seen = new Set();
  walk(root, (node) => {
    if (!ts.isStringLiteralLike(node)) {
      return;
    }
    const text = node.text;
    if (path.isAbsolute(text) && (text === buildRoot || text.startsWith(buildRoot + path.sep))) {
      seen.add(text);
    }
  });
  return [...seen];
}

/** Every distinct specifier the bundle still requires, in first-seen order. */
export function requiredSpecifiers(bundleSource) {
  const { checker, root } = checkerFor(bundleSource);
  return specifiersIn(root, checker);
}

function specifiersIn(root, checker) {
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
        ts.isShorthandPropertyAssignment(p) ||
        ts.isGetAccessorDeclaration(p) ||
        ts.isSetAccessorDeclaration(p) ||
        (p.name !== undefined && ts.isComputedPropertyName(p.name)),
    );
    if (unreadable !== undefined) {
      const kind = ts.isSpreadAssignment(unreadable)
        ? "a spread"
        : ts.isShorthandPropertyAssignment(unreadable)
          ? "a shorthand property"
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
    // FATAL to the directory: Node 18 and Node 24 both throw resolving a
    // directory whose manifest will not parse, so a sibling index cannot rescue
    // it (.reviews/round-3.md F001).
    return { ok: false, fatal: true, why: `resolves to ${target}, whose package.json does not parse` };
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

/** The Win32 spellings among the relative prefixes. */
const WIN32_PREFIXES = RELATIVE_PREFIXES.filter((prefix) => prefix.includes("\\"));

/**
 * A relative request in the one flavour the resolver reads.
 *
 * The spelling picks the flavour, never the build host: `.\\lib\\thing.js` is a
 * Win32 path wherever this gate runs, and handing it to a POSIX resolver made
 * it one filename with backslashes in it, so it could never resolve
 * (.reviews/round-6.md F017, design.md D6).
 */
function posixSpelling(specifier) {
  return WIN32_PREFIXES.some((prefix) => specifier.startsWith(prefix)) ? specifier.replaceAll("\\", "/") : specifier;
}

function resolveShipped(specifier, { resolvesFrom, exists, isDirectory, readFile }) {
  const target = path.resolve(resolvesFrom, posixSpelling(specifier));
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
    // The manifest is read FIRST. Taking the index first let a directory
    // holding both an index and a manifest that will not parse pass this gate
    // while Node throws on it (.reviews/round-3.md F001). Node's index fallback
    // still applies to a VALID manifest whose main is absent or unresolved.
    const viaManifest = file(path.join(target, "package.json"))
      ? resolveManifest(target, root, { exists, isDirectory, readFile })
      : undefined;
    if (viaManifest?.ok === true || viaManifest?.fatal === true) {
      return { ok: viaManifest.ok, why: viaManifest.why };
    }
    for (const candidate of ["index.js", "index.json", "index.node"].map((n) => path.join(target, n))) {
      if (file(candidate)) {
        return { ok: true, why: "resolves to a directory index beside the bundle" };
      }
    }
    if (viaManifest !== undefined) {
      return { ok: false, why: viaManifest.why };
    }
    return { ok: false, why: `resolves to ${target}, a directory with no index and no package.json` };
  }
  return { ok: false, why: `resolves to ${target}, which is not there` };
}

/** Classify one specifier. */
/**
 * The exit code the gate reports for a set of verdicts.
 *
 * Only the relative class fails a build. Bare and absolute requests are
 * reported without a coverage claim, so they warn (design.md D2 § Coverage).
 * Lives here rather than in the CLI so the exit rule itself is testable —
 * importing the CLI would run the gate.
 */
export function exitCodeFor(verdicts) {
  return verdicts.some((verdict) => verdict.severity === "fails") ? 1 : 0;
}

export function classify(specifier, {
  externals,
  resolvesFrom,
  exists = existsSync,
  isDirectory = defaultIsDirectory,
  readFile = defaultReadFile,
}) {
  if (BUILTINS.has(specifier)) {
    return { specifier, ok: true, severity: "none", why: "node builtin" };
  }
  if (externals.has(specifier)) {
    return { specifier, ok: true, severity: "none", why: "declared external" };
  }
  if (path.isAbsolute(specifier)) {
    // A machine path baked into a shipped bundle is wrong even when it exists
    // on the builder — it names the build machine, not the user's.
    return {
      specifier,
      ok: false,
      severity: "warns",
      why: "absolute path baked into the bundle — it names the build machine",
    };
  }
  // One predicate decides the class for detection and severity alike (.reviews/round-6.md F016).
  if (isRelativeRequest(specifier)) {
    const shipped = resolveShipped(specifier, { resolvesFrom, exists, isDirectory, readFile });
    return { specifier, severity: shipped.ok ? "none" : "fails", ...shipped };
  }
  return {
    specifier,
    ok: false,
    severity: "warns",
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
  // Two questions, neither subsuming the other: the sweep owns the relative
  // class soundly, and call detection owns bare and absolute specifiers, which
  // cannot be swept because every string would be a candidate (design.md D6).
  // One AST serves all three collectors; the wrappers above stay as thin
  // string-taking forms so the witnesses can still drive each one alone.
  const { checker, root } = checkerFor(bundleSource);
  const candidates = new Set([
    ...specifiersIn(root, checker),
    ...literalsIn(root),
    ...machinePathsIn(root, resolvesFrom),
  ]);
  const resolved = [...candidates]
    .map((specifier) => classify(specifier, { externals, resolvesFrom, exists, isDirectory, readFile }))
    .filter((verdict) => !verdict.ok);
  // A relative request the gate cannot resolve is still a relative request
  // (design.md D7). It fails rather than warns because the real artifact
  // carries none, so the rule cannot reject a build that works today.
  const computed = templatesIn(root).map((head) => ({
    specifier: `${head}\${...}`,
    ok: false,
    severity: "fails",
    why: "relative request built at runtime — the gate cannot resolve what it will name",
  }));
  return [...resolved, ...computed];
}

/** Read the two files the gate needs. Separate so tests never touch the disk. */
export function readBuild({ bundle, esbuild }) {
  return { bundleSource: readFileSync(bundle, "utf8"), esbuildSource: readFileSync(esbuild, "utf8") };
}
