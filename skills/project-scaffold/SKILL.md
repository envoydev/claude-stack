---
name: project-scaffold
description: "Build a new application or major module from scratch - greenfield scaffolding and orchestration, before code exists. Routes a new project to its stack's architecture and setup skills plus its scaffolding command - one per-stack row each for Angular, ASP.NET, WPF, Ionic mobile, and SQL/data - then in a stack-installed Claude Code project drives the build from the main session - greenfield-solution-designer designs, and each vertical slice runs the `main-stack-agents-flow` skill for its stack. Not for changing an existing codebase - a feature inside a live app is `main-stack-agents-flow`, cross-stack routing is `cross-stack-agents-flow`. Triggers on build from scratch, new project, greenfield, scaffold, start a new app."
disable-model-invocation: true
---

# Project Scaffold - Greenfield Build Orchestration

Use this skill to build a new application or a major new module from scratch, before code exists. It routes the work to the right architecture skill and scaffolding command, then - in a stack-installed Claude Code project - drives the build itself, slice by slice, from the main session.

## Execution modes
DELEGATED vs INLINE - and why detection keys on dispatch capability, not file presence - is the shared policy `cross-stack-agents-flow` owns. Pick the mode once, before DESIGN, hold it for the run, and apply it to the scaffold:

- **DELEGATED** (dispatch available) - the main session dispatches greenfield-solution-designer, then runs each slice's `main-stack-agents-flow` vertical by dispatching that stack's seats directly, never doing their work itself. (This skill and `main-stack-agents-flow` are manual `/`-only skills (`disable-model-invocation`), so a slice runs its vertical by dispatching the seats, not by model-invoking the `main-stack-agents-flow` skill.)
- **INLINE** (no dispatch: Cursor, a non-stack project, or a scaffold too small to fan out) - do it all in-session, using brainstorming and writing-plans plus the architecture skills directly, instead of dispatching a designer.

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

## Example

Brief: 'Start a new Angular admin dashboard.' DELEGATED, stack-installed project:
1. **DESIGN** - dispatch greenfield-solution-designer; it returns 2-3 architecture options (routing, state tier, folder shape). Present them, get the user's pick before scaffolding.
2. **SCAFFOLD** - on approval: `ng new admin`, establish the structure from `angular-conventions`, and wire the baseline - lint/format config, a test setup, the core routing shell.
3. **BUILD** - first slice (the auth shell): dispatch angular-solution-designer, then the angular implementer(s), then angular-verifier - the `main-stack-agents-flow` vertical - and loop its punch-list. Repeat per slice to the first milestone.

## Rules
- Greenfield architecture and tech choices are the user's - present options, get approval, never scaffold before the design is approved.
- The main session is the only orchestrator - never instruct a subagent to dispatch another; the agents this skill dispatches (greenfield-solution-designer, then the domain seats of the `main-stack-agents-flow` vertical) carry no Agent tool.
- Reuse the architecture skills rather than restating structure here - this skill routes, it does not re-derive.
