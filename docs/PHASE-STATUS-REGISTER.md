# Phase status register

The single place that records where the seven-phase roadmap stands. Updated after each authorised phase (last update: 6 November 2026, Phase 2 preparation notes; Phase 1 stays CLOSED). **Completing a phase does not authorise the next one: only your explicit approval does.**

| Phase | Status | Exit criteria | Tests / evidence | My approval |
|---|---|---|---|---|
| Phase 1: Staging readiness and deployment preparation | **CLOSED on 6 November 2026** (closure approved by you the same day; closing it does not authorise Phase 2) | All Phase 1 documentation criteria PASS; P1-03 fixed and tested; everything about real platforms NOT TESTED (kept so: see "Phase 1 closure" below and [STAGING-READINESS-REPORT.md](STAGING-READINESS-REPORT.md) section 11) | CI run 42183723118 on `376dc00` and run 42178822719 on `81216aa`, five jobs green each time; locally: 381/381 unit tests, smoke 97/97, authorization audit 151 routes / 145 attacked / 0 violations, `npm audit` 0, lint 0 errors at the 1,033-warning budget, 93 modules with 0 import cycles; preflight run against a staging-like environment; branch protection read from the public API (none) | **Approved 6 Nov 2026** (Phase 1 closure only) |
| Phase 2: Staging deployment | **Not started** (preparation only: the staging-readiness decision report was delivered and preliminary decisions are recorded below; **nothing is authorised**) | Pending | None | Pending |
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
| 6 Nov 2026 (later) | "Authorized work instructions": commit exactly the 14 reviewed documentation files; implement P1-03 (highest priority) with isolated-database tests; run the full verification; separate commits on `release-hardening`; no force-push, no merge, no deploy, no Phase 2, no P1-01 / P1-09 | done: documentation commit `a088815`; P1-03 implemented and verified locally and in CI (`81216aa`). Phase 2 stays unauthorised |
| 6 Nov 2026 (later) | "If no error then automatically go for the next phase, but if any confirmation is needed then ask; if red alert, ask" | **Replaces the earlier "never advance automatically" wording** for phases that finish with no error and need no confirmation. It does **not** cover anything that needs a decision, an account, a purchase, a credential, a deployment, a merge, a settings change or a risky operation: each of those still stops and asks. Applying it to the end of Phase 1: it is **not** eligible to advance automatically, because Phase 2 needs your confirmations (provider choice and caps, hosting accounts and purchases, backup route, the open fix decisions) |
| 6 Nov 2026 (Phase 2 preparation) | Reviewed the staging-readiness decision report; **preliminary decisions** recorded in "Phase 2 preparation" below; record finding P2-01 and its mitigation as documentation only; no source, test, workflow, environment, database or GitHub change; no account, purchase, infrastructure or deployment; Phase 2 not authorised | done by the documentation-only commit that adds this section. **Does not authorise Phase 2** |
| 6 Nov 2026 (final) | "Approve closing Phase 1" after the final verification report; limited actions: record the closure, keep P1-13 open and the compatibility limitations, documentation-only commit and push to `release-hardening`; no code, test, workflow, environment, database or infrastructure change; no branch protection, no P1-01 / P1-09, no merge, no deploy, no purchase, no Phase 2 | done by the closure commit. **Does not authorise Phase 2** |

Not approved (so not done): implementing P1-01 or P1-09; any provider key; any Render, Vercel or Aiven resource; any GitHub setting change (including branch protection); merging PR #1; any purchase; any deployment; Phase 2.

## Queued items (recorded, not started, not part of Phase 1 review)

