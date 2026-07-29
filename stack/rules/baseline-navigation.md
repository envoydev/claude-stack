---
description: House baseline - code navigation and reading. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Navigation and code reading

- Read only what's needed; before editing, read the body end-to-end and any function it depends on.
- Locate symbols, callers, and resolved types with `serena` - inline, never delegated to `Explore` / `general-purpose`; reserve those for genuinely broad multi-file sweeps. An installed `LSP` plugin adds compiler-exact lookups and inline diagnostics for its language.
- If `serena`'s language server can't resolve a symbol - a large or SDK-heavy solution where it indexes slowly or not at all (notably C# / Roslyn) - fall back to the installed `LSP` plugin for that language for the lookup. `serena` still owns symbol edits and the memory handoff, neither of which depends on its language server.
- serena is the cheap path only while the symbol is small: for a large body, fetch the symbol WITHOUT its body first (signature/children), then Read the range you need - a multi-thousand-token symbol body costs more than the ranged Read it was meant to avoid.
- `get_symbols_overview` takes ONE file, never a directory - enumerate a module with a directory listing or Glob first, then overview the files that matter (a directory call only errors and costs the round trip).
- On C# pass `depth: 2` to `get_symbols_overview` - the default stops at the file's top-level symbol, in C# the NAMESPACE, so it returns only the namespace name. 2 reaches type members (names only - stays cheap); nested-type members need one more; a top-level-statements file returns `{}` at any depth.
- Never fetch what is already in context: no repeat `find_symbol` for a symbol fetched this session, no re-`Read` of a file or range already in context and unchanged since - re-check an edit at the edited range only.
- Ambiguous reference with multiple matches: list the matches, ask. Do not guess.
- Pasted code in chat is illustrative unless stated otherwise; confirm the target file before editing.
