/**
 * A token a command-line tool would parse as an option rather than as a value.
 *
 * Shared because two unrelated callers need the same answer for the same reason:
 * git refuses a branch named `--force` as a value, and an agent CLI that takes
 * its prompt positionally would read one as a flag and change the permission
 * posture the user chose. Passing a single argv token defeats SHELL injection;
 * it does nothing about the tool's own option parsing.
 */
export function readsAsFlag(token: string): boolean {
  return token.startsWith("-");
}
