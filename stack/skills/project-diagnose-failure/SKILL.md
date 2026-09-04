---
name: project-diagnose-failure
description: "Use to investigate a failure of any kind in THIS chat, from whatever evidence you actually have - a pasted Sentry event, one log file, several log sources at once, a red CI run, a stack trace, a screenshot, or nothing but a customer saying checkout is slow. Four gated steps: triage the evidence to a tier, gather (inline or evidence-gatherer seats), prove the root cause, then a user fork - write a report, plan the fix as contracted tasks, or add log points and re-run. Read-only throughout: it never writes the fix. Trigger on investigate this bug, diagnose this failure, what is causing this, look into this incident, triage this report. Not the fix build (project-solve-task takes the tasks from here), not a signature lookup you already have the answer for."
disable-model-invocation: true
---

# Diagnose Failure - one entry for any failure evidence

One reported failure, four steps, the user holds the gate between them. This skill owns the
chain, the stops, the evidence accounting, and the fork at the end; the catalogues and the
seats do the specialist work. It is READ-ONLY from start to finish - no step here writes code,
so no approval stamp and no commit gate come into play.

## Evidence tiers - name the tier, carry it as the confidence label

The tier is the first thing this skill establishes and the last thing its verdict is qualified
by. No source is a lower tier, never a blocker:

| Tier | What you have | What it buys |
|---|---|---|
| 1 | stack trace / exception with a frame, or a failing test | a symbol to start at |
| 2 | a log window around the failure, a red CI run, a monitoring event | a time-ordered sequence |
| 3 | reproducible steps a human wrote down | a repro you can run |
| 4 | a screenshot, a single symptom line, a prose report from a client | a behaviour to locate in code |

A tier-4 report is the DEFAULT case, not an edge case: most projects have no CI, no error
monitoring, and no retained logs. There, step 2 turns prose into an observable and works
code-first - locate the named behaviour, read the paths that could produce the symptom, try to
reproduce - and the verdict says plainly which tier it rests on. A conclusion drawn at tier 4
is labelled as such; it is never presented with tier-1 confidence.

## Sources - what this skill can reach

- **In reach, always:** files and logs on disk, the repo's own history, anything the user pastes
  into the chat, and the app itself when it can be run locally.
- **In reach when the project has it:** the `gh` CLI for a red pipeline; an error-monitoring MCP
  where the project registered one (the baseline comments out the MCPs a project does not need,
  so it can simply be absent from your tool list here).
- **Never in reach:** a LINK. A monitoring-issue URL, a private dashboard, a ticket - if no tool
  in this session can fetch it, say so in one line and ask the user to paste the event, rather
  than guessing what it contained.

## State - two layers, split by durability

- **The findings file** (`<docs-path>/diagnoses/<slug>.md`) is the durable truth: the failure as
  an observable, the evidence tier, every digest's key lines, the hypotheses with their verdicts,
  the proven cause, and the stamps this run adds (`Tier`, `Gathered`, `Cause`, `Outcome`). On any
  conflict with memory or the chat, the file wins.
- **The serena note** (`write_memory` named `<slug>__diagnosis`) is the working cursor: current
  step, chosen mode, resume pointer, the error signature and its proven fix once found - that
  last part is the reusable half, keyed to the signature, never a dump of the log.

**On invocation, resume before starting:** `list_memories` -> `read_memory` the slug's note (or
an equivalent direct read of `.serena/memories/`) and read the findings file's stamps. A run
mid-flight resumes at its cursor - never re-run a step already stamped. A run between steps 2
and 3 looks like:

```
findings .claude/docs/diagnoses/orders-sync-disposed.md:
  Observable: nightly order sync stops after the first batch; expected all batches
  Tier: 1 (ObjectDisposedException, frame OrderSyncJob.ExecuteAsync) | Gathered: 2 sources agree
  Cause: <pending>
note 'orders-sync-disposed__diagnosis': step 3 ROOT CAUSE - mode inline, 1 hypothesis open
```

## Mode - ask at start

When dispatch is available, ask ONE question before the evidence pass, via AskUserQuestion -
gather through evidence-gatherer seats, or inline in this session? - unless a calling flow
already picked the run's mode, which is inherited, never re-asked. Recommend the seats when the
evidence is BIG or MANY (a multi-megabyte log, a CI dump, three sources to correlate): the
whole point of that seat is that the raw volume never lands in this context. Recommend inline
when a single command or a bounded grep settles it. An interrupted or declined ask is answered
by RE-ASKING, never by inference.

## The stop contract

A stop IS one AskUserQuestion call: report one line of result and the artifact path, then put
the next move through the AskUserQuestion tool - EVERY stop, the plain step-done ones included.
There is no non-decision stop: 'what happens next' is itself the decision. The options are
concrete - the next step named, the route-back where a step surfaced gaps, the fresh-session
resume on a long run - the recommendation marked per that stop's own rule, free text always
available via the built-in Other. Where the harness has no such tool, list the same options in
plain text and END THE TURN. The selected answer is the go; silence is not, and a stop that
only narrates is not a stop. Once the run has crossed roughly 150k ctx per message or spans
hours, the fresh-session resume IS one of the next ask's options - a CONSTRUCTION check before
emitting each stop, not a memory: resume needs only the findings file plus the note.

## The steps

Each step that names a catalogue INVOKES it via the Skill tool - and re-invokes it in a new
cycle in the same chat, even when an earlier cycle already loaded it.

