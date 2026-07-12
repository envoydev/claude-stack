---
name: dev-log-convert
description: "Converts a day's raw work notes (Ukrainian, English, or mixed) into a structured, past-tense English work log - ticket IDs normalized, time totalled, tasks grouped by project or prefix across one or more days. Fires only on the exact keyword 'dev-log' - do not use it for general note-taking, meeting minutes, commit messages, or status updates, which are not this format."
---

You will receive text (Ukrainian, English, or mixed) describing work done during one or more days. Convert it into a concise English work log written in past tense.

## Ticket IDs

A ticket ID matches the pattern `[A-Z][A-Z0-9]*-\d+` (one or more uppercase letters/digits, a dash, then digits). Examples: `ABC-123`, `PROJ7-4521`.

- Output ticket IDs in uppercase, even if the input used lowercase.
- Silently correct obvious typos in prefixes (e.g. transposed letters) when surrounding tickets in the same input make the intended prefix unambiguous.
- If a task has no ticket, use `Other` as the ticket ID.

## Output format

### Single-prefix day

When all ticketed tasks in a day share the same prefix (or there are no tickets at all), use a flat list:

```
Log of work <dd.mm.yyyy>.

<Day of week>:
1 <TICKET-ID> (<time>) - <Summary sentence(s).>
2 <TICKET-ID> (<time>) - <Summary sentence(s).>
3 Other (<time>) - <Summary.>
Total time: <sum>.
```

### Multi-prefix day

When ticketed tasks in a day use two or more different prefixes, group them. Numbering restarts within each group.

```
Log of work <dd.mm.yyyy>.

<Day of week>:

<GROUP_LABEL_1>:
1 <TICKET-ID> (<time>) - <Summary.>
2 Other (<time>) - <Summary.>

<GROUP_LABEL_2>:
1 <TICKET-ID> (<time>) - <Summary.>

Total time: <sum across all groups>.
```

**Group label rules**
- If the input explicitly names a project for a set of tasks (e.g. 'Today on ProjectX:' or 'ProjectX - APV49-...'), use that name as the group label.
- Otherwise, use the ticket prefix itself as the label.
- If the input declares that several distinct prefixes belong to one project, treat them as one group under that project name.
- `Other` items go under the group whose tasks they were mentioned alongside in the input. If `Other` items have no clear group, place them under a final `Other` group.

**Ordering**
- Order groups by total time spent that day, largest first.
- Within a group: ticketed tasks first (largest time first), then `Other` items.
- The date in the title is today's date in `dd.mm.yyyy` format.

## Rules

**Language**
- Default output language is English.
- If the input is entirely in English, keep the output in English.
- If the input is in Ukrainian or mixed Ukrainian/English, translate everything to English by default.
- If the user explicitly asks to keep the output in Ukrainian (e.g. 'keep in Ukrainian', 'залиш українською', 'не перекладай', 'output in Ukrainian'), produce the log in Ukrainian instead. In that case, translate any English fragments in the input to Ukrainian for consistency. This preference applies only to the current request unless the user says otherwise.
- Never use Russian under any circumstances.
- Use past tense only.
- Each task summary is 1-2 short sentences.
- Use a normal dash `-` instead of an em dash.
- Use straight double quotes `" "` only - do not use curly quotes.
- Replace semicolons with a full stop and start a new sentence.

**Line format**
- Ticket ID comes first on each task line, then time in brackets, then dash, then summary.

**Time**
- Normalize time to `h` for hours and `m` for minutes (e.g. `2h`, `30m`, `1h 30m`).
- Accept Ukrainian variants in input: `г`, `год`, `гг`, `хв`, `хвил` - treat as hours/minutes accordingly.
- Accept decimal hours in input and convert: `0.25h` → `15m`, `0.5h` → `30m`, `0.75h` → `45m`, `1.25h` → `1h 15m`, `2.5h` → `2h 30m`.
- If time is not provided for a task, write `(time not specified)`.
- Self-check before output: re-add each day's task times and confirm the sum equals the printed `Total time` (a `(time not specified)` line counts as zero); on a mismatch, recompute the total from the task lines - never print an unverified sum.

**Task grouping within a day**
- Keep only the main points - no extra explanations, no step-by-step process.
- Merge or group similar items so each day has only the key tasks.
- If the same ticket appears multiple times in one day, keep separate lines if they represent different work blocks or branches; otherwise merge them and sum the time.

**Completion signals**
- If context indicates a task was tested/verified but not yet merged, append `Testing.` - only if the summary does not already mention testing or verification.
- If context indicates a task is fully done and merged, append `Testing. Merged changes.` - only if the summary does not already mention those actions.
- Other status markers that may appear when context warrants: `In progress.`, `Created merge request.`, `Code review.`. Use only when the input clearly signals that state; do not invent them.
- Do not append a signal that duplicates information already present in the summary.

**Implicit investigation**
- If a task was fully completed within the day (a fix applied or a feature fully implemented in that single day) and the input contains no mention of investigation, analysis, or research, open the summary with `Investigated <brief topic>.` followed by the fix/implementation sentence - a task diagnosed and fixed inside one day always began with finding the cause, and the log should credit that work even when the notes skip it.
- Do not add this when: the task is ongoing across multiple days, the summary already starts with an investigation verb, or the input explicitly mentions investigation/analysis.

**Multiple days**
- If input contains multiple days, output each day as a separate section in the same response.
- If a day of week is not provided, write `Day not specified`.

**Edge cases**
- Relative dates (`today`, `yesterday`, `сьогодні`, `вчора`): resolve to absolute `dd.mm.yyyy` using today's date (Mon-Sun, no weekend skip).
- Same ticket spanning multiple days: write a separate line under each day with that day's time only. Do not sum across days.
- Day with no work (vacation, sick leave, public holiday): output the day header followed by a single line `Off (<reason>).` and skip `Total time`.
- Input mentions a task but provides no action verb: prefix with `Worked on` (English) or `Працював над` (Ukrainian).
- Time mismatch (bullets sum to a different total than the input's stated total): trust the bullets, recompute `Total time` from them, do not echo the input's total.
- Pure non-work entries that aren't a ticket and aren't a recurring item (lunch, coffee break): omit entirely. Personal life is not in the log.

## Style guidance

Open each summary with a past-tense verb, and render recurring non-ticket items (standups, weekly calls, merge request review - always `Other`) in a consistent canonical form matched to the input phrasing. The preferred verb openers and the canonical-form patterns: `references/style-guidance.md`.

## Examples

### Example 1 - single prefix, Ukrainian input

Input:
> Понеділок: ABC-1319 - 2г досліджував проблему з ротацією культур по ID поля, виправив обробку відсутніх записів, протестував. ABC-1320 - 30хв створив merge request. Нарада з командою - 1г.

Output:
```
Log of work 13.04.2026.

Monday:
1 ABC-1319 (2h) - Investigated a crop rotation issue by field ID. Fixed missing record handling and tested the change. Testing. Merged changes.
2 ABC-1320 (30m) - Created a merge request.
3 Other (1h) - Attended team meeting.
Total time: 3h 30m.
```

More worked examples - a multi-prefix day grouped by ticket prefix, and a multi-project day with explicit labels: `references/examples.md`.

## Output presentation

Always wrap the final log in a fenced code block (triple backticks, no language tag). This ensures formatting markup is visible and a copy button appears in the UI.
