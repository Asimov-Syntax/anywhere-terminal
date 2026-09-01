import { describe, expect, it } from "vitest";
import { MAX_MODEL_ROWS, newBudget, type ProviderDeps } from "./providerKit";
import { VSCODE_TASKS_FILE, vscodeTasksAdapter } from "./vscodeTasksProvider";

const ROOT = "/repo";

function fs(spec: { files?: Record<string, string>; links?: Record<string, string> }): ProviderDeps {
  const files = spec.files ?? {};
  const links = spec.links ?? {};
  const missing = (p: string) => Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
  return {
    readFile: async (p) => {
      const held = files[p];
      if (held === undefined) {
        throw missing(p);
      }
      return held;
    },
    readdir: async (p) => {
      throw missing(p);
    },
    realpath: async (p) => links[p] ?? p,
    lstat: async () => ({}),
  };
}

const read = (text: string) =>
  vscodeTasksAdapter.read(fs({ files: { [`${ROOT}/${VSCODE_TASKS_FILE}`]: text } }), ROOT, newBudget());

/** A task declared to run on worktree creation, plus whatever else. */
function tasksFile(...entries: string[]): string {
  return `{ "version": "2.0.0", "tasks": [${entries.join(",")}] }`;
}

function onCreate(body: string): string {
  return `{ ${body}, "runOptions": { "runOn": "worktreeCreated" } }`;
}

describe("[D1] the file is read on the terms its own format defines", () => {
  it("parses line comments, block comments and a trailing comma", async () => {
    const model = await read(`{
      // the version VS Code writes
      "version": "2.0.0",
      /* every task this repository declares */
      "tasks": [
        {
          "label": "install",
          "type": "shell",
          "command": "pnpm install --frozen-lockfile",
          "runOptions": { "runOn": "worktreeCreated" },
        },
      ],
    }`);

    expect(model?.problems).toEqual([]);
    expect(model?.setup.map((s) => s.script)).toEqual(["pnpm install --frozen-lockfile"]);
  });

  it("names the file when it is not JSON at all", async () => {
    const model = await read("this is not a task file\n");

    expect(model?.problems.map((p) => p.reason)).toEqual(["malformed"]);
    expect(model?.problems[0]?.file).toBe(VSCODE_TASKS_FILE);
    expect(model?.setup).toEqual([]);
  });

  it("is absent, not empty, when the repository has no task file", async () => {
    expect(await vscodeTasksAdapter.read(fs({}), ROOT, newBudget())).toBeNull();
  });

  it("refuses a task file that is itself a symlink out, before it is read", async () => {
    let opened = 0;
    const deps: ProviderDeps = {
      ...fs({ links: { [`${ROOT}/${VSCODE_TASKS_FILE}`]: "/elsewhere/tasks.json" } }),
      readFile: async (p) => {
        opened += 1;
        throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
      },
    };
    const model = await vscodeTasksAdapter.read(deps, ROOT, newBudget());

    expect(opened).toBe(0);
    expect(model?.problems.map((p) => p.file)).toEqual([VSCODE_TASKS_FILE]);
  });
});

describe("only what the repository declared as worktree setup", () => {
  it("offers a marked task and not an unmarked one", async () => {
    const model = await read(
      tasksFile(
        `{ "label": "build", "type": "shell", "command": "pnpm build" }`,
        onCreate(`"label": "install", "type": "shell", "command": "pnpm install"`),
      ),
    );

    expect(model?.setup.map((s) => s.script)).toEqual(["pnpm install"]);
  });

  it("keeps file order", async () => {
    const model = await read(
      tasksFile(
        onCreate(`"label": "one", "type": "shell", "command": "first"`),
        `{ "label": "skipped", "type": "shell", "command": "no" }`,
        onCreate(`"label": "two", "type": "shell", "command": "second"`),
      ),
    );

    expect(model?.setup.map((s) => s.script)).toEqual(["first", "second"]);
    expect(model?.setup.every((s) => s.source === VSCODE_TASKS_FILE)).toBe(true);
  });
});

