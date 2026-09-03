/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Minimal type surface of the built-in `vscode.git` extension's public API
// (v1). Only the members our `GitDecorationProvider` consumes are typed; the
// real extension exports many more.
//
// Source: https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
// Trimmed and vendored here so consumers don't depend on the upstream `.d.ts`
// at build time.

import type { Event, Uri } from "vscode";

export interface GitExtension {
  readonly enabled: boolean;
  readonly onDidChangeEnablement: Event<boolean>;
  getAPI(version: 1): API;
}

export type APIState = "uninitialized" | "initialized";

export interface API {
  readonly state: APIState;
  readonly onDidChangeState: Event<APIState>;
  readonly repositories: Repository[];
  readonly onDidOpenRepository: Event<Repository>;
  readonly onDidCloseRepository: Event<Repository>;
  /** Optional across the extension's supported VS Code range. */
  openRepository?(root: Uri): Promise<Repository | null>;
}

export interface MigrateChangesOptions {
  confirmation?: boolean;
  deleteFromSource?: boolean;
  untracked?: boolean;
}

export interface Repository {
  readonly rootUri: Uri;
  readonly state: RepositoryState;
  /** Optional across the extension's supported VS Code range. */
  migrateChanges?(sourceRepositoryPath: string, options?: MigrateChangesOptions): Promise<void>;
}

export interface RepositoryState {
  readonly workingTreeChanges: Change[];
  readonly indexChanges: Change[];
  readonly mergeChanges: Change[];
  readonly untrackedChanges?: Change[];
  readonly onDidChange: Event<void>;
}

export interface Change {
  readonly uri: Uri;
  readonly originalUri: Uri;
  readonly renameUri: Uri | undefined;
  readonly status: Status;
}

/** Mirrors `Status` from `extensions/git/src/api/git.d.ts`. */
export enum Status {
  INDEX_MODIFIED = 0,
  INDEX_ADDED = 1,
  INDEX_DELETED = 2,
  INDEX_RENAMED = 3,
  INDEX_COPIED = 4,

  MODIFIED = 5,
  DELETED = 6,
  UNTRACKED = 7,
  IGNORED = 8,
  INTENT_TO_ADD = 9,
  INTENT_TO_RENAME = 10,
  TYPE_CHANGED = 11,

  ADDED_BY_US = 12,
  ADDED_BY_THEM = 13,
  DELETED_BY_US = 14,
  DELETED_BY_THEM = 15,
  BOTH_ADDED = 16,
  BOTH_DELETED = 17,
  BOTH_MODIFIED = 18,
}
