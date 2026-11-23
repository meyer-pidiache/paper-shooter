# Contributing

## Setup

Use Node 22.23.1 (`.nvmrc`), pnpm 12.18.0 (`packageManager`) and Git. Docker Compose is optional.
Python and copied library distributions are no longer required.

```bash
git clone https://github.com/meyer-pidiache/paper-shooter.git
cd paper-shooter
corepack enable
pnpm install --frozen-lockfile
git config core.hooksPath .githooks
git config pull.rebase true
pnpm check
pnpm dev
```

Open `http://127.0.0.1:5173`. See [development](docs/development.md) for commands, browser setup,
container development and dependency/license updates. Read [architecture](docs/architecture.md)
before moving responsibilities across modules and record technical changes in an ADR.
Follow the [engineering standard](docs/engineering-standard.md) for module/function size,
complexity, ownership and narrow contracts. Run `pnpm review:structure` when changing boundaries;
its reports are advisory and still require architectural review and justified exceptions.

Never commit `.env`, provider API tokens, signing secrets or permanent TURN credentials. Only public
frontend configuration receives the `VITE_` prefix. The optional server reads private values at
runtime. [Networking](docs/networking.md) explains signaling, direct connections and relay adapters.

## Issues

Use a short title that describes the problem or outcome, such as “Public lobbies disappear after
refresh.” The bug and feature forms add `bug` or `enhancement`. Use a blank issue for other work and
apply a relevant label such as `documentation`.

During triage, use `priority: high` for a regression or major blocker in a core flow and
`priority: low` for minor fixes or polish. Issues without a priority label have normal priority.
Use `status: in progress` while work is active and `status: blocked` when a dependency or decision
prevents progress. Apply at most one priority and one status label. Use the issue's open or closed
state and the linked PR to track closure and review.

## Trunk and rebase workflow

`main` is the deployable trunk. Use short-lived branches and focused Conventional Commits. Large
migrations can use an explicitly agreed integration branch with independently reviewable commits;
this architectural refactor uses that exception at the maintainer's request.

Use the same type prefixes as [commit subjects](#commits-and-hooks). Use
`<type>/<issue-number>` for one issue and join multiple issue numbers with hyphens. Use a short
slug when there is no issue. Examples include `fix/36`, `feat/21-33-39`, and `docs/update-controls`.

```bash
git switch main
git pull --ff-only origin main
git switch -c fix/36
```

Before updating the pull request:

```bash
git fetch origin
git rebase origin/main
pnpm check
pnpm format:check
```

If a published feature branch was rebased, update it with `git push --force-with-lease`. Never
force-push `main`. Open a pull request against `main` and use GitHub's **Rebase and merge** to keep
history linear. Preserve original authorship when porting upstream work; do not push to upstream.

In the PR description, list issues under **Related issues**. Give each issue its own line and use
`Closes #123` for work the merge completes or `Related to #123` for context or partial work.

## Commits and hooks

Use `feat`, `fix`, `docs`, `chore`, `ci`, `refactor`, `style`, `test`, `build`, `perf` or `revert`, with
an optional scope and an imperative summary. Explain non-obvious decisions in the commit body.

```text
refactor(maps): extract the shared construction kit
fix(net): reject forged host-control messages
test(player): preserve the recorded movement trace
```

The enabled hooks check staged whitespace and Conventional Commit subjects and run `pnpm check`
before commits/pushes. CI retains the existing Conventional Commit PR-title check and runs type,
import-boundary, lint, formatting, unit/integration, build, Chromium and container checks. The
SonarCloud workflow generates LCOV before scanning; same-repository PRs require the configured
`SONAR_TOKEN` repository secret. External fork PRs skip that secret-bearing analysis.

See [security scanning](docs/security-scanning.md) for workflow details and limitations.

Protect `main` with pull requests, linear history and required checks. Repository protection rules
are GitHub settings; committing workflow files alone does not enable them. Do not bypass a failed
quality gate as part of routine merging. Explain an exception against a concrete reviewed change.

## Review expectations

Preserve existing game behavior unless the change explicitly documents a feature or bug fix.
Keep gameplay balance and map redesign separate from structural refactors. Existing map fixtures
record geometry/colliders/spawns for both maps and both modes. Movement snapshots record behavior;
review the cause before changing an expected result. Never update fixtures just to hide a regression.

Use meaningful assertions and test failures, expiry, authority and cleanup as well as happy paths.
Coverage includes all product files. Read [quality](docs/quality.md) for coverage scope and the manual
browser/network checks that remain necessary. Include screenshots/recordings for visual work and
update controls, environment/deployment docs and ADRs when their contracts change.

## License and attribution

Review [NOTICE.md](NOTICE.md) and [LICENSE.md](LICENSE.md). The fork's PolyForm Noncommercial terms
cover original contributions in this fork and do not grant rights to inherited upstream material
or third-party dependencies. Preserve upstream authorship and dependency notices.
