# Contributing to ClawKit

## Component Structure

Every component lives under `registry/components/<name>/` and requires two files:

```
registry/components/my-component/
├── index.ts      # Implementation (single entry point)
└── meta.json     # Component metadata
```

### meta.json Schema

```jsonc
{
  "name": "my-component",            // kebab-case, unique across registry
  "description": "Short description", // One-liner shown in CLI search
  "dependencies": ["other-component"], // Other ClawKit components this depends on
  "devDependencies": {},              // npm packages needed at dev time
  "peerDependencies": {},             // npm packages the consumer must provide
  "tags": ["utility"],                // Searchable tags
  "sandbox": {                        // Capability declarations
    "network": false,                 // true only if component makes HTTP calls
    "fs": false                       // true only if component touches the filesystem
  }
}
```

All fields except `name` and `description` are optional.

### Using `clawkit:types`

Components import shared types via the magic `clawkit:types` specifier:

```ts
import type { Component, SandboxContext } from "clawkit:types";
```

This is rewritten at install time to point at the resolved types package. Never import from a relative path or bare `@clawkit/types` directly inside component source.

## Code Style

The project uses **Biome** for formatting and linting. Run before committing:

```sh
npx biome check --write .
```

Configuration lives in `biome.json` at the repo root.

## Testing

Tests use **Vitest**. Every component must have a corresponding test file under `tests/`.

```sh
npm test                  # run full suite
npx vitest run <pattern>  # run a subset
```

Aim for:
- At least one happy-path test per exported function.
- Edge-case coverage for any input validation.
- No reliance on network or filesystem unless the component declares it in `sandbox`.

## Pull Request Process

1. **Branch** off `main` with a descriptive name (`feat/add-retry-component`, `fix/parser-edge-case`).
2. **Commit** small, focused changes with clear messages.
3. **Open a PR** against `main`. The CI pipeline must pass before review.
4. **One approval** is required to merge.

## PR Review Checklist

Before approving, verify:

- [ ] **No `eval` or `Function()` constructors** — dynamic code execution is forbidden.
- [ ] **No undeclared network access** — if the component calls the network, `sandbox.network` must be `true` in `meta.json`.
- [ ] **Sandbox-aware** — the component respects sandbox capability declarations and does not bypass them.
- [ ] **Tests included** — new or changed behavior has corresponding Vitest tests that pass.
- [ ] **`meta.json` is accurate** — dependencies, tags, and sandbox flags reflect reality.
- [ ] **Biome clean** — `npx biome check` reports no errors.
- [ ] **Types compile** — `tsc --noEmit` passes without errors.
