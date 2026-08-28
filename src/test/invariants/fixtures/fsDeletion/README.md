Fixtures for `src/test/invariants/fsDeletionGate.ts`. The filename is the assertion.

| Prefix | Must produce | Meaning |
|---|---|---|
| `flag-` | ≥1 finding | a spelling the tripwire catches; every one is a case that walked past an earlier version of the rule |
| `pass-` | no finding | valid code the rule must not reject — the false-positive direction, which has bitten three times (rounds 7, 9 and 10) |
| `gap-` | no finding | a limit D10 states out loud. If one starts producing a finding the gate FAILS, so a closing gap gets recorded rather than absorbed |
| `helper-` | nothing | not a fixture; supporting code a `gap-` case needs to live outside its own file |

Adding a `flag-` or `pass-` case needs no gate edit. A `gap-` case does: the four are named in
`EXPECTED_GAPS`, and the gate fails when a declared one goes missing OR an undeclared one appears.
Counting whatever happened to be present let a stated limit disappear in silence, and checking only
that the declared four exist let the count grow without D10 being amended (round-10 and -11 W12).

`gap-` exists because D10 once claimed "no module reachable from the removal path" while enumerating
two directories, and that overclaim survived five review rounds — nothing checked it. A stated limit
nothing checks is not a limit.

Each `gap-` case must isolate ONE cause. `gap-call-produced.ts` was defeated by structural erasure
before the unscanned call ever mattered, so it proved the wrong limit until its helper was annotated
`typeof fs.promises.rm`; `gap-structural-parameter.ts` demonstrated an ordinary local interface until
a caller passed the real `fs` through it (round-10 W10, W11).

Nothing imports these; they exist to be read by the type checker.
