# No spec delta

No externally verifiable behaviour or externally mandated constraint changes. Every shape this
change lands is the message contract between our own webview and our own host; the create dialog
sends the same intents it sends today and the removal dialog renders the same lines, from a richer
source.

The two nearest candidates were checked and rejected:

- **`worktree-panel`** — it owns what the panel can do. This change adds no control, removes none,
  and changes no outcome the user can observe. The new expressive room (reattach, adopt, a
  provisioning offer, proof-gated options) is delivered by the tasks that build those surfaces:
  WT-012.7, WT-012.8, WT-012.15, WT-013.1, WT-013.4. Writing their deltas here would claim
  behaviour this change does not ship.
- **`worktree-tree-protocol`** — it owns the tree the host publishes, which this change does not
  touch. The create request and the removal assessment travel on their own messages.

The one property worth stating and deliberately kept out of a spec: the create request can no
longer *express* a base ref on a mode that must refuse one. That is a compile-time property of an
internal type, invisible from outside the extension, and so is private HOW under the admission
gate — it lives in design.md D1 and is verified by a type-level test.
