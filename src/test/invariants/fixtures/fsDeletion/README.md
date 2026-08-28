Fixtures for `src/test/invariants/fsDeletionGate.ts`.

`flag-*.ts` must produce at least one finding and `pass-*.ts` must produce none. Every case here is
a spelling that walked past a previous hand-written version of the rule, or a harmless identifier a
previous version wrongly fired on. Adding a case needs no gate edit — the filename is the assertion.

Nothing imports these; they exist to be read by the type checker.
