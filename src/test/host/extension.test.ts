import * as assert from "node:assert";
import * as vscode from "vscode";

// The lane's own smoke test. It asserts the host opened the folder the runner
// config names, because a lane that starts VS Code but opens nothing would still
// pass a self-contained assertion while proving none of what the lane exists for.
suite("Extension host lane", () => {
  test("the runner opened exactly one workspace folder", () => {
    assert.strictEqual(vscode.workspace.workspaceFolders?.length, 1);
  });
});
