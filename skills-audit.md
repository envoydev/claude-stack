# Skills audit & improve loop

Durable ledger for the skills audit. Rubric: 6 dimensions scored 0-10; grade = lowest dim (A = all >=8, B = all >=6, C = all >=4). Gates for A: `node scripts/lint-skills.js` clean, every dim >=8, zero open correctness/currency findings, zero open duplication/broken-ref findings. Each skill: independent adversarial verify after the audit+fix pass; hard cap 5 passes.

Stop reasons: SATISFIED (grade A, all gates) | PLATEAU (2 identical open-con passes) | OSCILLATION (cleared con set reappeared) | CAPPED (5 passes).

Branch: `skills-audit-2026-07`. Started 2026-07-07.

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
| 19 | dotnet-code-quality | - | pending | - | - | - |
| 20 | dotnet-cryptography | - | pending | - | - | - |
| 21 | dotnet-data-access | - | pending | - | - | - |
| 22 | dotnet-diagnostics | - | pending | - | - | - |
| 23 | dotnet-error-handling | - | pending | - | - | - |
| 24 | dotnet-grpc | - | pending | - | - | - |
| 25 | dotnet-hosted-services | - | pending | - | - | - |
| 26 | dotnet-messaging | - | pending | - | - | - |
| 27 | dotnet-migrate | - | pending | - | - | - |
| 28 | dotnet-minimal-api | - | pending | - | - | - |
| 29 | dotnet-mvc-controllers | - | pending | - | - | - |
| 30 | dotnet-openapi | - | pending | - | - | - |
| 31 | dotnet-performance | - | pending | - | - | - |
| 32 | dotnet-project-setup | - | pending | - | - | - |
| 33 | dotnet-realtime | - | pending | - | - | - |
| 34 | dotnet-security | - | pending | - | - | - |
| 35 | dotnet-source-generators | - | pending | - | - | - |
| 36 | dotnet-testing | - | pending | - | - | - |
| 37 | dotnet-web-backend | - | pending | - | - | - |
| 38 | dotnet-wpf | - | pending | - | - | - |
| 39 | explain-code-tutor | - | pending | - | - | - |
| 40 | frontend | - | pending | - | - | - |
| 41 | ilspy-decompile | - | pending | - | - | - |
| 42 | ionic | - | pending | - | - | - |
| 43 | markdown-style | - | pending | - | - | - |
| 44 | mobile | - | pending | - | - | - |
| 45 | mobile-security | - | pending | - | - | - |
| 46 | postgres | - | pending | - | - | - |
| 47 | project-quality-loop | - | pending | - | - | - |
| 48 | project-scaffold | - | pending | - | - | - |
| 49 | sqlite | - | pending | - | - | - |
| 50 | subagent-flow | - | pending | - | - | - |
| 51 | typescript | - | pending | - | - | - |

## Notes

- **Batch 1** (2026-07-07): 9/9 reached A, lint clean, house voice clean. Adversarial verify caught real currency bugs (Capacitor 7->8, angular-material `mat.theme` v17->v19, angular-conventions aria floor, a Flyweight example that was JVM integer-cache behavior not .NET). No fabricated cons flagged. No renames needed. 10 files changed.
- **Batch 2** (2026-07-07): 9/9 reached A, lint clean, house voice clean. Real fixes: dotnet-authentication cookie Secure-by-default over-claim (security correctness), dotnet-architecture Guid.CreateVersion7 unflagged on the .NET 8 floor + a dangling api-versioning reference routed to dotnet-web-backend, plus house-voice cleanups (double-quote emphasis, British spellings, example date/weekday mismatches). devops was already A with zero edits. No fabrications, no renames. 11 files changed.
