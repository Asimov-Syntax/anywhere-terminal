import { lstat } from "node:fs/promises";
import { posix, win32 } from "node:path";

export interface FileIdentity {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
}

export interface IdentityStatLike extends FileIdentity {}

export interface DirectoryStatLike extends IdentityStatLike {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface AuthorizationBudget {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export interface AuthorizedDirectory {
  readonly path: string;
  readonly platform: NodeJS.Platform;
  readonly components: readonly {
    readonly path: string;
    readonly identity: FileIdentity;
  }[];
}

export interface AuthorizedDirectoryDeps {
  readonly platform?: NodeJS.Platform;
  readonly lstat?: (path: string) => Promise<DirectoryStatLike>;
}

const unbounded: AuthorizationBudget = {
  run: <T>(work: () => Promise<T>) => work(),
};

export function fileIdentityOf(stat: IdentityStatLike | undefined): FileIdentity | undefined {
  if (stat === undefined || stat.ino === 0 || stat.ino === 0n) {
    return undefined;
  }
  return { dev: stat.dev, ino: stat.ino };
}

export function sameFileIdentity(expected: FileIdentity, current: IdentityStatLike | undefined): boolean {
  const identity = fileIdentityOf(current);
  return (
    identity !== undefined &&
    BigInt(expected.dev) === BigInt(identity.dev) &&
    BigInt(expected.ino) === BigInt(identity.ino)
  );
}

export async function authorizeDirectory(
  target: string,
  dependencies: AuthorizedDirectoryDeps = {},
  budget: AuthorizationBudget = unbounded,
): Promise<AuthorizedDirectory | undefined> {
  const platform = dependencies.platform ?? process.platform;
  const paths = componentPaths(target, platform);
  if (paths === undefined) {
    return undefined;
  }
  const read = dependencies.lstat ?? ((candidate: string) => lstat(candidate));
  const components: { path: string; identity: FileIdentity }[] = [];
  try {
    for (const componentPath of paths) {
      const entry = await budget.run(() => read(componentPath));
      const identity = fileIdentityOf(entry);
      if (entry.isSymbolicLink() || !entry.isDirectory() || identity === undefined) {
        return undefined;
      }
      components.push({ path: componentPath, identity });
    }
  } catch {
    return undefined;
  }
  const authorization = { path: paths[paths.length - 1] as string, platform, components };
  return (await directoryStillAuthorized(authorization, { platform, lstat: read }, budget)) ? authorization : undefined;
}

export async function directoryStillAuthorized(
  authorization: AuthorizedDirectory,
  dependencies: AuthorizedDirectoryDeps = {},
  budget: AuthorizationBudget = unbounded,
): Promise<boolean> {
  const read = dependencies.lstat ?? ((candidate: string) => lstat(candidate));
  try {
    for (const expected of authorization.components) {
      const entry = await budget.run(() => read(expected.path));
      if (entry.isSymbolicLink() || !entry.isDirectory() || !sameFileIdentity(expected.identity, entry)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function componentPaths(target: string, platform: NodeJS.Platform): string[] | undefined {
  const path = platform === "win32" ? win32 : posix;
  if (!path.isAbsolute(target)) {
    return undefined;
  }
  const normalized = path.normalize(target);
  const root = path.parse(normalized).root;
  if (root.length === 0) {
    return undefined;
  }
  const components = [root];
  let current = root;
  const suffix = normalized.slice(root.length);
  for (const segment of suffix.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    components.push(current);
  }
  return components;
}
