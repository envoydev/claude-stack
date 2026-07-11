---
name: project-scaffold
description: "Build a new application or major module from scratch - greenfield scaffolding and orchestration, before code exists. Routes a new project to the right architecture skill (`dotnet-architecture`) and build-spine setup (`dotnet-project-setup`), plus the scaffolding command (dotnet new, ng new), then in a stack-installed Claude Code project drives the build from the main session - greenfield-solution-designer designs, and each vertical slice runs the `main-stack-agents-flow` skill for its stack. Not for changing an existing codebase - a feature inside a live app is `main-stack-agents-flow`, cross-stack routing is `cross-stack-agents-flow`. Triggers on build from scratch, new project, greenfield, scaffold, start a new app."
disable-model-invocation: true
---

# Project Scaffold - Greenfield Build Orchestration

Use this skill to build a new application or a major new module from scratch, before code exists. It routes the work to the right architecture skill and scaffolding command, then - in a stack-installed Claude Code project - drives the build itself, slice by slice, from the main session.

## Execution modes
Pick the mode once, before DESIGN, and hold it for the whole run.

- **DELEGATED** - the default whenever the current session can dispatch subagents (the Agent tool is available). The main session orchestrates: it dispatches greenfield-solution-designer, then runs each slice's `main-stack-agents-flow` vertical by dispatching that stack's seats directly; it never does their work itself. (This skill and `main-stack-agents-flow` are manual `/`-only skills (`disable-model-invocation`), so a slice runs its vertical by dispatching the seats, not by model-invoking the `main-stack-agents-flow` skill.)
- **INLINE** - the fallback when dispatch is unavailable: Cursor, a non-stack project, or a scaffold small enough that dispatch overhead outweighs the work. Do it all in-session, using brainstorming and writing-plans plus the architecture skills directly, instead of dispatching a designer.

Detection keys on dispatch capability, not file presence - a project can carry the agent files on disk with no Agent tool available, in which case it still runs INLINE.

## Steps
1. **DESIGN** - DELEGATED: dispatch greenfield-solution-designer to turn the spec into architecture options. INLINE: brainstorming and writing-plans in-session, to the same end. Either way, get the user's approval on the architecture and the stack before scaffolding anything - greenfield tech choices are the user's, never silently picked.
2. **SCAFFOLD** - once approved, run the named new-project command (dotnet new <template>; ng new; ionic start for Ionic), establish the structure from the chosen architecture skill, and wire the baseline - DI, config, a test project, formatter/analyzer config - via the stack's setup skills (`dotnet-project-setup` + `dotnet-code-quality` on .NET).
3. **BUILD** - slice by slice: for each vertical slice, dispatch that slice's stack seats directly from the main session - its designer, then implementer(s), then verifier (the `main-stack-agents-flow` vertical). Loop until the spec's first milestone is met.

## Per-stack scaffolding

| Stack | new-project command | Architecture + convention skills |
|---|---|---|
| Angular web | ng new | `angular-conventions` + `angular-styling` |
| Ionic/Capacitor mobile | ionic start + cap add | `ionic` + `mobile` |
| ASP.NET Core backend | dotnet new webapi/web | `dotnet-architecture` + `dotnet-web-backend` / `dotnet-minimal-api` |
| WPF desktop | dotnet new wpf | `dotnet-wpf` (strict MVVM) |
| SQL / data | first schema | `database-conventions` + `dotnet-migrate` |

## Rules
- Greenfield architecture and tech choices are the user's - present options, get approval, never scaffold before the design is approved.
- The main session is the only orchestrator - never instruct a subagent to dispatch another; the agents this skill dispatches (greenfield-solution-designer, then the domain seats of the `main-stack-agents-flow` vertical) carry no Agent tool.
- Reuse the architecture skills rather than restating structure here - this skill routes, it does not re-derive.
