# Staging decision brief (Phase 1)

Prepared 6 November 2026 after your decisions: **Render + Vercel**, platform hostnames only, Supabase off, no Aiven mirror at first, mail provider unset. **Nothing has been created, purchased, activated or deployed.** Prices and limits below come from vendor documentation and third-party summaries found on 6 November 2026 and **must be re-checked on the vendors' own pages** before you act; where sources disagree it is said so.

## 1. AI providers

**Providers the application supports (verified in `server/agent/providers.ts` and the environment inventory):** Google Gemini (native API, also used for illustrations), Anthropic (native `/messages` API), OpenAI, OpenRouter, Groq, Together, Mistral (all OpenAI-compatible), and **any other OpenAI-compatible base URL** (`OPENAI_BASE_URL` / `AGENT_BASE_URL`, or a model a user adds with their own key). Users can also add their own models and keys inside the app.

**What a meaningful staging test needs.** The application has three distinct request formats; each should be exercised once:

| Need | Smallest choice | Why |
|---|---|---|
| Gemini native path (default model, streaming format, illustrations) | one Gemini key | the only provider with its own request / stream format besides Anthropic; also the default model |
| OpenAI-compatible path (covers OpenAI, OpenRouter, Groq, Together, Mistral, custom URLs) | **one** of them; OpenRouter gives many models behind one key and a per-key credit cap | one key reaches several models, which also lets **Compare** and **model switching** be tested |
| Anthropic native path | one Anthropic key (optional but needed to claim Anthropic works) | different protocol, different error shapes |

Minimum for Phases 2 and 3: **one Gemini key plus one OpenRouter key** (two providers, two formats, three or more models). Add Anthropic only if you want it listed as supported. Anything not tested should stay out of any "supported" claim (OPERATIONS-VERIFICATION 3.1). Mistral, Groq and Together limits were not researched.