| Item | Classification | Status |
|---|---|---|
| Improvement backlog covering the ten product priorities, and their mapping onto the seven phases | Phase 1 deliverable of the second roadmap message, queued behind the current Phase 1 review | NOT STARTED (code searches for it were read-only) |
| Design-reference inventory (five images received 6 Nov 2026: a chat interface, a dashboard, a model-selection dialog, an agent workspace and a summary screenshot) and the UI/UX audit and direction | Queued; the transformation itself belongs to Phase 5 and needs your approval of a proposed direction | NOT STARTED; no design decision has been made |
| Priority mapping: security re-check of findings #55 to #62, AI engine, context management, agent safety, performance, monitoring, cost and privacy | Future-phase tasks (Phases 3 to 5); recorded here, untouched | NOT STARTED |

## Phase 1 closure (6 November 2026)

Phase 1 is **CLOSED**. The distinction below is deliberate and must not be blurred when later phases are reported.

**1. Completed, and tested locally and in CI** (local Windows, Node 22; GitHub Actions on Linux Node 22 and 24, Windows and macOS)
- The P1-03 migration fix (`server/db-migrations.ts`, `initDatabaseSchema`): 18 tests on isolated temporary databases, mutation-checked; full suite 381/381; smoke 97/97; authorization audit 0 violations; CI five jobs green (runs 42178822719 and 42183723118). Closes SECURITY.md #63 and #64.
- The CI fixes of `0babe13` (three fake keys allow-listed as exact strings) and `9607514` (project processes get their own process group on Unix).
- The documentation corrections (stale CI statements, test counts, four missing environment variables) and the Phase 1 document set, committed as `a088815` and `376dc00`.
- Read-only inspections: branch protection (none), the environment audit, the compatibility probes of P1-03.

**2. Documented, NOT tested on any real platform** (every item stays NOT TESTED until Phase 2 or later)
- The staging architecture, deployment plan, rollback plan, backup and restore plan, verification checklist and environment inventory are plans only. Nothing was deployed, no account or resource exists, no provider key or mail provider was configured.
- Real-platform behaviour: Render (disk, rollback, health checks), Vercel (headers, proxy, request limits), Docker, Aiven, TLS and cookies on a real domain, real model providers and their spending caps, real mail delivery, backup and restore on a real disk, load and concurrency.
- The branch-protection proposal ([BRANCH-PROTECTION-PROPOSAL.md](BRANCH-PROTECTION-PROPOSAL.md)) is written and **not applied**; `main` is still unprotected.

**3. Outstanding decisions that belong to Phase 2 (none is made; Phase 2 is not authorised)**
AI providers and their spending caps; Render and Vercel accounts or projects and approval of the paid plans (Vercel Hobby is non-commercial only); the backup route (manual first, then the P1-09 scheduler and an off-site store, and which store); P1-01 (start-up configuration check) and P1-09 (backup scheduler and monitoring), both **not approved** and kept in the backlog; whether and when to apply branch protection; whether an older production database exists that would be upgraded in place; when to start the queued improvement backlog and design-reference inventory.

**Carried forward from Phase 1 (not fixed, by decision)**
- **P1-13 (LOW, OPEN):** unit tests use the default storage root and so write into the repository-root `data/` folder. Recorded for future remediation; **not to be fixed now**.
- **P1-03 compatibility limitations, all LOW and unchanged:** legacy UNIQUE / CHECK constraints that exist only as automatic indexes are not carried over by a rebuild; a failed second stage is retried on the next start rather than rolled back (verified safe); the oldest commit (`8c38256`) could not be generated in the test harness; shapes from before `user_id` existed are not in the git history and are known only from the migration's own column lists; foreign-key dependents beyond two `projects` children and `messages` were not each tested; a very large database and the external `DARKNESS_DB_PATH` case were not tested. **Recommendation kept: back up any database older than the repository history first and open a copy of it on a scratch root before any real use.**
- Other open Phase 1 findings stay open as listed below (P1-01, P1-04 to P1-10, P1-12).

## Phase 2 preparation (6 November 2026; Phase 2 is NOT started and NOT authorised)

**Preliminary decisions** (yours, recorded as stated; none is a purchase or an instruction to build anything)

