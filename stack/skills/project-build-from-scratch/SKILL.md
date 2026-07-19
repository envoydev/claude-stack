---
name: project-build-from-scratch
description: "Build a new application or major module from scratch - greenfield design, scaffolding, and build orchestration, before code exists. DESIGN runs IN-SESSION on this skill's opus/xhigh pinned turn: the spec becomes 2-3 reasoned architecture options and the user picks - nothing is scaffolded before that pick. Then the stack's real new-project command + baseline wiring, then the build slice by slice through the domain seats. Not for changing an existing codebase - a feature inside a live app is `project-solve-cross-task`, a new module in an existing repo is the project-architecture-analyzer capture plus that stack's solution-designer. Triggers on build from scratch, new project, greenfield, scaffold, start a new app."
disable-model-invocation: true
model: opus
effort: xhigh
---

# Project Build From Scratch - Greenfield Design, Scaffold, Build

Use this skill to build a new application or a major new module from scratch, before code exists. The design happens here, in-session - there is no dispatched greenfield seat: with no code to read, a design pass reasons from the spec that is already in this conversation, and its options come back to the user anyway. The frontmatter pins the invoking turn to `opus`/`xhigh`, so DESIGN runs on the architect's budget regardless of the session model (the pin lasts the turn - after the user's pick, orchestration resumes on the session model, which is fine: scaffold and build are dispatch mechanics).

## Steps

### 1. DESIGN - in-session, on the pinned turn
Turn the spec into 2-3 reasoned architecture options - stack, architecture style, folder/module shape, state and persistence approach - each with its tradeoffs, using the brainstorming discipline plus the stack's architecture skills (the per-stack table below names them). Ground every option in the house skills, not recall. A spec gap that blocks the design is a question to the user (the superpowers brainstorming + `AskUserQuestion` path), never a guess. Multi-stack designs name the seam and its producer/consumer direction up front - the build step will run it producer-first per `project-solve-cross-task`.

### 2. THE PICK - hard gate
Present the options; the user chooses the architecture and the stack. Greenfield tech choices are the user's, never silently picked - nothing is scaffolded before this gate.

### 3. SCAFFOLD
Run the named new-project command (`dotnet new <template>`; `ng new`; `ionic start` for Ionic), establish the structure from the chosen architecture skill, and wire the baseline - DI, config, a test project, formatter/analyzer config - via the stack's setup skills (`dotnet-project-setup` + `dotnet-code-quality` on .NET).

### 4. BUILD - slice by slice
For each vertical slice, dispatch that slice's stack seats directly from the main session - its designer, then implementer(s), then verifier (the domain-trio vertical - `project-solve-cross-task`'s `references/domain-trio-protocol.md`); reds route to the matching resolver. A multi-stack slice runs producer-first with the recorded interface, per `project-solve-cross-task`. Loop until the spec's first milestone is met. (INLINE fallback - Cursor, or a scaffold too small to fan out: do the slices in-session with writing-plans + the architecture skills instead of dispatching.)

### 5. HANDOFF
First milestone green: suggest the captures - `/project-architecture-analyzer` and `/project-code-style-analyzer` - so the new repo gets its map, style doc, and generated awareness rules; from here on the standing flow machinery owns the project.

## Per-stack scaffolding

| Stack | new-project command | Architecture + convention skills |
|---|---|---|
| Angular web | ng new | `angular-conventions` + `angular-styling` |
| Ionic/Capacitor mobile | ionic start + cap add | `ionic` + `mobile` |
| ASP.NET Core backend | dotnet new webapi/web | `dotnet-architecture` + `dotnet-web-backend` / `dotnet-minimal-api` |
| WPF desktop | dotnet new wpf | `dotnet-wpf` (strict MVVM) |
| SQL / data | first schema | `database-conventions` + `dotnet-migrate` |

## Example

Brief: 'Start a new Angular admin dashboard.'
1. **DESIGN** in-session: three options - standalone + signals with feature folders; NgRx-backed modular; minimal-shell MVP - each with routing, state tier, folder shape, and the tradeoff that decides it.
2. **THE PICK**: the user chooses option one.
3. **SCAFFOLD**: `ng new admin`, structure per `angular-conventions`, wire lint/format config, a test setup, the core routing shell.
4. **BUILD**: first slice (the auth shell) - dispatch angular-solution-designer, then the angular implementer(s), then angular-verifier; loop the punch-list. Repeat per slice to the first milestone.
5. **HANDOFF**: suggest the captures so the repo gets its map and style artifacts.

## Rules
- Greenfield architecture and tech choices are the user's - present options, get the pick, never scaffold before it.
- Design from the house architecture skills, not recall - this skill routes to them, it does not re-derive structure. Version-sensitive choices check context7, never memory.
- The main session is the only orchestrator - never instruct a subagent to dispatch another; the domain seats this skill fans out carry no Agent tool.
- An honest NEEDS_CONTEXT beats a guessed design: a blocking spec question goes to the user before options are locked.
