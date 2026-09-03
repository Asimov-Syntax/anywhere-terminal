# Proposal: suggest-worktree-initialization

## Why

A repository with no provisioning file currently stops at “Nothing configured,” even when the main
checkout visibly contains an environment file or a package-manager lockfile. The user must remember
what a new worktree will lack, manually copy secrets, and manually infer the setup command.

## Appetite

M (≤3d)

## Scope

### In scope

- Inspect a fixed, bounded list of repository-root environment filenames and lockfiles only when no
  provisioning source exists.
- Offer each found environment file as an unchecked copy and each found lockfile's static install
  command as an unchecked setup step.
- Explain why every suggestion appeared, that environment files may contain secrets, and what copy
  or run will do.
- Redeem suggestions only through the existing host-held opaque offer.
- Let an explicit Save record selected environment-file copies in the repository's native worktree
  configuration; setup consent remains limited to the current create.

### Out of scope

- Recursive discovery, wildcard environment scans, reading environment-file contents, package-script
  discovery, or command synthesis from repository text.
- Automatically selecting, copying, linking, saving, or running a suggestion.
- Choosing one package manager on the user's behalf when several lockfiles are present; each detected
  lockfile remains a separate unchecked suggestion.
- Changing setup/agent sequencing. The dependent `recommend-setup-before-agent` change owns the
  recommended wait default and overlap wording.
- Adding a browser layout test lane; `prove-create-footer-in-browser` remains separate.

### Must not

- Read a secret value to decide whether to suggest its file.
- Let a path or command returned by the webview become execution authority.
- Treat an unselected suggestion as an exclusion or a saved preference.
- Persist standing consent for any setup command.
- Offer suggestions over a present provisioning source, including one that is empty or unreadable.

## Risk Level

HIGH — the feature handles likely-secret files and executable command suggestions. All rows remain
unchecked and redeem from the existing host-held model, but detection, display, create, and Save must
agree about which authority they are spending.