| Topic | Decision |
|---|---|
| Hosting direction | Render Starter with a persistent disk, and a Vercel front end |
| Database | A fresh SQLite database for staging; production or personal data is never copied |
| AI provider keys | **No server-level provider keys initially**; testers may use their own keys |
| Mail | Remains disabled |
| Aiven and Supabase | Not required for the initial staging |
| Backups | Manual, including one before every deployment |
| P1-01 (start-up configuration check) | Not approved |
| P1-09 (backup scheduler and monitoring) | Not approved yet |
| Branch protection on `main` | Not applied yet |
| Domain | Platform-provided hostnames |
| Test data | Synthetic data only |
| Deployment commit | `0d089e0`, **subject to final verification before deployment** (the later documentation-only commits that add these notes do not change code; the exact commit is re-confirmed at deploy time) |

**Still undecided** (from the decision report): Vercel Hobby (free, non-commercial use only) versus Pro; the Render region; who creates and operates the Render and Vercel accounts; the disk size (2 to 5 GB); which providers and spending caps the testers' own keys should have (testers bring their own); whether an older production database exists that would be upgraded in place; the backup store for an off-site copy; when branch protection is applied.

**Phase 2 preparation finding (a Phase 2 item: Phase 1 is not reopened)**

| ID | Severity | Status |
|---|---|---|
| **P2-01** | **MEDIUM (cost / abuse exposure)** | **OPEN** until an actual mitigation is implemented and verified |

*Open sign-up combined with server-level provider keys.* Anyone who can reach a deployment can register: there is no switch that closes or restricts registration (a search of the code for invite-only, sign-up-disable or allow-list settings found none), and without a mail provider there is no e-mail verification. Several features use the **server's** provider keys for any signed-in user: image generation and illustrations use `GEMINI_API_KEY`; the Copilot "GPT" mode uses `OPENAI_API_KEY`; the agent uses the first provider that has a server key; and a Gemini model added without a key of its own falls back to the server key (`server/server.ts` ~l. 3501 and 3621, `server/image-service.ts`, `server/copilot/routes.ts`, `server/agent/providers.ts`). The only brake in the code is the per-address AI limiter (`RATE_LIMIT_AI_PER_MIN`, default 40 per minute) and the sign-up limiter (`RATE_LIMIT_AUTH_PER_15MIN`, default 20 per 15 minutes), both per address and per process, so rotating addresses defeats them. On a public staging URL that carries a server-level key, strangers could therefore register and spend that key. *Correction to the decision report:* it said the server key serves "every signed-in user" as the default model; the default Gemini model is registered for the baseline user, and which other paths hand it to a new account was not fully traced. The four paths above are what the code shows; each is to be confirmed by a two-account test in Phase 2.

*Recommended mitigation (accepted as the staging direction, not yet in effect):* **no server-level AI provider keys on staging initially**; testers add their own model and key inside the app (stored sealed per user), so the only key anyone can spend is their own. With no server key, the features above report "not configured" and spend nothing. Verification (Phase 2): preflight shows no server provider key; a freshly registered second user cannot obtain a working model, an illustration, a Copilot GPT answer or an agent run without their own key; provider dashboards show no usage. **No code change and no registration restriction is authorised**; closing or gating sign-up (an allow-list, an invite code, or per-user cost limits) would be a code change that needs its own approval, and until something is implemented **and verified** this finding stays OPEN.

## Phase 1 follow-up checks (6 Nov 2026)

P1-03 compatibility review: all four residual limitations rated LOW and not needed before staging (details in docs/IMPROVEMENT-LOG.md, Task 12). Stale test counts and verification statements corrected across the documentation. Branch-protection proposal written, **not applied**: [BRANCH-PROTECTION-PROPOSAL.md](BRANCH-PROTECTION-PROPOSAL.md).

## Open items that block Phase 2 (see "Phase 1 closure" above)

