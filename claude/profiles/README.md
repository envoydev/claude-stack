# Claude Code profile installers (`claude/profiles/`)

Curated, **standalone** installers - one per project type - each a fork of
[`../claude-stack.sh`](../claude-stack.sh) with the off-domain `SKILLS` / `MCPS` / `PLUGINS` /
`AGENTS` entries commented out and the convention-hook `args` trimmed to the languages that
profile actually touches. Run one when you do not want the full stack laid down on a single-
purpose repo - a .NET API, an Angular web app, an Ionic/Capacitor mobile app, or a WPF desktop app.

Each profile is **complete on its own** (the same script body as the main installer, same
prerequisite check, same actions and extras). It is not a layer applied on top of
`claude-stack` - you run the profile *instead of* the main installer.

| Profile           | For                          | Run from inside the target project       |
| ----------------- | ---------------------------- | ---------------------------------------- |
| `dotnet-api.sh`   | ASP.NET Core / .NET backend  | `bash claude/profiles/dotnet-api.sh install` |
| `web-angular.sh`  | Angular web app              | `bash claude/profiles/web-angular.sh install` |
| `mobile.sh`       | Ionic / Capacitor + Angular  | `bash claude/profiles/mobile.sh install` |
| `wpf.sh`          | WPF desktop (.NET / strict-MVVM) | `bash claude/profiles/wpf.sh install` |

> **A repo with BOTH an Angular web app and an Ionic mobile app: use `mobile.sh`.** Ionic mobile
> is built on the Angular web stack, so the `mobile` profile already contains the complete
> `web-angular` toolset and adds the Ionic/Capacitor skills + `appium` on top - there is no
> separate combined profile because `mobile` already is one.

`update` and the `work` / `github-cli` extras work exactly as on the main installer (e.g.
`bash claude/profiles/dotnet-api.sh update`, `… install work github-cli`).

---

## Shared core - identical in all four

Every profile keeps the stack-neutral baseline untouched:

- **Skills:** `create-ticket`, `dev-log-convert`, `explain-code-tutor`, `project-quality-loop`,
  `git-master`, `markdown-style`, `docker-platform-guide`, `docker-security-guide`.
- **Hooks:** both guards - `guard-protected-force-push` + `guard-catastrophic-rm` - plus the
  `require-convention-skill` gate (its `args` are the only per-profile change).
- **MCP servers:** `context7`, `serena`, `memory`.
- **Plugins:** `superpowers`, `claude-md-management`, `security-guidance`, `claude-hud`,
  `ponytail`.

---

## What each profile keeps / trims at a glance

| Profile          | Keeps (on top of the shared core)                                                                                     | Trims (commented out)                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **dotnet-api**   | `csharp` + all `dotnet-*` skills + the .NET DB/SQL skills; `csharp-lsp`; the two .NET agents (`dotnet-build-error-resolver`, `dotnet-test-failure-resolver`); convention `args` **`cs sql`** | Angular/TS/mobile skills, `typescript-lsp`/`gopls-lsp`, `frontend-design`, the Angular agents, `angular-cli`/`playwright`/`chrome-devtools`/`appium-mcp` |
| **web-angular**  | `angular-*` + `typescript` + `frontend`/`material-3` skills; `typescript-lsp` + `frontend-design`; the two Angular agents (`ng-build-error-resolver`, `angular-test-resolver`); `angular-cli`/`playwright`/`chrome-devtools` MCPs; convention `args` **`ng ts`** | All `dotnet-*`/`csharp`/SQL skills, `csharp-lsp`/`gopls-lsp`, the .NET agents, `appium-mcp` |
| **mobile**       | everything web-angular keeps **plus** `ionic`/`mobile`/`capacitor-*` skills and `appium-mcp`; convention `args` **`ng ts`** | All `dotnet-*`/`csharp`/SQL skills, `csharp-lsp`/`gopls-lsp`, the .NET agents |
| **wpf**          | `csharp` + `dotnet-wpf` + the general .NET architecture / testing / quality / diagnostics skills + general DB (`database-conventions`/`efcore-patterns`/`database-performance`); `csharp-lsp`; the two .NET agents; convention `args` **`cs sql`** | The web/service `dotnet-*` skills (`-web-backend`/`-minimal-api`/`-mvc-controllers`/`-openapi`/`-grpc`/`-realtime`/`-messaging`/`-aspire`/`-authentication`/`-error-handling`/`-security`/`-hosted-services`/`-source-generators`), Angular/TS/mobile skills, `typescript-lsp`/`gopls-lsp`, `frontend-design`, the Angular agents, `angular-cli`/`playwright`/`chrome-devtools`/`appium-mcp`, the T-SQL/Postgres skills |

---

## Caveat - these are forks of the main installer

The profiles are **point-in-time copies** of `claude-stack.sh`, not generated from it. That has
two consequences:

- **Regenerate when the inventory changes.** Any edit to `SKILLS` / `MCPS` / `PLUGINS` /
  `AGENTS` / `HOOKS` in `claude-stack.sh` (a new skill, a renamed plugin, a changed MCP arg)
  does **not** propagate here. Re-fork the relevant profile - copy the updated body and re-apply
  the comment-outs and the trimmed hook `args` - or the profile drifts from the source of truth.
- **The parity lint does not cover them.** `npm run lint` enforces the 4-way parity across the
  two `claude-stack` twins and the two `cursor-stack` twins only; it never reads
  `claude/profiles/`. Nothing flags a profile that has gone stale, so keeping them in sync is
  manual.

When in doubt, run the full [`../claude-stack.sh`](../claude-stack.sh) (the maintained source)
and comment out by hand - the profiles are a convenience, not the canonical installer.
