# Phase status register

The single place that records where the seven-phase roadmap stands. Updated after each authorised phase (last update: 6 November 2026, Phase 1 follow-up). **Completing a phase does not authorise the next one: only your explicit approval does.**

| Phase | Status | Exit criteria | Tests / evidence | My approval |
|---|---|---|---|---|
| Phase 1: Staging readiness and deployment preparation | **Current: complete as documents and P1-03 fixed; waiting for your approval to close** (the P1-03 red alert is resolved: fixed, tested, CI green) | Documentation criteria PASS; everything about real platforms NOT TESTED (see [STAGING-READINESS-REPORT.md](STAGING-READINESS-REPORT.md) section 11) | Git, PR #1 and CI checked 6 Nov 2026; latest CI run 42178822719 on `81216aa`: five jobs green; locally on `81216aa`: 381/381 unit tests, smoke 97/97 (twice), authorization audit 0 violations, `npm audit` 0; preflight run against a staging-like environment; branch protection read from the public API (none) | **Pending** (documentation committed `a088815`, P1-03 committed `81216aa`; P1-01, P1-09 and the Phase 2 inputs await your decisions) |
| Phase 2: Staging deployment | Not started | Pending | None | Pending |
| Phase 3: Functional and integration testing | Not started | Pending | None | Pending |
| Phase 4: Security, reliability and performance | Not started | Pending | None | Pending |
| Phase 5: Product quality and AI experience | Not started | Pending | None | Pending |
| Phase 6: Production readiness | Not started | Pending | None | Pending |
| Phase 7: Production deployment | Not started | Pending | None | Pending |

## Approvals received and what they cover

| Date | Your instruction | Covers |
|---|---|---|
| 6 Nov 2026 | Master roadmap and "start with Phase 1 only" | Phase 1 inspection, documentation, planning. Not deployment |
| 6 Nov 2026 | Error-handling and recovery protocol | applies to all phases |
| 6 Nov 2026 | Phase 1 follow-up: Render + Vercel as the intended staging architecture; platform hostnames only; Supabase off; no Aiven mirror in initial staging; mail provider unset; separate provider keys, none created; backup plan, branch-protection inspection and fix proposals to be delivered; commit documentation only after your review | planning and inspection only |
| 6 Nov 2026 | Strict phase order and execution control | all phases |

| 6 Nov 2026 (later) | "Authorized work instructions": commit exactly the 14 reviewed documentation files; implement P1-03 (highest priority) with isolated-database tests; run the full verification; separate commits on `release-hardening`; no force-push, no merge, no deploy, no Phase 2, no P1-01 / P1-09 | done: documentation commit `a088815`; P1-03 implemented and verified locally (see the Phase 1 report). Phase 2 stays unauthorised |
| 6 Nov 2026 (later) | "If no error then automatically go for the next phase, but if any confirmation is needed then ask; if red alert, ask" | **Replaces the earlier "never advance automatically" wording** for phases that finish with no error and need no confirmation. It does **not** cover anything that needs a decision, an account, a purchase, a credential, a deployment, a merge, a settings change or a risky operation: each of those still stops and asks. Applying it: Phase 1 is *not* eligible to advance yet, because it still needs your confirmations (documentation review and commit, provider choice and caps, hosting purchases and accounts, backup route, the three fix decisions) |

Not approved (so not done): implementing P1-01 or P1-09; any provider key; any Render, Vercel or Aiven resource; any GitHub setting change; Phase 2.

## Queued items (recorded, not started, not part of Phase 1 review)

| Item | Classification | Status |
|---|---|---|
| Improvement backlog covering the ten product priorities, and their mapping onto the seven phases | Phase 1 deliverable of the second roadmap message, queued behind the current Phase 1 review | NOT STARTED (code searches for it were read-only) |
| Design-reference inventory (five images received 6 Nov 2026: a chat interface, a dashboard, a model-selection dialog, an agent workspace and a summary screenshot) and the UI/UX audit and direction | Queued; the transformation itself belongs to Phase 5 and needs your approval of a proposed direction | NOT STARTED; no design decision has been made |
| Priority mapping: security re-check of findings #55 to #62, AI engine, context management, agent safety, performance, monitoring, cost and privacy | Future-phase tasks (Phases 3 to 5); recorded here, untouched | NOT STARTED |

