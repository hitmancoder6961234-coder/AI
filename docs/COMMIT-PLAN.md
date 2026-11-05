# Commit plan (executed on 6 November 2026 as eight commits on `release-hardening`)

> **Status update.** After the approval this plan was executed as eight commits on `release-hardening`, in the order below; `main` was not touched and nothing was merged or deployed. `git log --oneline main..release-hardening` lists them. Because `server/server.ts`, `scripts/smoke.mjs`, `server/db.ts`, the route modules and several web pages mix changes from several groups, the files were split **hunk by hunk** (not by file). The commits were rebuilt in a throw-away worktree and each state was checked: type errors, architecture check, lint and unit tests per commit. Commit 1 still contains type errors that already exist in the base commit (their fixes use code introduced in commit 2, so they land there); commits 2-8 type-check clean. The text below is the plan as it was written before the commits; wording such as "nothing has been committed" refers to that moment.

Prepared 5 November 2026. **No commit, push or deployment has been made, and none will be without your explicit approval.** The repository has 3 commits (`46223be` is HEAD); the working tree holds **192 changed entries**: 83 modified, 1 deleted (`server/server-copilot-route.ts`, dead code, documented in IMPROVEMENT-LOG Task 5) and 108 untracked (new files and folders). A review of the whole tree found no stray, generated, backup, patch or debug files, nothing over 1 MB outside the vendored libraries and the lockfile, and no leftover mutation or experiment markers. No `.env`, key, certificate, database or backup file is among them (`.gitignore` covers `.env*`, `*.pem`, `*.key`, `data/`, `*.db`, `dist/`, `node_modules/`; a tree-wide scan for key, token and private-key patterns found only the fake fixtures that `tests/ci-and-lockfile.test.ts` and `.gitleaks.toml` explicitly allow). Git prints "LF will be replaced by CRLF" warnings on this Windows checkout; that is the line-ending setting, not a change in content.

## Before committing (run on the final tree)

1. `npm run verify` (lockfile, architecture, lint budget, typecheck, unit tests, build) and `node scripts/smoke.mjs`: both must be green. Last results are in [RELEASE-READINESS.md](RELEASE-READINESS.md).
2. `git status --short` shows no file you do not recognise; `git diff --stat` matches this plan.
3. `git log -1` is still `46223be` (nobody else committed in between).
4. **The branch already exists: `release-hardening`**, created from `main` at `46223be` with **zero commits** (all changes are still uncommitted in the working tree). `main` is untouched. **Pushing it and opening a pull request are separate decisions**, so that GitHub Actions runs for the first time on the branch before anything reaches `main`.

## Recommended: eight logical commits

`server/server.ts`, `scripts/smoke.mjs`, `package.json`, `web/js/app.js`, `web/js/data/nav.js`, `web/js/ui/sidebar.js`, `web/src/main.jsx` and the shared docs contain changes from several of these groups. Splitting them needs interactive staging (`git add -p <file>`), which was not possible in the environment this was prepared in. If you prefer not to do that, use **one commit** (alternative at the end); the grouping below is still the right order to review the diff in.