**Rough cost of the planned testing (an estimate, not a quote).** Assumptions: Phase 2 to 4 together send a few hundred short requests plus a few load bursts, about 1 to 2 million tokens in total. At the Claude Haiku 4.5 rate reported by third-party sites ($1 per million input tokens and $5 per million output tokens; Anthropic's own page was not confirmed and a newer model line may exist) that is on the order of **a few dollars**; small OpenAI- or Gemini-class models and OpenRouter's `:free` models cost less or nothing. Load tests are the one place cost could grow, so they will use a stand-in or tiny prompts and a hard cap.

**Spending-limit controls (what each vendor offers, per search results; test each before relying on it):**

| Provider | Control | Caveat |
|---|---|---|
| Google Gemini | monthly spend caps per project in Google AI Studio (reported effective April 2026; usage pauses at the cap; alerts at 50/80/100%) | secondary sources only for details; free-tier data may be used by Google to improve models, paid usage is not (third-party summary of the terms): use only synthetic prompts on a free key |
| OpenAI | monthly spend limits per organisation and per project with an optional **hard limit** (HTTP 429 `project_spend_limit_exceeded`) | an older community thread said project limits were notification-only and a third-party post conflicts with the docs: **test a hard limit on a throw-away project** |
| Anthropic | monthly spend limit per organisation and lower limits per workspace | a new workspace may inherit the organisation limit: set it deliberately |
| OpenRouter | optional **per-key credit limit** with scheduled reset; `GET /api/v1/key` reports what remains | free (`:free`) models have their own daily request caps and need a non-negative balance |

You decide which providers to authorise; keys are not created or requested by me. The staging configuration already accepts separate keys: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `TOGETHER_API_KEY`, `MISTRAL_API_KEY`, each set only in the staging service's secret store, never reused from production.

## 2. Mail

`MAIL_PROVIDER`, `MAIL_FROM`, `PUBLIC_APP_URL` and the `SMTP_*` / `RESEND_API_KEY` variables stay **unset** in initial staging. "Forgot password?" then answers `501 RECOVERY_NOT_CONFIGURED`, and the operator CLI (`node scripts/admin.mjs`, run in the Render shell) handles recovery.

**Testable without a mail provider:** the operator CLI's one-time reset link (`reset-link <email> --url <staging URL>`): valid once, 30-minute expiry, sets the new password, signs the account out everywhere, clears the lockout; weak or malformed passwords refused without spending the token; `revoke-sessions`, `disable` / `enable`; the 501 answer and the page's honest message; `reset.html` layout and behaviour opened from an operator link.

**Cannot be completed without a real mail provider (stays NOT TESTED / BLOCKED):** actual delivery and spam placement; SPF, DKIM and DMARC results; the "your password was changed" notice mail; that mail goes only to the real account and none is sent for an unknown address (the "identical answer for known and unknown addresses" property is only reachable once mail is configured); the `reset_mail_failed` log path with a wrong credential; the per-address limit of 3 requests per hour on the mail path; the link built from `PUBLIC_APP_URL` as it arrives in a real mailbox; behaviour of the SMTP and Resend clients against a real server (only fake servers were used).

## 3. GitHub branch protection for `main` (inspection only, public API, 6 Nov 2026)

I did not use the stored git credential for this. From the public API:

| Question | Result |
|---|---|
| Is branch protection enabled on `main`? | **No.** `GET /branches/main`: `protected: false`, `protection.enabled: false`, `required_status_checks.enforcement_level: off` |
| Which checks are required? | **None** (`contexts: []`, `checks: []`) |
| Repository rulesets applying to `main`? | **None** (`GET /rules/branches/main` returned an empty list) |
| Do the CI job names match required checks? | Nothing to match yet. The workflow's checks are named: `lint, types, tests, build, smoke (Node 22)`, `lint, types, tests, build, smoke (Node 24)`, `build and tests on windows-latest`, `build and tests on macos-latest`, and `dependency audit and secret scan`. A required-check setting must use exactly these names (the matrix jobs include the Node version / OS in the name) |
| Are direct pushes to `main` restricted? | **No.** Anyone with write access (at least the owner) can push straight to `main`, including force-pushes and deletion, because no protection exists. Details that need repository-admin access (admin enforcement, the "require pull request" settings, bypass lists) could not be read without credentials |

**Recommended protections (not applied; changing GitHub settings needs your approval):** protect `main`; require a pull request with at least one approving review (note: with a single maintainer you cannot approve your own PR, so decide whether to require it or allow admin bypass); require the five checks above and "branches must be up to date"; block force-pushes and deletion; include administrators; keep Dependabot and secret-scanning alerts enabled. Required-check names must be set after confirming the exact strings in a recent run.

## 4. Decisions still open

1. Which AI providers to authorise and the spending cap for each.
2. Whether to approve the proposed code fixes (see [PROPOSED-FIXES-P1.md](PROPOSED-FIXES-P1.md)), individually.
3. The backup route (see [STAGING-BACKUP-RESTORE-PLAN.md](STAGING-BACKUP-RESTORE-PLAN.md)): manual first, then scheduler and off-site storage, and which storage provider.
4. Whether to commit the Phase 1 documentation (list and diff summary are in the report).
5. Whether branch protection should be enabled before Phase 6.
6. Vercel's documentation says the free Hobby plan is for **non-commercial personal use only**; if Darkness AI is or will be a commercial product, a Pro plan is required (a purchase, so not done and not assumed). Render's Starter plan and disk are also paid.
7. Whether an old production database exists that the new version would upgrade in place (it decides how urgent P1-03 is: proven to lose projects in an older-shaped database, so such a database must be backed up first and must not be started with this build until P1-03 is fixed).

## Sources

Gemini billing and spend caps: https://ai.google.dev/gemini-api/docs/billing , https://blog.google/innovation-and-ai/technology/developers-tools/more-control-over-gemini-api-costs/ . OpenAI spend limits: https://developers.openai.com/api/docs/guides/spend-limits . Anthropic limits: https://platform.claude.com/docs/en/manage-claude/spend-limits-api , https://docs.claude.com/en/api/rate-limits . OpenRouter limits: https://openrouter.ai/docs/api/reference/limits . Vercel Hobby (non-commercial use only) and function limits: https://vercel.com/docs/plans/hobby , https://vercel.com/docs/functions/limitations . GitHub branch-protection state: public REST API for `hitmancoder6961234-coder/AI`.
