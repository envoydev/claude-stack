# Capability Reuse - wire the installed capability, never re-derive it

Reuse is a cost lever, not a tax on the budget. A seat that guesses an API signature or a framework version burns tokens twice - once on the guess, again on the rework pass when the guess is wrong - while the right capability returns the exact detail cheaply and inline. So capability wiring is part of each mode's design, not an afterthought.

The test for every capability on every seat: does it remove a guess, a re-derivation, or a pass? If yes, wire it in. If not, leave it off - an eager-loaded unused MCP description or plugin is the same waste as an unused skill.

## Per-role wiring

| Role | Wires in | Removes |
|---|---|---|
| Solution designers | the house domain skills (preloaded), the context7 MCP for a version-gated API or feature, serena for the repo's existing architecture, a memory recall of the prior frozen contract | a re-derived architecture, a wrong version assumption, a re-frozen contract |
| Implementers | the house skills (loaded up front), the stack LSP plugin (csharp-lsp / typescript-lsp - inline diagnostics catch an error at edit time, so it does not bounce back from the gate as an extra fix round), the context7 MCP before writing against any library API, serena for symbol navigation, a memory read at start and write at hand-off | a fix-loop bounce, a version-guess rework, a whole-file read |
| Verifiers + integration reviewer | orient from the implementer's memory note and the diff, then INDEPENDENTLY run the gates and serena-navigate the specific concerns; the security-guidance hooks on a seat gating auth / data / migration; the playwright MCP only where a live browser is the only real proof | a redundant full re-read (see Redundant reads below) |
| Diagnosers | serena to locate the implicated symbol, a memory recall of a matching error signature and its proven fix, a read-only evidence-gatherer for the log and repro volume (kept off the opus seat) | a re-slurped log, a root cause a prior run already found |
| Repair resolvers | the stack LSP plugin, serena, a memory recall of the same error signature's prior fix | a re-derivation of a recurring fix |
| Evidence gatherer | serena and read-only Bash only - no memory, no context7 (single-run, hands its digest straight back) | its own context cost - it stays the cheapest seat |

## Cross-cutting disciplines

- **context7 before a library API, always.** A wrong package or framework version is a common rework trigger; the current signature from context7 is cheaper than the failed build it prevents. Never write against a recalled version. This extends past API signatures to framework runtime semantics - signal / computed reactivity, change-detection, lifecycle order: cite context7 or the house convention skill before resting correctness on a recalled semantic, never a guess.
- **superpowers on ambiguity.** Route the brainstorm discipline in before freezing a contract on genuinely ambiguous design; route the verify-before-done discipline to the closing seat (the domain verifier or the integration reviewer).
- **claude-md-management keeps the shared context sharp.** A flow that depends on a stale CLAUDE.md pays for it in every seat that loads it - audit and revise it with that tool rather than letting each seat work around drift.
- **ponytail and caveman** are the token-reduction disciplines, per `token-reduction.md` - the discipline, not the wiring, is what each role runs.

## Redundant reads

Two seats reading the same module is double cost. The memory handoff is what removes it: the implementer stores a compact note (findings, deviations, decisions) at hand-off, and the verifier reads that note plus the diff to orient - it does not re-read the whole module from raw files.

Retrieve that note by an EXACT feature + `contract_version` tag filter (a structured tag match on both - `contract_version` alone can be a bare `v2` that collides across features), never a semantic query on the feature words. The memory DB is shared across every project and account, so a semantic search is outranked by unrelated projects' memories and silently returns a miss - the seat then re-derives what the note already held, paying the double cost the handoff exists to remove. Treat a tag-filtered miss (not a low-ranked semantic hit) as 'no prior note'.

The safety floor holds regardless: the verifier still INDEPENDENTLY runs the build and the tests and serena-navigates the concerns the note names. It orients from the note; it never trusts the note in place of running the gate. An EXPENSIVE one-off proof the implementer already ran and recorded - a regression spec proven red against the pre-fix code, a captured repro - is CONFIRMED from that recorded artifact plus a spot check, not re-derived from scratch: the build and the test suite are always re-run, but the bespoke repro the note already proves is confirmed, not rebuilt. Same rule for the integration reviewer over the assembled whole - orient from the domain verifiers' notes and the diff, then run the assembled gates itself.

## The rule

Eager-load only the certain-use capability. serena symbol reads, never a whole-file `Read` of a large source - an implementer `find_symbol`s the exact edit target before Editing, never Reading a file to locate what serena can point to. A compact memory note read at start beats re-deriving prior findings. The capability that removes a guess or a pass pays for itself; one that does not is the same waste as an unused skill.