| # | Commit (suggested message) | Contents |
|---|---|---|
| 1 | `Tooling: CI, lint, typecheck, architecture and lockfile gates` | `.github/workflows/darkness-ai-ci.yml`, `.github/dependabot.yml`, `.gitleaks.toml`, `eslint.config.js`, `tsconfig.json`, `package.json` / `package-lock.json` (scripts and dev dependencies), `scripts/check-architecture.mjs`, `scripts/lockfile-platforms.mjs`, `tests/architecture.test.ts`, `tests/ci-and-lockfile.test.ts` |
| 2 | `Security foundation: CSP, CSRF, sessions, login guard, redaction, provider-key vault, request-size limits` | `server/security/*` (csp, csrf, login-guard, redact, secret-store, vault, privacy, user-data, aiven), `server/body-limits.ts` + `tests/body-limits.test.ts`, `server/observability/*`, `server/provider-http.ts`, `server/upload-*.ts`, `server/account/*`, `scripts/sync-vercel-csp.mjs`, `vercel.json`, the matching `tests/*` (csp, csrf, login-guard, observability, db-logging, secret-store, provider-reliability, upload-*, zip-*), `web/css/auth-gate.css`, `web/js/ui/auth-gate.js` |
| 3 | `Authorization fixes and the authorization audit: ownership checks, operator-only settings, one row per provider key` | `server/ownership.ts`, `tests/ownership.test.ts`, `tests/agent-runtime-authz.test.ts`, `scripts/authz-audit.mjs`, `scripts/route-dump-hook.mjs`, `docs/AUTHORIZATION-AUDIT.md`, the `/api/storage/*` operator-only change and the model-save / purge change (`server/server.ts`, `server/db.ts`), the ownership changes in `server/server.ts`, `server/project-routes.ts`, `server/rag-routes.ts`, `server/agent-runtime.ts`, `server/artifact-access.ts`, `server/conversation-routes.ts`, and the cross-user smoke checks. Keep this commit on its own so the security fixes (SECURITY.md #40-#58) are easy to find and cherry-pick |
| 4 | `Product: history, branching, comparison, dashboards, usage and system pages` | `server/conversation-library.ts`, `server/compare-routes.ts`, `server/model-compare.ts`, `server/insights*.ts`, `web/js/pages/{account,agents,compare,history,system,usage}.js`, `web/js/lib/*`, `web/css/{insights,manage}.css`, tests |
| 5 | `Memory, Prompt Studio and durable agent sessions with approvals` | `server/memory*.ts`, `server/prompts*.ts`, `server/agent/*` (policy, sessions, session-routes, core, tools), `web/js/pages/{memory,prompts}.js`, `web/public/agent*`, tests |
| 6 | `Account recovery, mail provider and operator tooling` | `server/recovery*.ts`, `server/mailer.ts`, `scripts/admin.mjs`, `web/public/reset*`, `tests/recovery.test.ts`, the sign-in link, `Dockerfile` (admin script) |
| 7 | `Operations: backup and restore hardening, preflight, deployment configuration` | `scripts/backup.mjs`, `scripts/preflight.mjs`, `tests/backup.test.ts`, `tests/preflight.test.ts`, `tests/deploy-config.test.ts`, `render.yaml`, `Dockerfile`, `deploy/server/Caddyfile.example`, `.env.example` |
| 8 | `Documentation: status, security, deployment, operations, environment inventory` | `README.md`, `SECURITY.md`, `DEPLOY.md`, `docs/*` (this folder), `PRIVACY.md` if touched |

Everything else in the tree (pages, styles and engines that were only edited for the fixes above, e.g. `web/js/pages/project.js`, `web/js/ui/chat.js`, `server/file-generator.ts`) belongs with the commit of the change that touched it; `git diff --stat <file>` and the IMPROVEMENT-LOG "Files" lists say which.

## Alternative: one commit

```
git add -A
git commit -m "Darkness AI: security hardening, ownership fixes, memory, prompt studio, agent approvals, account recovery, operations tooling and documentation"
```

Honest and simple, at the cost of a diff that is hard to review (about 11,000 added and 6,700 removed lines in tracked files, plus the new files). If you choose this, still review in the order above.

## Never include

`.env` or any secret, `data/`, `*.db`, backup folders, `dist/`, `node_modules/`, the throw-away folders the test scripts create in the system temp folder (they are outside the repository). Do not commit `docs/` screenshots or scratch scripts; none are in the tree.

## After committing (only when you decide to)

- Push to a branch and open a pull request so the GitHub Actions workflow runs for the first time (it has **never** run on GitHub: Windows and macOS jobs, the secret scan and the audit job are unverified).
- Deploy to **staging first** and work through [OPERATIONS-VERIFICATION.md](OPERATIONS-VERIFICATION.md); production only after those boxes are ticked.