describe("[D4] a command is quoted unless the task declares itself a shell task", () => {
  const INJECTED = "./bin/build; touch /tmp/pwned";

  it("makes a process task's command ONE word, semicolon and all", async () => {
    const model = await read(tasksFile(onCreate(`"label": "b", "type": "process", "command": "${INJECTED}"`)));

    // VS Code runs a process task with no shell, so this names a file with a
    // semicolon in it. Verbatim into `sh -c` it would be two commands.
    expect(model?.setup[0]?.script).toBe(`'./bin/build; touch /tmp/pwned'`);
  });

  it("quotes a command whose task declares no type at all", async () => {
    const model = await read(tasksFile(onCreate(`"label": "b", "command": "${INJECTED}"`)));

    expect(model?.setup[0]?.script).toBe(`'./bin/build; touch /tmp/pwned'`);
  });

  it("leaves the same command verbatim when the task says it is shell text", async () => {
    const model = await read(tasksFile(onCreate(`"label": "b", "type": "shell", "command": "${INJECTED}"`)));

    // Declared shell, so it already IS shell text. Quoting it would break the
    // task the repository wrote.
    expect(model?.setup[0]?.script).toBe(INJECTED);
  });

  it("makes an argument one literal word whatever it holds", async () => {
    const model = await read(
      tasksFile(onCreate(`"label": "b", "type": "shell", "command": "echo", "args": ["it's; $(id) \\"x\\"", "plain"]`)),
    );

    expect(model?.setup[0]?.script).toBe(`echo 'it'\\''s; $(id) "x"' 'plain'`);
  });

  it("quotes an argument given in VS Code's object form too", async () => {
    const model = await read(
      tasksFile(onCreate(`"label": "b", "type": "shell", "command": "echo", "args": [{ "value": "a b" }]`)),
    );

    expect(model?.setup[0]?.script).toBe(`echo 'a b'`);
  });
});

describe("what it cannot supply, it names — and still offers", () => {
  it("reports an unresolved placeholder and offers the step anyway", async () => {
    const model = await read(
      tasksFile(onCreate(`"label": "seed", "type": "shell", "command": "node \${workspaceFolder}/seed.js"`)),
    );

    // Never completed with a value this module chose: a substituted command is
    // not the command the file declares.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the unresolved token is what is asserted
    expect(model?.setup[0]?.script).toBe("node ${workspaceFolder}/seed.js");
    expect(model?.problems.map((p) => p.reason)).toEqual(["unsubstituted"]);
    expect(model?.problems[0]?.detail).toContain("`seed`");
  });

  it("reports a task that asks to run somewhere else, and offers the step anyway", async () => {
    const model = await read(
      tasksFile(onCreate(`"label": "elsewhere", "type": "shell", "command": "ls", "options": { "cwd": "/tmp" }`)),
    );

    expect(model?.setup.map((s) => s.script)).toEqual(["ls"]);
    expect(model?.problems.map((p) => p.reason)).toEqual(["unsubstituted"]);
    expect(model?.problems[0]?.detail).toContain("`elsewhere`");
  });

  it("reports a marked task with no command and offers nothing for it", async () => {
    const model = await read(tasksFile(onCreate(`"label": "empty", "type": "shell"`)));

    expect(model?.setup).toEqual([]);
    expect(model?.problems.map((p) => p.reason)).toEqual(["malformed"]);
  });
});

describe("[round-1 F002] a task file cannot outgrow the model cap", () => {
  it("stops at the cap however many steps the repository declares", async () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      onCreate(`"label": "t${i}", "type": "shell", "command": "echo ${i}"`),
    );
    const model = await read(tasksFile(...many));

    expect(model).not.toBeNull();
    const rows = (model?.setup.length ?? 0) + (model?.entries.length ?? 0) + (model?.problems.length ?? 0);
    // The bound protects the postMessage and the DOM, so it is the total that
    // matters — a checked-in file must not be able to choose how big the
    // message the webview receives is.
    expect(rows).toBeLessThanOrEqual(MAX_MODEL_ROWS);
    expect(model?.setup.length).toBeLessThan(250);
    expect(model?.problems.map((x) => x.reason)).toContain("malformed");
  });
});
