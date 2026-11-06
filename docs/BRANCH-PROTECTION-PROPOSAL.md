# Proposed protection for `main` (a proposal: nothing has been applied)

Prepared 6 November 2026. **No GitHub setting was changed.** Applying any of this needs your approval and a GitHub account with admin rights on the repository (`hitmancoder6961234-coder/AI`). The current state, read from the public API on 6 Nov 2026: `main` is **not protected**, no required checks, no rulesets, so anyone with write access can push, force-push or delete it. See [STAGING-DECISION-BRIEF.md](STAGING-DECISION-BRIEF.md) section 3.

## 1. What the CI offers to require

The workflow `.github/workflows/darkness-ai-ci.yml` runs on every pull request (no path filter), on pushes to `main` (except documentation-only paths) and by hand. These are the exact check names, taken from the successful runs 42118240655 and 42178822719:

| Required check (exact name) | What it runs |
|---|---|
| `lint, types, tests, build, smoke (Node 22)` | lockfile check, architecture check, lint budget, typecheck, 381 unit tests, production build, 97 smoke checks, authorization audit |
| `lint, types, tests, build, smoke (Node 24)` | the same on Node 24 |
| `build and tests on windows-latest` | `npm ci`, lockfile check, build, unit tests, smoke |
| `build and tests on macos-latest` | the same on macOS |
| `dependency audit and secret scan` | `npm audit` (production and high), signature check, gitleaks |

A required check must be selected by this exact name (the matrix jobs carry the Node version or the OS in the name). If the matrix changes, the required list must change with it, or merges block.

## 2. Recommended configuration (a ruleset, or the equivalent classic branch protection)

| Setting | Recommendation | Reason |
|---|---|---|
| Target | branch `main` only | `release-hardening` stays free for the working flow |
| Require a pull request before merging | **Yes** | forces CI and a reviewable diff for every change to `main` |
| Required approving reviews | **0 for now**, 1 as soon as a second reviewer exists | you cannot approve your own pull request, so "1 approval" would make the maintainer unable to merge PR #1 without a bypass |
| Dismiss stale approvals on new commits | Yes (matters once approvals are required) | |
| Require conversation resolution | Yes | |
| Require status checks to pass | **Yes: the five checks above** | CI becomes a gate instead of an advisory |
| Require branches to be up to date before merging | **Yes** | what is merged is what CI tested |
| Block force pushes | **Yes** | prevents rewriting history on `main` |
| Restrict deletions | **Yes** | prevents deleting `main` |
| Require linear history | Optional (your merge-strategy choice for PR #1; Phase 6 proposes one) | |
| Require signed commits | **No, not now** | the existing commits are not signed; enabling it would block every merge |
| Include administrators / bypass | see section 3 | |

Related repository settings worth enabling (all are settings changes, so also need approval): Dependabot security updates, secret-scanning push protection, and a CODEOWNERS file once there is more than one maintainer.

## 3. Admin bypass for a single maintainer

| Option | Effect | Assessment |
|---|---|---|
| **A. No bypass, 0 required approvals** (recommended) | every change, including yours, needs a pull request and green checks; no review deadlock; you can still merge PR #1 after CI and your approval | strongest protection that works with one person. The cost: an emergency fix also needs a pull request (acceptable, CI takes about two minutes) |
| B. Bypass for admins, "pull requests only" mode | you may merge a pull request without waiting for checks, but still cannot push straight to `main` | convenient and weaker: the checks become advisory for you. Use only if a required check turns out to be unreliable |
| C. Bypass "always" for admins | you can push directly and skip checks | gives up most of the protection; not recommended |
| D. Require 1 approval and add a second person or account as reviewer | real four-eyes review | best long-term, needs another human (or a second account that is a real, separate reviewer) |

Recommendation: **A now, D when a second reviewer exists.** Do not use option B or C by default.

## 4. Interaction with the rest of the plan

- **PR #1** currently has all five checks green and would satisfy A. With A in force, merging it in Phase 7 is still your decision and needs your separate approval; the rules do not merge anything.
- **Render auto-deploy.** If a Render service is later pointed at `main` with auto-deploy, protection means only code that passed the five checks can reach it. Render's "deploy only after CI passes" option was not verified here.
- **Flaky checks.** Required checks make a flaky test a blocker. The one flake found so far (a run-engine test hanging on Linux) was fixed in `9607514`; the smoke body-limit race was fixed earlier. If a required check proves unreliable, fix the test, not the rule.
- **Concurrency.** The workflow cancels an older run when a newer commit is pushed to the same branch; the newer run is the one that counts.

## 5. How it would be applied and verified (only after your approval)

1. Create a repository ruleset named `protect-main` for `refs/heads/main` in Settings, Rules, Rulesets, or through the REST API, with the rules above. An illustrative payload (check it against GitHub's current API documentation before use; it was not run):

```json
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": { "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": true, "require_code_owner_review": false, "require_last_push_approval": false, "required_review_thread_resolution": true } },
    { "type": "required_status_checks", "parameters": { "strict_required_status_checks_policy": true, "required_status_checks": [
      { "context": "lint, types, tests, build, smoke (Node 22)" },
      { "context": "lint, types, tests, build, smoke (Node 24)" },
      { "context": "build and tests on windows-latest" },
      { "context": "build and tests on macos-latest" },
      { "context": "dependency audit and secret scan" } ] } }
  ]
}
```

2. Verify with a throw-away branch, never with `main` itself: a direct push to `main` is rejected; a force-push is rejected; a pull request with a failing check cannot be merged; a pull request whose checks pass can.
3. Re-read the state from the public API (`GET /branches/main` shows `protected: true` and the required contexts) and record it in the status register.
4. Roll back by disabling or deleting the ruleset (Settings, Rules). Nothing in the repository content changes.

## 6. Risks of applying it

A wrong check name blocks every merge until corrected; the matrix names above must stay in step with the workflow. A ruleset needs admin rights and, on some plans, features that were not confirmed for this repository (it is public, which normally includes rulesets). The maintainer loses the ability to push directly to `main`, which is the point.
