# PROJECT-CODE-STYLE.md - the merged doc's shape

Read at step 3 MERGE, before the doc is written. The seats' per-language reports are the input;
this is the shape they are consolidated into, in this order. Apply the `markdown-style` skill to
the result - it is a quick reference, not a wall of prose.

1. **One opening line** - the project's actual style; configs stay enforced; this captures what
   they cannot; where this doc and a house convention skill disagree, THIS doc wins.
2. **Project type** - the consolidated verdict from the seats' evidence.
3. **Enforcement map** - one table across languages: language -> config file(s) -> what runs them.
4. **Per language** - each seat's Enforced + Idioms sections, merged faithfully: keep every
   'uncertain' / 'inconsistent' marker, never smooth one over, and keep the divergence-from-house-skill
   flags - they are the useful signal.
5. **Cross-cutting idioms** - what spans languages: file/folder organization, test structure and
   naming, comment density.

**A re-run** reconciles the existing doc against the fresh reports - correct what drifted, add
what is new, drop what is gone. Never a parallel second doc, and never an append log.
