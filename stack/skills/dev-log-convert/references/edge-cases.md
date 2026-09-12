# Per-input-shape rules

These fire on the SHAPE of the input, not on every run: the status signal a day's context implies, the investigation sentence a same-day fix earns, and the edge cases. Read this at the drafting step, before writing the first day.

## Completion signals
- If context indicates a task was tested/verified but not yet merged, append `Testing.` - only if the summary does not already mention testing or verification.
- If context indicates a task is fully done and merged, append `Testing. Merged changes.` - only if the summary does not already mention those actions.
- Other status markers that may appear when context warrants: `In progress.`, `Created merge request.`, `Code review.`. Use only when the input clearly signals that state; do not invent them.
- Do not append a signal that duplicates information already present in the summary.

## Implicit investigation
- If a task was fully completed within the day (a fix applied or a feature fully implemented in that single day) and the input contains no mention of investigation, analysis, or research, open the summary with `Investigated <brief topic>.` followed by the fix/implementation sentence - a task diagnosed and fixed inside one day always began with finding the cause, and the log should credit that work even when the notes skip it.
- Do not add this when: the task is ongoing across multiple days, the summary already starts with an investigation verb, or the input explicitly mentions investigation/analysis.

## Edge cases
- Relative dates (`today`, `yesterday`, `сьогодні`, `вчора`): resolve to absolute `dd.mm.yyyy` using today's date (Mon-Sun, no weekend skip).
- Same ticket spanning multiple days: write a separate line under each day with that day's time only. Do not sum across days.
- Day with no work (vacation, sick leave, public holiday): output the day header followed by a single line `Off (<reason>).` and skip `Total time`.
- Input mentions a task but provides no action verb: prefix with `Worked on` (English) or `Працював над` (Ukrainian).
- Time mismatch (bullets sum to a different total than the input's stated total): trust the bullets, recompute `Total time` from them, do not echo the input's total.
