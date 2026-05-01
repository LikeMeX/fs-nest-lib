---
title: fs-nest-lib runbook
repo: fs-nest-lib
layer: backend
tech: NestJS library
default_branch: main
updated: 2026-04-24
source_path: docs/runbook.md
---

# Runbook — fs-nest-lib

This is a **library**, not a deployed service. No runtime ops. Release flow only.

## Release

```sh
pnpm install
pnpm build
pnpm publish   # or CI-triggered semantic-release via github-reuse-workflow
```

## Local linking (consumer testing)

```sh
# in fs-nest-lib
pnpm link --global
# in consumer repo
pnpm link --global fs-nest-lib
```

## Version policy

- Semver.
- Breaking changes → major bump; coordinate with all consumer repos.
- CI: reusable semantic-release workflow from [github-reuse-workflow](https://github.com/LikeMeX/github-reuse-workflow).

## Common issues

- **Consumer fails to resolve types**: rebuild + bump version + update consumer lockfile.
- **OTel context lost across async**: verify `AsyncLocalStorage` hook is imported before Nest bootstrap.
