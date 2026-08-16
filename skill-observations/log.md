# Skill Observation Log

Observations captured during task-oriented work. Each entry identifies a
potential skill improvement or new skill opportunity.

**Status key:** OPEN = not yet actioned | ACTIONED = skill updated/created |
DECLINED = user decided not to pursue

---

### Observation 1: Environment context block claimed "not a git repo" for a directory that was actually on a named branch with real commit history

**Status:** OPEN
**Date:** 2026-08-15
**Session context:** Executing a pre-written 17-item code-review fix checklist against `@poker-blackjack/game-engine` (three grouped commits: gitignore/lockfile, source doc/API changes, test additions). The task instructions explicitly required git operations (branch-aware commits, `git status --porcelain` checks).
**Skill:** All skills (cross-cutting) — most directly relevant to `superpowers:verification-before-completion` and any skill/workflow that starts from a harness-supplied environment summary.
**Type:** open-source
**Phase/Area:** Session-start / pre-flight verification, before trusting any tool-supplied environment metadata for a stateful operation.

**Issue:** The session's `<env>` block stated "Is directory a git repo: No" for the working directory. The task instructions, however, referenced a specific branch name and required multiple git commands (status, add, commit). Rather than trusting the env block or the task instructions blindly, I ran `git status` and `git branch -a` directly before doing anything else — which showed the directory was in fact a git repo, on the exact branch named in the task, with a full, coherent commit history matching the task's narrative. Had I trusted the stale `<env>` claim, I might have second-guessed or stalled on a well-specified, legitimate task; had I trusted the task's framing without checking, I'd have been right this time but only by luck. The env block is evidently a snapshot that can go stale relative to the actual filesystem/repo state by the time the agent acts on it.
**Suggested improvement:** For any skill or workflow step that is about to perform git operations (or other stateful operations) based on assumptions seeded by harness-provided context (`<env>`, system reminders, etc.), add an explicit first step: verify the specific claim with a direct, cheap tool call (`git status`, `git branch`, `ls`, etc.) before proceeding — rather than either (a) trusting the harness metadata as ground truth, or (b) trusting task instructions that presuppose that metadata is wrong. Treat harness-supplied environment summaries as a hint to be verified, not a fact to act on, specifically whenever the task's success depends on that fact being correct.
**Principle:** Tool-supplied "context" (environment blocks, cached state, prior summaries) can be stale or wrong by the time it's read, especially for anything filesystem/VCS-state-dependent that could have changed between when the block was generated and when the agent acts. When a task's correctness hinges on such a claim (especially before any destructive or commit-creating operation), a single cheap verification call is worth the token cost every time — this is a specific, high-value instance of the general "verify before acting" posture, worth calling out explicitly in any skill that assumes its starting context is accurate.