1. **TRIAGE** - read the evidence in whatever form it arrived (`Read` opens a screenshot as
   readily as a log), restate the failure as an OBSERVABLE - what happened, where, what should
   have happened instead - and name the tier from the table above. Then load the signature
   catalogue that matches the failure's origin, matched from YOUR skill list by what each skill
   says it covers, never by a remembered name: the one covering local-runtime crash signatures
   (null-reference, DI resolution, async deadlock, race, disposed lifecycle, config drift) for a
   failure on your own machine, the one covering red-pipeline signatures (compile/restore,
   green-locally-red-on-the-runner, quality gate, signing, workflow drift, infra flake) for a
   red CI run. Nothing matching means this project installed no such catalogue - say so and
   proceed on the method alone. **A red pipeline is the one route that leaves this skill:** CI
   needs the `gh` log pull and the CI-versus-local environment delta, which is
   ci-failure-diagnoser's specialty - offer that dispatch as the recommended option at this
   stop rather than re-deriving it here. Write the findings file with the observable and
   `Tier: <n>`. *Stop.*
2. **GATHER** - per the mode: dispatch one evidence-gatherer per source (reproduce this path,
   pull and grep that log window, capture that screen), several in parallel when several
   hypotheses need confirming, and reason over the compact digests they return; or run the
   bounded commands inline. Correlate multiple sources on a shared key - a correlation/trace id,
   a timestamp window, a release version - and say which sources agreed and which did not. At
   tier 4, with no source to pull, this step is code-first instead: locate the named behaviour
   with serena per `.claude/rules/baseline-navigation.md`, read the paths that could produce the
   symptom, and attempt a repro. Never slurp a large log into this context - grep to the signal
   and quote a bounded window. If it cannot be reproduced, say so with what you tried, and work
   from the evidence and the code. Append the digests' key lines to the findings file and stamp
   `Gathered:`. *Stop.*
3. **ROOT CAUSE** - run the investigation through the hypothesis-and-test method
   (`superpowers:systematic-debugging`): form the fewest hypotheses the evidence supports, then
   confirm or kill each against the located code and the reproduction - root cause before
   symptom, never a plausible guess. Match the evidence to the catalogue's signature and isolate
   where the signature points, which is almost never the line that threw. **Hard cap: 2
   investigation passes.** If the cause stays ambiguous after 2, stop guessing and record the
   surviving hypotheses RANKED with what would decide between each. Stamp `Cause:` with the
   file + symbol and the evidence that proves it, or `Cause: unproven - <n> hypotheses ranked`.
   Report a severity and an explicit P0-P3 priority when the ask was to level it rather than fix
   it. **This step ends at the fork below - it never continues into planning on its own.**
4. **THE FORK** - the step-3 stop asks ONE question whose options are the three real outcomes,
   each named concretely. The recommendation is set by whether step 3 actually proved a cause -
   proven recommends 4b, unproven recommends 4c - with the reason in the option's description:
   - **4a. REPORT** ('Write a report on the issue') - finish the findings file as a standalone
     document: the observable, the evidence tier, the proven cause with its located symbol, the
     blast radius and who it affects, severity + priority, and what a fix would have to change.
     No task cards. This is the outcome when the fix is someone else's, or not now.
   - **4b. PLAN TASKS** ('Plan the fix as tasks') - decompose the minimal change per cause into
     independent tasks, each with a contract: the files it owns, what it must not touch, its
     acceptance criterion, and the `log_points` the fix must leave behind at the seam that
     failed. Name the target stack per task. The cards go into the findings file under a
     `## Tasks` heading - the file is the handoff, not the chat. The build is the user's next
     step, never yours: the close-out names `/project-solve-task` with the findings path as its
     input (it is slash-only - a model Skill call is refused - and its DESIGN step turns these
     cards into the gated plan). If the real fix is a redesign rather than a targeted change,
     say so and make that stack's solution-designer the option's route instead of planning it
     here; if it would change a shared contract, mark it BLOCKED_CONTRACT_CHANGE rather than
     planning a silent edit.
   - **4c. INSTRUMENT** ('Add log points and re-run') - the outcome that turns 'no evidence' into
     work instead of a guess: ONE task card carrying only the log points to add at the suspect
     seam - the exact symbols, the levels, and the identifiers each line must carry - so the next
     occurrence arrives one tier higher. Name the hypothesis each line is there to decide.
   Stamp `Outcome:` with the branch taken. *Stop* - and this close-out stop carries anything
   pending: an unwritten task card, a source the user still has to paste, a sibling repo that
   needs the same fix (that handoff is a FILE - a task card under `<docs-path>/cross-project-tasks/`
   - never chat-only prose). Delete the serena cursor note; keep the signature-to-fix note if the
   cause was proven, that is the reusable half.

## Do not

- Never pass a stop without the user's explicit word, and never take the fork yourself - step 4
  runs the branch the USER picked, and 'obviously they want the fix' is not an answer.
- Never end a stop's turn without its AskUserQuestion (or the plain-text fallback's option list).
- Never write code, edit a file under test, or run a destructive repro - one that applies a
  migration against a real database, seeds or deletes tracked files, or commits. If the only
  repro is destructive, say so and stop.
- Never present a tier-3 or tier-4 conclusion with tier-1 confidence, and never report a cause
  you did not prove as the answer - an honest 'unproven, here is what would decide it' with the
  4c instrumentation card beats a plausible guess that sends the fix at the wrong symbol.
- Never state a source was checked that you could not reach - an unfetchable link, an absent
  monitoring MCP, and a log the project does not retain are each named, not silently skipped.
- Never keep run state only in chat: a stamp that is not in the findings file does not exist.
