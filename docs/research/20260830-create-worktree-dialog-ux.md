---
topic: create-worktree-dialog-ux
created-by: user research request
date: 2026-08-30
verified: 2026-08-30
libraries: [VS Code Webview API, Git worktree]
used-by: [ad-hoc]
---

# Research: create-worktree-dialog-ux

## Answers

### 1. Comparable dialogs in the wild

| Product | Actual primary surface / observed workflow | What is not primary or is absent | Source / visual |
|---|---|---|---|
| **GitKraken Desktop** | Worktrees appear in the left panel (List/Agents views); create/switch/lock/remove are worktree actions. The documented convention creates a folder named for the branch. | The public help does not document a field-level create modal. Do not infer tabs, an agent picker, or a path-preview treatment from it. | [GitKraken worktrees](https://help.gitkraken.com/gitkraken-desktop/worktrees/), [overview](https://gitkraken.com/learn/git/git-worktree) |
| **Fork** | Branch creation is a separate modal: name plus a **Checkout after create** choice. Add Worktree requires an already-existing local branch; a requested combined new-branch option remains a feature request. | Combined branch + worktree setup is deliberately not in the dialog; this is evidence against copying its two-step flow for an agent-oriented tool. | [Fork issue #2703](https://github.com/fork-dev/TrackerWin/issues/2703), [release notes](https://git-fork.com/releasenotes) |
| **Tower** | **Revision or Branch**, **Destination Folder**, and **Detach Worktree** are all first-class in Add Worktree. Contextual “Checkout Branch in New Worktree” preselects the branch. | No documented agent/start-task controls. The path is editable rather than presented as prose. | [Tower macOS guide, with screenshot](https://www.git-tower.com/help/guides/worktrees/add/mac), [Windows](https://www.git-tower.com/help/guides/worktrees/add/windows) |
| **SourceTree** | Regular branch creation is a small branch-name flow based on the selected/current ref. | No supported native worktree creation/management dialog; worktree folders are opened as separate repositories/bookmarks. | [Atlassian community discussion](https://community.atlassian.com/forums/Sourcetree-questions/worktree-branch-in-the-sourcetree/qaq-p/3233538) |
| **JetBrains IDEs** | New Worktree has **From branch**, **Project name**, **Location**, and a **New Branch** option. It puts source, identity, and location on the primary dialog; remote source can make a local branch. | Multi-repository projects and nested worktrees are unsupported/not recommended: important constraints deserve near-field validation, not an Advanced footnote. | [IntelliJ New Worktree documentation](https://www.jetbrains.com/help/idea/use-git-worktrees.html) |
| **GitHub Desktop** | Current Branch picker → **New Branch** → branch name → Create. Branch source is the current branch/default branch; a prior commit can be chosen before starting. | It does not create worktrees and has no destination path. Its lesson is that the branch picker is the entry point, not a long form. | [Managing branches](https://docs.github.com/en/desktop/making-changes-in-a-branch/managing-branches-in-github-desktop) |
| **Graphite** | Its documented workflow is interactive stack/branch selection (`gt checkout`) then create (`gt create`); configured prefixes can produce names. | No desktop worktree modal is documented. Do not present it as a worktree-dialog precedent. | [CLI quick start](https://graphite.com/docs/cli-quick-start), [branch guide](https://graphite.com/guides/creating-new-git-branch) |
| **GitButler** | Parallel/virtual branches are lanes within one working directory; branch creation can be implicit from changes. | It intentionally does **not** create Git worktrees, so it is a conceptual contrast rather than a modal layout precedent. | [Parallel branches](https://docs.gitbutler.com/features/branch-management/virtual-branches), [GitButler worktree comparison](https://blog.gitbutler.com/git-worktrees) |
| **Conductor** | A workspace creates a worktree + branch, normally under `~/conductor/workspaces/<repo>/<workspace>`; it starts from a configured base branch and supports an existing-branch shortcut. | The docs do not establish a detailed field layout. City names and ignored-file copying are product-specific, not UI defaults to emulate. | [Worktrees](https://www.conductor.build/docs/concepts/git-worktrees), [workspaces and branches](https://www.conductor.build/docs/concepts/workspaces-and-branches) |
| **Crystal / crystl** | A comparison article covers IDE worktree support, not an authoritative Create Worktree form. | Insufficient official evidence for a Crystal dialog layout. | [IDE comparison](https://crystl.dev/blog/git-worktrees-in-your-editor/) |
| **Cursor** | Worktrees are agent-centric: `/worktree` starts an isolated checkout for a chat; `/apply-worktree` and `/delete-worktree` manage it. Setup is customizable in `.cursor/worktrees.json`. | Docs do not evidence a conventional dialog with branch search. Treat it as a lifecycle precedent, not a visual one. | [Cursor worktrees](https://cursor.com/docs/configuration/worktrees) |
| **cmux** | Clarify identity: **coder/cmux** documents a workspace as a worktree; **manaflow-ai/cmux** has an open request, not shipped first-class worktree creation. | A requested design is not a product precedent. Avoid claiming the macOS cmux ships a create dialog. | [coder/cmux DeepWiki](https://deepwiki.com/coder/cmux/2.3-creating-a-workspace), [manaflow request #3414](https://github.com/manaflow-ai/cmux/issues/3414) |
| **Warp** | Detects existing worktrees and supports agent sessions in isolated worktrees. | The published docs do not expose a field-by-field branch picker/modal. | [Warp worktrees](https://docs.warp.dev/code/git-worktrees/), [parallel agents](https://docs.warp.dev/guides/agent-workflows/how-to-run-multiple-ai-coding-agents/) |
| **Linear** | Git/issue integrations supply issue identity and branch conventions; reliable public documentation for a dedicated branch-creation form was not found. | Do not cite Linear as evidence for a “create branch X” combobox without a current source. | [Linear–Vercel integration](https://linear.app/integrations/vercel) |
| **Vercel** | Project creation connects a repository then configures project metadata/framework; later project names are mutable while the project ID is stable. | The public API/docs do not substantiate a particular dashboard create-modal slug interaction. | [create-project API](https://vercel.com/docs/rest-api/projects/create-a-new-project), [project management](https://vercel.com/docs/projects/managing-projects) |

**Synthesis.** The strongest direct worktree-form precedents are **Tower** and **JetBrains**: source/branch, human-facing name, and editable location are primary. GitHub Desktop supports making the branch picker itself the obvious starting point. Competitor claims about tabs, agent pickers, and setup-script previews need screenshot-level verification before being treated as product fact.

### 2. Long filesystem paths in a narrow dialog

A path is confirmation metadata, not the form’s visual subject. Never allow it to grow the modal vertically. One compact, single-line treatment is enough; preserve the full value via copy, tooltip, and reveal.

| Pattern | Use | Notes |
|---|---|---|
| **Collapsed breadcrumb** | Best default for paths: `… / parent / worktree-name` (usually 2–3 terminal segments). | Breadcrumb systems recommend collapsing intermediate items and exposing the complete hierarchy in an overflow menu; Spectrum recommends tooltip on hover/focus. [Spectrum breadcrumbs](https://spectrum.adobe.com/page/breadcrumbs/) |
| **End-aware/middle truncation** | Good if the final directory uniquely identifies the worktree: `/Users/…/anywhere-terminal/my-branch`. | Normal single-line ellipsis hides the end and is wrong for a location preview. Use measured JS middle truncation for correctness; it preserves both root/context and unique tail. |
| **Tail-only (right-aligned/reverse ellipsis)** | When users only need the final pathname: `…/worktrees/my-branch`. | `direction: rtl` plus `unicode-bidi: plaintext` is a pragmatic visual technique but reverses punctuation/bidi semantics and has historical WebKit quirks. Use it only for a read-only visual span, not an editable/copy source; test macOS Safari/Electron. |
| **Full path on hover/focus** | Always pair with truncation. | Use a VS Code-compatible custom tooltip or `title` as fallback. Focus must surface the same text for keyboard users. |
| **Reveal / copy affordance** | A small icon button (“Reveal in Finder” or “Copy path”) turns a preview into an actionable confirmation. | Make it secondary; do not force users to inspect a path. |
| **Do not show it** | When destination is truly fixed, unsurprising, and has no collision/permission decision. | Show a quiet “Created beside this repository” sentence after submit or only in Advanced. Here the user can override it, so retain a one-line summary. |

**Platform comparison.** Finder’s path bar represents hierarchy as clickable segments rather than a wrapped raw string; when names are constrained it preserves useful terminal information rather than turning the path into a paragraph. VS Code Quick Open is a filter-first picker: it ranks/matches the filename and supplies directory context as secondary metadata, rather than showing a long path as the primary reading target. Browser download UI similarly gives the filename/status prominence and relegates the folder to a reveal action or secondary context. Adopt that information hierarchy: **branch/name first; destination tail second; full path on demand**.

Concrete CSS (webview):

```css
.pathSummary {
  display: flex; min-width: 0; align-items: center; gap: 6px;
  color: var(--vscode-descriptionForeground);
  font: 12px var(--vscode-font-family); /* proportional, not editor monospace */
}
.pathSummary__tail {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* “show the end” fallback; visual-only and tested in Electron/WebKit */
.pathSummary__tail--end { direction: rtl; unicode-bidi: plaintext; text-align: left; }
```

For a native-feeling breadcrumb, use `…` as an overflow button followed by the last two segments, and use the full raw path as the tooltip/copy value. Reserve `var(--vscode-editor-font-family)` monospace for an editable raw **Path override** field or a copyable detail, not a passive preview.

### 3. Derived value + override

**Recommended control contract:** show a read-only, compact **Destination** summary in the primary form plus an adjacent `Edit` icon/button. Activating it reveals an editable single-line path input in place (or expands Advanced and focuses **Path override**). Label it explicitly: “Destination (automatic)” before override; “Destination (custom)” after it. On override, show a small `Reset to automatic` text button and immediately recompute/show the automatic alternative as helper text.

This is stronger than an always-visible inline editable preview because it distinguishes a consequential filesystem override from normal data entry, prevents accidental edits, and does not make the derived path dominate. It is also stronger than the current Advanced-only approach because users who need a non-default path must discover a hidden control. Keep a persistent **Path override** entry in Advanced only if `Edit` opens that row and reveals the drawer: two routes should reach the same state, not create two separate values.

- **Automatic value:** use muted helper styling and a small “Automatic” badge, not placeholder text. A placeholder disappears on focus and is a poor representation of an actual computed value.
- **Custom value:** show the real custom path in an input, a `Custom` badge, and `Reset` (not “clear”) so reverting has an intelligible outcome.
- **Validation:** keep invalid path, non-empty directory, and duplicate-worktree messages immediately below that input. Do not validate only at submit.
- **Precedent principle:** Vercel distinguishes mutable project name from stable project ID in its project model; do not overload one mutable-looking field with both identity and computed implementation detail. [Vercel project management](https://vercel.com/docs/projects/managing-projects). GitHub’s repository creation similarly treats the human name as primary and derived/availability information as feedback at the field.

### 4. Name collision before submit

The collision should read as a predictable resolution, not an error paragraph. Prefer a one-line amber inline hint directly below the name field:

```text
Branch name     feature/search
                Existing worktree — will use feature/search-2  [Use name]
```

- Use a neutral/amber **“Name already in use”** icon + short sentence. Red/error is reserved for a condition that blocks creation.
- Put the resolved name in a visually distinct inline code chip (`feature/search-2`), not in a long monospace paragraph.
- Synchronize the destination tail: `…/feature-search-2`; this makes the consequence visible without repeating prose.
- If alternatives are acceptable, a compact picker/chips (`-2`, `-3`) may be useful; otherwise one deterministic suffix and an editable name are enough.
- **Do not silently replace the typed field value.** It destroys user intent and makes it hard to understand what happened. Only replace it after a deliberate action such as **Use suggested name**; preserve the original in undoable/editable form.
- GitHub’s repository-name pattern is field-local availability feedback; Vercel deployment/project naming relies on a name-derived public URL, so collision consequences should appear next to the value that causes them—not in a distant summary. No current public source was found for the claimed npm/Vercel live-check UI; do not cite such a specific precedent.

### 5. Progressive disclosure

**Advanced works** when every hidden setting is rare, independently comprehensible, and has a safe default. It **hurts** when it hides the choice that defines the user’s main intent or contains a state required to make the primary fields valid.

| Primary | Advanced |
|---|---|
| Branch source/name picker; selected base/ref summary; destination summary + Edit; what happens immediately after creation; collision/path validation | Explicit base ref change (if current default is usually right); detached mode; raw path override (reachable from primary Edit); branch-source diagnostics and uncommon Git flags |

“After creating” is post-create workflow intent and changes the form radically when Agent is selected. It belongs in primary, but not as an ambiguous select. Use a 3-option **segmented radio group** when labels are short and mutually exclusive: `Do nothing | Open folder | Start agent`. This makes the choice scannable and reveals the dependent Agent / Permissions / First prompt fields immediately below only for **Start agent**. A native `select` is acceptable only if vertical space is critically constrained, but it hides the three available outcomes and the consequential agent path. A checklist is wrong: outcomes are mutually exclusive.

### 6. Branch pickers

Use one **editable combobox**, not top-level tabs, for the common case:

```text
Branch / source  [ Search branches or type a new name                         ▾ ]
                 Recent
                 ✓ main                         Local
                   origin/release/1.4           Remote
                 ─────────────────────────────────────────
                 Create new branch “feature/search” from main
```

- Put the selected/current base in the input or supporting label; searching filters as the user types.
- Group sources as **Recent**, **Local**, **Remote**; put checked-out/current and recency above an alphabetical remainder. Show remote names and a remote badge so similarly named refs are distinguishable.
- Free text has an explicit final action: **Create new branch “X” from `<base>`**. This combines selection and creation without forcing a premature mode choice. Validate Git ref syntax live.
- Offer **Existing branch** and **Detached commit** as a small adjacent mode/menu or in Advanced only if rare. They have distinct validity and should not pretend to be ordinary branch names.
- Tabs such as Smart / GitHub / Branch / Name work only if they are genuinely different *sources with different metadata or search models* (ticket service, PR, raw ref). For a narrow VS Code modal they cost height, split keyboard search, and can make branch creation feel like four workflows. Prefer one omnibox with typed/result sections; add an optional `Link issue…` secondary affordance if tickets are important.

JetBrains’ explicit From branch/New Branch distinction and GitHub Desktop’s Current Branch picker support the core rule: source selection is first-class, but do not require a user to choose a source mode before they can type. [JetBrains](https://www.jetbrains.com/help/idea/use-git-worktrees.html), [GitHub Desktop](https://docs.github.com/en/desktop/making-changes-in-a-branch/managing-branches-in-github-desktop).

### 7. VS Code dark-theme dialog aesthetics

A VS Code webview must use theme tokens; hard-coded charcoal, blue, borders, or fonts is the strongest “bolted-on” signal. The official webview guidance requires themeable UI, accessible keyboard navigation and ARIA, and recommends using webviews only where extension APIs cannot supply the interaction. [Webview UX guidelines](https://code.visualstudio.com/api/ux-guidelines/webviews), [Webview API/theme support](https://code.visualstudio.com/api/extension-guides/webview), [theme-color reference](https://code.visualstudio.com/api/references/theme-color).

Use the injected `--vscode-*` variables (periods become hyphens) and the workbench’s compact density:

- Surface/text: `--vscode-editor-background`, `--vscode-foreground`, `--vscode-descriptionForeground`, `--vscode-editorWidget-border`.
- Inputs: `--vscode-input-background`, `--vscode-input-foreground`, `--vscode-input-border`, `--vscode-inputValidation-warningBackground`, `--vscode-inputValidation-warningBorder`, `--vscode-inputValidation-errorBackground`.
- Actions/focus: `--vscode-button-background`, `--vscode-button-foreground`, `--vscode-button-secondaryBackground`, `--vscode-focusBorder`.
- Type: `--vscode-font-family` and `--vscode-font-size` for controls/body. Only code-like raw refs/paths use `--vscode-editor-font-family`.
- Layout: approximately 8 px control gaps, 12–16 px section gaps, labels immediately above inputs, a consistent single-column form, 28–32 px controls, and one clear primary footer button. Do not use rounded “marketing” cards, heavy shadows, oversized heading text, or a second custom color system.
- Interaction: visible focus ring with `--vscode-focusBorder`; Enter submits only when no combobox list is active; Escape closes; all icon-only reveal/copy/edit buttons have accessible names and tooltips; warn/error messages use text and icon as well as color.

## Recommended Approach

1. Make **branch/source** the first, searchable editable combobox and make branch creation a result in that same list; retain source/ref and detached choices only when relevant.
2. Turn destination into a compact one-line, end-aware breadcrumb summary with tooltip/copy/reveal and an explicit `Edit` path override; never wrap raw path text.
3. Keep post-create intent primary as a segmented radio group; reveal agent configuration only under Start agent, and move only rare Git/path mechanics to Advanced.

## Concrete recommended layout

```text
Create worktree                                                     [×]

Branch / source
[ Search branches, or type a new branch name                    ▾ ]
  Recent · Local · Remote results; last result: Create “feature/search” from main

Base: main                                                   [Change]

Destination  [Automatic]                     …/anywhere-terminal/feature-search
                                              [Edit path] [Copy] [Reveal]

[!] Name already in use — will use [feature-search-2]         [Use name]
    Destination: …/anywhere-terminal/feature-search-2

After creating
(•) Do nothing       ( ) Open folder       ( ) Start agent

┌ shown only with Start agent ──────────────────────────────────────┐
│ Agent       [ Claude Code                                      ▾ ] │
│ Permissions [ Ask before sensitive actions                     ▾ ] │
│ First prompt                                                     │
│ [ Describe what the agent should do…                            ] │
└───────────────────────────────────────────────────────────────────┘

› Advanced  (Base ref · existing branch · detached commit · path override)

                                                   [Cancel] [Create worktree]
```

| Field / behavior | Placement and rationale |
|---|---|
| Branch/source combobox | **Primary.** It defines the worktree. It supplies branch search, local/remote context, recency, and a single free-text “create” action. |
| Base summary + Change | **Primary, compact.** Starting point matters but is normally current/default; Change can open a picker without an always-visible extra row. |
| Destination summary | **Primary, read-only by default.** It answers “where will this go?” without becoming visual ballast. Edit enters the one true override control. |
| Collision resolution | **Primary and field-local.** A short amber hint and code chip describe the deterministic result before submit. |
| After creating | **Primary segmented radios.** This is a deliberate workflow choice, not an implementation knob. |
| Agent, permissions, first prompt | **Conditional primary.** They appear only after Start agent; do not make non-agent creators scan them. |
| Base ref override, existing/detached source, raw path override | **Advanced.** They are exceptional Git/path mechanics, but Advanced should visibly summarize non-default values once set. |

## Confidence

**High** — direct official documentation confirms Tower, JetBrains, GitHub Desktop, Cursor, Warp, Conductor, GitButler, and VS Code behavior; the recommendation is corroborated by their shared hierarchy. **Medium** for exact visual layouts of GitKraken, Crystal, Linear, Vercel, and cmux because public documentation did not expose a current field-level dialog; those gaps are explicitly marked rather than inferred.
