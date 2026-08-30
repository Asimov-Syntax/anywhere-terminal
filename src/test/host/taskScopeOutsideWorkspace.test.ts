import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Does a task scoped to a directory outside the workspace actually run there?
 *
 * The provisioning design admits a setup step that runs a `.vscode/tasks.json`
 * entry from a newly created worktree through VS Code's task system, so the entry
 * keeps its identity. A worktree the create dialog just made is a plain directory —
 * not a workspace folder — and this asks whether the task system can be pointed at
 * one.
 *
 * The probe is the shell's own working directory, written to a marker file. The
 * `ShellExecution` deliberately carries **no** `options.cwd`: setting it would make
 * the shell run in the right place and prove nothing, because the claim under test
 * is about the folder the task system binds, not about where a command can be told
 * to run.
 *
 * POSIX-only by design — the question is about VS Code's scope resolution, which is
 * platform-independent, and the lane runs on the developer platform.
 */
suite("A task scoped outside the workspace", () => {
  let foreignDir: string;
  let marker: string;

  setup(() => {
    foreignDir = fs.mkdtempSync(path.join(os.tmpdir(), "at-foreign-"));
    marker = path.join(foreignDir, "observed-cwd.txt");
  });

  teardown(() => {
    fs.rmSync(foreignDir, { recursive: true, force: true });
  });

  async function runAndObserve(scope: vscode.WorkspaceFolder | vscode.TaskScope): Promise<string> {
    const execution = new vscode.ShellExecution(`pwd > ${JSON.stringify(marker)}`);
    const task = new vscode.Task({ type: "shell" }, scope, "probe", "anywhere-terminal", execution);

    const running = await vscode.tasks.executeTask(task);

    // `executeTask` resolves when the task STARTS. Reading the marker here would
    // read nothing, and a missing file has a different cause than a wrong path, so
    // the two are reported apart.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        subscription.dispose();
        reject(new Error("the task process never ended within 20s — this is a hang, not an answer"));
      }, 20_000);
      const subscription = vscode.tasks.onDidEndTaskProcess((event) => {
        if (event.execution !== running) {
          return;
        }
        clearTimeout(timer);
        subscription.dispose();
        resolve();
      });
    });

    assert.ok(fs.existsSync(marker), "the task ran but wrote no marker — the shell command did not execute");
    return fs.realpathSync(fs.readFileSync(marker, "utf8").trim());
  }

  const openedFolder = (): string => {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length === 1, "the lane must open exactly one workspace folder");
    return fs.realpathSync(folders[0].uri.fsPath);
  };

  test("a WorkspaceFolder built for a foreign directory does not bind the task to it", async () => {
    const foreign = fs.realpathSync(foreignDir);
    const scope: vscode.WorkspaceFolder = {
      uri: vscode.Uri.file(foreignDir),
      name: path.basename(foreignDir),
      index: 0,
    };

    const observed = await runAndObserve(scope);

    assert.notStrictEqual(
      observed,
      foreign,
      `expected the foreign folder NOT to be honoured, but the task ran in it (${observed})`,
    );
    assert.strictEqual(
      observed,
      openedFolder(),
      `the task ran in ${observed}; the opened workspace folder is ${openedFolder()} and the foreign folder is ${foreign}`,
    );
  }).timeout(60_000);

  test("TaskScope.Workspace falls back to the opened folder, not the foreign one", async () => {
    const foreign = fs.realpathSync(foreignDir);

    const observed = await runAndObserve(vscode.TaskScope.Workspace);

    assert.notStrictEqual(observed, foreign, `the task unexpectedly ran in the foreign folder (${observed})`);
    assert.strictEqual(
      observed,
      openedFolder(),
      `the task ran in ${observed}; the opened workspace folder is ${openedFolder()}`,
    );
  }).timeout(60_000);
});
