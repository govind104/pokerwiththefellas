# Documentation index

Where to start: the [project README](../README.md) for what the app is and how to run
it, then [HANDOFF.md](../HANDOFF.md) for where things stand and how they got there.

## Living docs (kept in step with the code)

| Doc | What it covers |
|---|---|
| [README.md](../README.md) | Features, tech stack, local development, tests, project layout |
| [HANDOFF.md](../HANDOFF.md) | Current state, full development history, how to run things, how work is done |
| [docs/HOSTING.md](HOSTING.md) | Running a real session with friends over Tailscale (`npm run play`) |
| [packages/server/.env.example](../packages/server/.env.example) | Every environment variable the server reads |
| [packages/frontend/THIRD_PARTY_NOTICES.md](../packages/frontend/THIRD_PARTY_NOTICES.md) | Vendored card art, Three.js, and what the 3D tables generate themselves |
| [superpowers/playtests/](superpowers/playtests/) | Findings from playtests (currently the AI playtest of the 3D tables) |
| [superpowers/specs/](superpowers/specs/) | The design spec behind each feature area. Written before the work; where a statement has since become false it carries a dated *Updated* or *Superseded* note in place, with the original text kept |
| docs/README.md | This index |

If a living doc and the code disagree, the code is right and the doc is a bug.

## Historical records (not updated)

These record how the work was planned and reviewed at the time. They are not rewritten
when the code changes, so they describe the code as it was then. A few carry a one-line
italic banner where the design they describe has since changed in a way that could
mislead.

- [superpowers/plans/](superpowers/plans/) — the implementation plans, one per spec.
- Plan 3's review trail in the same directory: `*-progress-ledger.md`, `*-STATUS.md`,
  `*-final-review.md`, `*-fix-spec.md`, `*-carried-forward-findings.md`; Plan 4's
  `2026-08-21-plan4-progress-ledger.md`.
- `plans/2026-09-29-3d-blackjack.md` is the exception that is part plan, part outcome: its
  "Deviations" section records what actually shipped.

Later work kept its per-task ledgers as git-ignored scratch; that detail lives in the
commit messages instead (HANDOFF.md, "How this was built", gives the `git log` ranges).