## Phase 1 follow-up checks (6 Nov 2026)

P1-03 compatibility review: all four residual limitations rated LOW and not needed before staging (details in docs/IMPROVEMENT-LOG.md, Task 12). Stale test counts and verification statements corrected across the documentation. Branch-protection proposal written, **not applied**: [BRANCH-PROTECTION-PROPOSAL.md](BRANCH-PROTECTION-PROPOSAL.md).

## Open items that block Phase 2 (see the Phase 1 report)

AI providers and their spending caps; approval of hosting purchases (Render plan and disk, Vercel plan: Hobby is non-commercial only); creation of the Render and Vercel accounts or projects; the backup route; decisions on P1-01, P1-03 and P1-09; whether to commit the documentation first.

## Phase 1 findings register (summary)

P1-01 MEDIUM OPEN (needs approval) · P1-02 FIXED, verification pending · **P1-03 HIGH (conditional) FIXED 6 Nov 2026 (approved), verified locally**: proven data loss in the legacy boot migrations (projects copy failure, and child rows deleted even on success) is closed by `server/db-migrations.ts`; P1-01 and P1-09 NOT approved, remain in the backlog · P1-04 LOW OPEN · P1-05 LOW OPEN · P1-06 MEDIUM accepted design limit · P1-07 MEDIUM OPEN (needs approval) · P1-08 LOW OPEN · P1-09 MEDIUM OPEN (needs approval) · P1-10 MEDIUM OPEN · P1-11 FIXED, verification pending. Details: [STAGING-READINESS-REPORT.md](STAGING-READINESS-REPORT.md) section 8. New since: **P1-12 LOW (OPEN)**: `main` has no branch protection and no required checks (see [STAGING-DECISION-BRIEF.md](STAGING-DECISION-BRIEF.md) section 3). **P1-13 LOW (OPEN)**: several unit tests import `server/db.ts` and other server modules with the default storage root, so running `npm test` writes into the repository-root `data/` folder (the local development data, git-ignored). Found during the 6 Nov 2026 final safety check: that database currently holds only seeded baseline rows (2 system users, the "global" project, no conversations, messages, models or sessions), integrity ok, and the P1-03 code stamped it `user_version = 1` without any rebuild or snapshot. Harmless here, but tests should use a temporary root so they can never touch a developer's real local data; not fixed (outside the authorised scope). No HIGH or CRITICAL issue is open.

## Recovery policy and checkpoints

Policy (6 Nov 2026): if anything goes wrong, stop the affected operation; preserve code, database state and logs; find the exact cause; check `git status`, recent commits and changed files; decide whether it is reversible; propose the safest recovery; run regression tests afterwards; report what remains unresolved. Never delete project data to make tests pass, reset or overwrite a database, force-push or rewrite history, hide failed tests, continue a deployment after a critical failure, or sacrifice working functionality for a new feature, without your explicit approval. Anything destructive or high-risk stops and asks first.

Recoverable checkpoints that exist now:

| Checkpoint | What it restores | Where |
|---|---|---|
| `release-hardening` at `9607514` | all code, tests, workflow and the ten commits of PR #1 (CI green) | local branch and `origin/release-hardening` |
| `main` at `46223be` | the pre-hardening product | local and `origin/main`, untouched |
| Phase 1 documentation checkpoint | the 14 uncommitted documentation files as of the Phase 1 follow-up (a tar copy) | session scratchpad, outside the repository (not a substitute for committing them) |
| Phase 1 documentation checkpoint v2 (after the P1-03 correction and the proposed diffs) | the same 14 files, updated | session scratchpad `phase1-docs-checkpoint-v2.tar` (size, SHA-256 and the comparison result are in the Phase 1 verification report; the register cannot hold its own archive's hash); the earlier `phase1-docs-checkpoint.tar` is kept |
| Early copy of the 224 changed files from the commit split | the pre-commit working tree of 5 Nov 2026 | session scratchpad, outside the repository |

No database or production data is involved yet. Before any phase that touches a database, a verified backup and a rehearsed restore are required first.
