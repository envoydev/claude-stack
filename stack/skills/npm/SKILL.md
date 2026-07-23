---
name: npm
description: "Professional npm usage for consuming and publishing packages: lockfile + npm ci discipline, the supply-chain baseline (ignore-scripts, the min-release-age cooldown, allow-git=none, OIDC publishing, scoped internal packages), honest npm-audit gating, overrides vs --legacy-peer-deps, exports maps and ESM-first publishing, update-bot cooldowns. Fires on package.json / package-lock.json / .npmrc work, npm install/ci/publish questions, dependency updates or vulnerability reports, supply-chain concerns, 'set up npm for this repo'. NOT for TS language style (typescript skill), Angular framework conventions (angular-conventions), or authoring CI pipelines beyond npm's own steps (the devops family)."
---

# npm - professional consuming, securing, publishing

npm's dominant risk is the supply chain: self-replicating worm campaigns (Shai-Hulud and successors, 2025-2026) spread through install-time scripts and stolen publish tokens across hundreds of packages. The defenses below are cheap and mechanical - treat them as the baseline, not as hardening for later. History, numbers, and the full tooling landscape: `references/supply-chain.md`.

## Non-negotiables (any repo that has a package.json)

- **Commit `package-lock.json`; install with `npm ci` in every non-interactive context** - CI, Docker, reproducible local resets. `npm ci` installs strictly from the lockfile and fails on package.json drift; `npm install` is only for intentionally changing dependencies. Lockfile merge conflict: resolve package.json, regenerate with `npm install` (or `--package-lock-only`) - never hand-edit, never delete-and-regenerate blindly (that discards the pinned integrity hashes).
- **Project `.npmrc` baseline** (committed, non-secret):

  ```ini
  ignore-scripts=true
  min-release-age=7
  allow-git=none
  engine-strict=true
  ```

  Why each line: lifecycle scripts are the worm execution vector; malicious versions are usually pulled within hours, so a 7-day cooldown filters nearly all of them (needs npm >= 11.10.0); a git dependency can ship its own `.npmrc` that swaps the git binary path - code execution even with scripts ignored - so git/file/remote sources are shut off (npm >= 11.10.0; the v12 default). `ignore-scripts` still runs your own `npm start`/`test` scripts.
- **`dependencies` vs `devDependencies` discipline.** Build/test-only tooling (typescript, CLIs, linters, bundlers, test libs) goes in devDependencies; production images install with `npm ci --omit=dev`. Misclassification bloats the attack surface, the image, and the SBOM.
- **Pin Node**: `.nvmrc` + `engines.node`; CI reads `node-version-file: '.nvmrc'` with `cache: 'npm'` so dev and CI match exactly.
- **Scope internal packages** (`@yourorg/...`), map the scope to the private registry in `.npmrc` (`@yourorg:registry=...`), and reserve the scope on public npm - closes dependency confusion. Never commit auth tokens; CI injects `${NODE_AUTH_TOKEN}` or, better, uses OIDC and has no token at all.
- **One package manager per repo**, pinned via the `packageManager` field - mixed lockfiles are the real hazard. Corepack is not bundled from Node 25+: install the package manager explicitly (setup step, Volta, or base image), don't assume it.
- **CI install + audit as separate steps**: `npm ci --no-audit --no-fund --prefer-offline --ignore-scripts`, then a dedicated gate - `npm audit --omit=dev --audit-level=high` with no `|| true`, plus `npm audit signatures` (verifies registry signatures and provenance for the installed tree). Never `npm audit fix --force` in automation - it silently takes breaking majors. npm audit sees only known CVEs with a high false-positive rate; the worm class needs a behavioral scanner on top - the layering is in `references/supply-chain.md`.

## Everyday dependency rules

- **Semver intent**: apps keep caret ranges in package.json and get reproducibility from the lockfile + `npm ci` - do not exact-pin package.json (it fights tooling and buries transitive drift). Exact pins only for a known-fragile package; tilde when you distrust a package's minors. The cooldown is the supply-chain lever, not pinning.
- **`overrides`** forces a transitive version (vulnerable indirect dep before the parent updates). Temporary by definition - document every override with its reason and remove it when upstream ships. A misspelled override key is silently ignored; verify with `npm ls <pkg>`. Changing code, not versions, is patch-package's job.
- **`--legacy-peer-deps` is a smell, not a fix** - it suppresses the peer check and can leave an unsupported combination installed. Fix order: align versions (upgrade the lagging package; check `npm info <pkg> peerDependencies`), then a targeted override, then wait for the compatible release. If unavoidable (Angular's tight peer ranges make it endemic; even `ng update` sometimes needs it): scope it to the single install and write down why. Never `legacy-peer-deps=true` globally.
- **Scripts hygiene**: `FOO=bar` fails on Windows - use cross-env; use npm-run-all (`run-s`/`run-p`) over brittle `&&` chains; keep pre/post hooks shallow and predictable; prefer Node-based scripts for a mixed-OS team.

## Publishing (libraries)

The full authoring guide - exports maps, ESM-only vs dual, versioning, release automation - is `references/publishing.md`. The floor that applies to any publish:

- **`files` allowlist over `.npmignore`** - allowlists fail safe. Trap: `.npmignore` fully replaces `.gitignore` when both exist (not cumulative) - a common secret leak. Verify the exact tarball with `npm pack --dry-run` before every ship.
- **Scoped public packages need `"publishConfig": { "access": "public" }`** - scoped defaults to restricted.
- **Publish from CI via OIDC trusted publishing** - long-lived npm tokens are gone (classic tokens permanently revoked Dec 2025); OIDC generates provenance automatically, and staged publishing adds a human 2FA approval gate against stolen-credential republishing.

## CI, updates, and the wider toolbox

Cache keys per CI provider, Docker layering, Renovate/Dependabot cooldown + noise-reduction config, bundle/dedupe analysis, and the honest npm-vs-pnpm-vs-bun / monorepo-tooling state: `references/ci-and-operations.md`. Update bots need their own cooldown too - the package-manager cooldown fires at install time, the bot's at PR-open time; security patches bypass both.
