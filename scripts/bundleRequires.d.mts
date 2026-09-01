// Types for the build gate in `bundleRequires.mjs`, so the suite that drives it
// gets real types rather than a suppression.

export interface Verdict {
  readonly specifier: string;
  readonly ok: boolean;
  readonly why: string;
}

export interface ResolveDeps {
  readonly externals: ReadonlySet<string>;
  readonly resolvesFrom: string;
  readonly exists?: (p: string) => boolean;
  readonly isDirectory?: (p: string) => boolean;
  readonly readFile?: (p: string) => string;
}

export interface BundleDeps {
  readonly esbuildSource: string;
  readonly outfile: string;
  readonly resolvesFrom: string;
  readonly exists?: (p: string) => boolean;
  readonly isDirectory?: (p: string) => boolean;
  readonly readFile?: (p: string) => string;
}

export function requiredSpecifiers(bundleSource: string): string[];
export function declaredExternals(esbuildSource: string, outfile: string): Set<string>;
export function classify(specifier: string, deps: ResolveDeps): Verdict;
export function unresolvableRequires(bundleSource: string, deps: BundleDeps): Verdict[];
export function readBuild(paths: { bundle: string; esbuild: string }): {
  bundleSource: string;
  esbuildSource: string;
};