AI providers and their spending caps; approval of hosting purchases (Render plan and disk, Vercel plan: Hobby is non-commercial only); creation of the Render and Vercel accounts or projects; the backup route; the decisions on P1-01 and P1-09 (P1-03 is done and the documentation is committed). Phase 2 itself needs your separate explicit approval.

## Phase 1 findings register (summary)

P1-01 MEDIUM OPEN (needs approval) · P1-02 FIXED and committed (`a088815`) · **P1-03 HIGH (conditional) FIXED 6 Nov 2026 (approved), verified locally**: proven data loss in the legacy boot migrations (projects copy failure, and child rows deleted even on success) is closed by `server/db-migrations.ts`; P1-01 and P1-09 NOT approved, remain in the backlog · P1-04 LOW OPEN · P1-05 LOW OPEN · P1-06 MEDIUM accepted design limit · P1-07 MEDIUM OPEN (needs approval) · P1-08 LOW OPEN · P1-09 MEDIUM OPEN (needs approval) · P1-10 MEDIUM OPEN · P1-11 FIXED and committed (`a088815`). Details: [STAGING-READINESS-REPORT.md](STAGING-READINESS-REPORT.md) section 8. New since: **P1-12 LOW (OPEN)**: `main` has no branch protection and no required checks (see [STAGING-DECISION-BRIEF.md](STAGING-DECISION-BRIEF.md) section 3). **P1-13 LOW (OPEN)**: several unit tests import `server/db.ts` and other server modules with the default storage root, so running `npm test` writes into the repository-root `data/` folder (the local development data, git-ignored). Found during the 6 Nov 2026 final safety check: that database currently holds only seeded baseline rows (2 system users, the "global" project, no conversations, messages, models or sessions), integrity ok, and the P1-03 code stamped it `user_version = 1` without any rebuild or snapshot. Harmless here, but tests should use a temporary root so they can never touch a developer's real local data; not fixed (outside the authorised scope). No HIGH or CRITICAL issue is open.

## Recovery policy and checkpoints

Policy (6 Nov 2026): if anything goes wrong, stop the affected operation; preserve code, database state and logs; find the exact cause; check `git status`, recent commits and changed files; decide whether it is reversible; propose the safest recovery; run regression tests afterwards; report what remains unresolved. Never delete project data to make tests pass, reset or overwrite a database, force-push or rewrite history, hide failed tests, continue a deployment after a critical failure, or sacrifice working functionality for a new feature, without your explicit approval. Anything destructive or high-risk stops and asks first.

Recoverable checkpoints that exist now:

| Checkpoint | What it restores | Where |
|---|---|---|
| `release-hardening` at the Phase 1 closure commit (earlier tips `376dc00`, `81216aa`, `9607514` are ancestors) | all code, tests, workflow and the commits of PR #1 (CI green on `376dc00`) | local branch and `origin/release-hardening` |
| `main` at `46223be` | the pre-hardening product | local and `origin/main`, untouched |
| Phase 1 documentation checkpoint | the 14 documentation files as of the Phase 1 follow-up, before they were committed (a tar copy) | `Documents\DarknessAI-checkpoints\phase1-docs-checkpoint.tar` (266,240 bytes, SHA-256 `5a0e4532438806d3228f8d36112b378f1a07cd63af4a7251451e28fe1a154388`) and the session scratchpad copy |
| Phase 1 documentation checkpoint v2 (after the P1-03 correction and the proposed diffs) | the same 14 files, updated | `Documents\DarknessAI-checkpoints\phase1-docs-checkpoint-v2.tar` (276,480 bytes, SHA-256 `d5f4b72ca036fd1333af8ba9b76e4350c1c043d119f44007f81fed12756c1316`; the archives predate this register's current text, so the hash does not cover it) and the session scratchpad copy |
| Early copy of the 224 changed files from the commit split | the pre-commit working tree of 5 Nov 2026 | session scratchpad, outside the repository |

No database or production data is involved yet. Before any phase that touches a database, a verified backup and a rehearsed restore are required first.
