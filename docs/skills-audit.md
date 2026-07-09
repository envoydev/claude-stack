# Skills audit & improve loop

Durable ledger for the skills audit. Rubric: 6 dimensions scored 0-10; grade = lowest dim (A = all >=8, B = all >=6, C = all >=4). Gates for A: `node scripts/lint-skills.js` clean, every dim >=8, zero open correctness/currency findings, zero open duplication/broken-ref findings. Each skill: independent adversarial verify after the audit+fix pass; hard cap 5 passes.

Stop reasons: SATISFIED (grade A, all gates) | PLATEAU (2 identical open-con passes) | OSCILLATION (cleared con set reappeared) | CAPPED (5 passes).

Branch: `skills-audit-2026-07`. Started and completed 2026-07-07. **Result: 51/51 at grade A.**

## Scoreboard

| # | skill | first grade | current grade | passes | stop reason | blocking cons |
|---|-------|-------------|---------------|--------|-------------|---------------|
| 1 | angular-conventions | B | **A** | 2 | SATISFIED | none (verifier caught `@angular/aria` v20+->v21+, remediated) |
| 2 | angular-material | C | **A** | 1 | SATISFIED | none (fixed `mat.theme` v17->v19, aria preview->v22, +angular-styling route) |
| 3 | angular-security | A | **A** | 1 | SATISFIED | none (added Trusted Types to CSP) |
| 4 | angular-styling | B | **A** | 1 | SATISFIED | none (fixed IsolatedShadowDom v20->v21, stale Tailwind/Sass ban) |
| 5 | capacitor-release | B | **A** | 1 | SATISFIED | none (Capacitor 7->8 currency) |
| 6 | create-ticket | A | **A** | 1 | SATISFIED | none (Azure DevOps Markdown-field precision) |
| 7 | csharp | B | **A** | 1 | SATISFIED | none (flagged params-span C#13, routed hot-path serde, +floor/companion in desc) |
| 8 | csharp-design-patterns | B | **A** | 1 | SATISFIED | none (Flyweight example was JVM not .NET; backticked routing targets) |
| 9 | data-security | A | **A** | 1 | SATISFIED | none (re-routed N+1/change-tracking to dotnet-data-access) |
| 10 | database-conventions | B | **A** | 2 | SATISFIED | none (verifier caught double-quote emphasis, remediated to single quotes) |
| 11 | dev-log-convert | B | **A** | 1 | SATISFIED | none (weekday/date mismatch in examples, British 'labelled') |
| 12 | devops | A | **A** | 1 | SATISFIED | none (already A, zero edits - honesty gate held) |
| 13 | domain-build | B | **A** | 1 | SATISFIED | none (added negative scope + companion routing to description) |
| 14 | dotnet | B | **A** | 2 | SATISFIED | none (verifier caught double-quote emphasis, remediated) |
| 15 | dotnet-architecture | B | **A** | 1 | SATISFIED | none (Guid.CreateVersion7 unflagged on .NET 8 floor; dangling api-versioning ref -> dotnet-web-backend; British spellings) |
| 16 | dotnet-architecture-tests | B | **A** | 1 | SATISFIED | none (British->US spellings) |
| 17 | dotnet-aspire | A | **A** | 2 | SATISFIED | none (added dotnet-testing to Companions) |
| 18 | dotnet-authentication | B | **A** | 1 | SATISFIED | none (cookie Secure-by-default over-claim corrected to HttpOnly+SameSite=Lax, pin CookieSecurePolicy.Always in prod) |
| 19 | dotnet-code-quality | B | **A** | 2 | SATISFIED | none (verifier scored correctness 5: CRAP formula wrong; remediated to complexity^2 x (1-cov)^3 + complexity) |
| 20 | dotnet-cryptography | B | **A** | 1 | SATISFIED | none (PQC type SLHDsa->SlhDsa, garbled platform string, SYSLIB5006 note) |
| 21 | dotnet-data-access | C | **A** | 1 | SATISFIED | none (EF change-tracking identity-resolution wrong; +pooled factory; desc floor/scope) |
| 22 | dotnet-diagnostics | B | **A** | 1 | SATISFIED | none (dump format-specifier .NET version, --noOverwrite semantics, desc backtick/scope) |
| 23 | dotnet-error-handling | B | **A** | 1 | SATISFIED | none (false ProblemDetails won't-compile claim) |
| 24 | dotnet-grpc | B | **A** | 1 | SATISFIED | none (Honour->Honor, +dotnet-realtime route) |
| 25 | dotnet-hosted-services | B | **A** | 2 | SATISFIED | none (verifier caught double-quote emphasis, remediated) |
| 26 | dotnet-messaging | B | **A** | 1 | SATISFIED | none (added Companions routing clause) |
| 27 | dotnet-migrate | C | **A** | 1 | SATISFIED | none (EF bundle --idempotent + self-contained mischaracterization, Upgrade Assistant deprecation, desc/serena backtick) |
| 28 | dotnet-minimal-api | B | **A** | 1 | SATISFIED | none (.NET 10 cross-field validation claim corrected) |
| 29 | dotnet-mvc-controllers | B | **A** | 2 | SATISFIED | none ([AsParameters] falsely claimed on controllers, [FromServices] version, British spellings) |
| 30 | dotnet-openapi | B | **A** | 1 | SATISFIED | none (Scalar default route /scalar/v1 -> /scalar) |
| 31 | dotnet-performance | B | **A** | 1 | SATISFIED | none (routed dotnet-diagnostics, negative scope, dropped inaccurate tracing claim) |
| 32 | dotnet-project-setup | B | **A** | 1 | SATISFIED | none (CPM floating-vs-range conflation, .slnx SDK floor) |
| 33 | dotnet-realtime | B | **A** | 1 | SATISFIED | none (phantom r3-reactive-extensions route removed, double-quote emphasis) |
| 34 | dotnet-security | B | **A** | 1 | SATISFIED | none (fabricated AddPackageSourceMapping API, BinaryFormatter timeline, OWASP 2021->2025, 'defence') |
| 35 | dotnet-source-generators | A | **A** | 1 | SATISFIED | none (already A, zero edits) |
| 36 | dotnet-testing | B | **A** | 2 | SATISFIED | none (verifier caught double-quote emphasis, remediated) |
| 37 | dotnet-web-backend | B | **A** | 1 | SATISFIED | none (HybridCache falsely gated .NET 9+ - it's GA on netstandard2.0; +dedup, British spelling) |
| 38 | dotnet-wpf | B | **A** | 1 | SATISFIED | none (deduped overlapping theming sections) |
| 39 | explain-code-tutor | B | **A** | 1 | SATISFIED | none (await in non-async ngOnInit example; +'labelled'->'labeled' by orchestrator) |
| 40 | frontend | B | **A** | 1 | SATISFIED | none (added angular-security route to table + description) |
| 41 | ilspy-decompile | B | **A** | 1 | SATISFIED | none (dnx SDK-only .NET 10; removed misleading allowed-tools grant; backticked companions; unbacktick serena) |
| 42 | ionic | B | **A** | 1 | SATISFIED | none (Capacitor 7->8 currency, British spellings, +mobile-security handoff) |
| 43 | markdown-style | B | **A** | 2 | SATISFIED | none (verifier caught double-quote emphasis in refs, remediated) |
| 44 | mobile | B | **A** | 1 | SATISFIED | none (added mobile-security route mirroring dotnet->dotnet-security) |
| 45 | mobile-security | B | **A** | 1 | SATISFIED | none (cut restated ionic lane, added version floor) |
| 46 | postgres | B | **A** | 2 | SATISFIED | none (nearest-neighbour->neighbor; jsonb_path_ops covers @>/@?/@@ not ?/?&/?|) |
| 47 | project-quality-loop | B | **A** | 1 | SATISFIED | none (routed flat-fan-out policy to subagent-flow) |
| 48 | project-scaffold | B | **A** | 2 | SATISFIED | none (verifier scored correctness 6: false 'ng new via angular-cli MCP'; removed in 3 places) |
| 49 | sqlite | B | **A** | 1 | SATISFIED | none (ALTER TABLE DROP COLUMN since 3.35 was omitted) |
| 50 | subagent-flow | B | **A** | 1 | SATISFIED | none (model-routing 'pins ARE defaults' contradiction; 'licence'->'license') |
| 51 | typescript | A | **A** | 1 | SATISFIED | none (backticked angular-conventions; removed unfulfilled 'optional below' promise) |

## Notes

- **Batch 1** (2026-07-07): 9/9 reached A, lint clean, house voice clean. Adversarial verify caught real currency bugs (Capacitor 7->8, angular-material `mat.theme` v17->v19, angular-conventions aria floor, a Flyweight example that was JVM integer-cache behavior not .NET). No fabricated cons flagged. No renames needed. 10 files changed.
- **Batch 2** (2026-07-07): 9/9 reached A, lint clean, house voice clean. Real fixes: dotnet-authentication cookie Secure-by-default over-claim (security correctness), dotnet-architecture Guid.CreateVersion7 unflagged on the .NET 8 floor + a dangling api-versioning reference routed to dotnet-web-backend, plus house-voice cleanups (double-quote emphasis, British spellings, example date/weekday mismatches). devops was already A with zero edits. No fabrications, no renames. 11 files changed.
- **Batch 3** (2026-07-07): 9/9 reached A, lint clean, house voice clean. Best verifier catch of the run: dotnet-code-quality's CRAP formula was wrong (verifier scored correctness 5/10), remediated to complexity^2 x (1-coverage)^3 + complexity with recomputed examples. Plus dotnet-cryptography PQC type/platform fixes, dotnet-data-access EF identity-resolution correctness, dotnet-error-handling false won't-compile claim, dotnet-migrate EF-bundle flag fixes. 'cancelled' in dotnet-grpc left as-is (within repo's mixed norm). No fabrications, no renames. 14 files changed.
- **Batch 4** (2026-07-07): 9/9 reached A, lint clean, house voice clean. Caught a hallucinated API in the skill itself: dotnet-security cited a fabricated `AddPackageSourceMapping` method (removed), plus a wrong BinaryFormatter timeline and OWASP 2021->2025 staleness. dotnet-mvc-controllers claimed `[AsParameters]` works on controllers (minimal-API only). dotnet-realtime had a phantom r3-reactive-extensions route (prose, so lint couldn't catch it). dotnet-openapi Scalar route, dotnet-project-setup CPM flag conflation. dotnet-source-generators already A, zero edits. No fabricated cons, no renames. 10 files changed.
- **Batch 5** (2026-07-07): 9/9 reached A, lint clean. Real fixes: dotnet-web-backend HybridCache was falsely gated to .NET 9+ (it's GA and targets netstandard2.0, so runs on the .NET 8 floor); ionic Capacitor 7->8; explain-code-tutor a non-compiling `await` in a sync `ngOnInit()` example; ilspy-decompile a misleading `allowed-tools` grant removed + dnx SDK-only clarification; frontend/mobile/mobile-security routing completeness. Orchestrator caught one British 'labelled'->'labeled' in explain-code-tutor that audit+verify missed. No fabrications, no renames. 12 files changed.
- **Batch 6** (2026-07-07): 6/6 reached A, lint clean. Real fixes: project-scaffold falsely attributed `ng new` to the angular-cli MCP (which has no project-creation tool - verifier scored correctness 6, remediated in 3 places); sqlite omitted ALTER TABLE DROP COLUMN (supported since 3.35); subagent-flow model-routing.md had an internal contradiction ('pins ARE the defaults' vs a table showing task-analyzer default sonnet-high / pin opus-high); postgres jsonb_path_ops operator-coverage correctness. Plus routing (project-quality-loop, typescript) and 'licence'->'license'. No fabrications, no renames. 7 files changed.

## Final result

**51/51 skills at grade A (SATISFIED).** Zero PLATEAU, zero CAPPED, zero OSCILLATION. Objective gates all hold: `node scripts/lint-skills.js` clean (51 skills, 4 manifests + HTML in sync, no over-length description warnings), full-corpus house-voice sweep clean (no em/en-dashes or entities, no clear British spellings), every backticked skill reference resolves. No skill needed a rename/split/delete. The independent adversarial verifier flagged **zero fabricated pros/cons** across all 51 skills, and forced remediation on the cases where the audit pass had missed something (angular-conventions aria floor, database-conventions/dotnet/dotnet-hosted-services/dotnet-testing/markdown-style double-quote emphasis, dotnet-code-quality CRAP formula, postgres, project-scaffold).

Cross-skill routing changes (net new backticked cross-links, all resolving): data-security now routes N+1/change-tracking to `dotnet-data-access` (was mis-routed to `dotnet-security`); dotnet-architecture routes api-versioning to `dotnet-web-backend` (was a dangling local ref); dotnet-performance routes to `dotnet-diagnostics`; frontend adds an `angular-security` route; mobile adds a `mobile-security` route; project-quality-loop and domain-build route the flat-fan-out policy to `subagent-flow`; csharp-design-patterns/typescript/ilspy-decompile/dotnet-migrate backticked previously-plain sibling names. dotnet-realtime dropped a phantom `r3-reactive-extensions` route and dotnet-security dropped a fabricated `AddPackageSourceMapping` API.
