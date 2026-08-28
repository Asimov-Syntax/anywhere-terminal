Fixtures for `src/test/invariants/fsDeletionGate.ts`. The filename is the assertion, so adding a
case needs no gate edit.

| Prefix | Must produce | Meaning |
|---|---|---|
| `flag-` | ≥1 finding | a spelling the tripwire catches; every one is a case that walked past an earlier version of the rule |
| `pass-` | no finding | valid code the rule must not reject — the false-positive direction, which has bitten twice (rounds 7 and 9) |
| `gap-` | no finding | a limit D10 states out loud. If one of these starts producing a finding the gate FAILS, so a closing gap gets recorded rather than absorbed |

`gap-` exists because D10 once claimed "no module reachable from the removal path" while enumerating
two directories, and that overclaim survived five review rounds — nothing checked it. A stated limit
nothing checks is not a limit.

Nothing imports these; they exist to be read by the type checker.
