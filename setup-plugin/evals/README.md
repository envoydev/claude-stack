# claude-stack plugin evals

`claude plugin eval setup-plugin` runs these cases against the plugin and again WITHOUT it, and
reports the delta. Every run is a real, billed model call on your own account.

## Why this suite exists at all

The standing excuse for not evaluating this plugin was that nothing in it is model-invocable: all
five commands and the router skill carry `disable-model-invocation`. That excuse is wrong. A case's
`prompt.md` is a USER turn, which is exactly how a manual-only command is invoked, so a read-only
walk makes a valid case - and its without-arm cannot resolve the command at all, which is the
cleanest delta a suite can produce.

Both cases are READ-ONLY by construction: neither grants `Bash`, `Write` or `Edit`, so no run can
install anything, and both fire in the run's empty sandbox working directory where there is no
install to change.

## The cases

| case | prompt | what it proves |
|---|---|---|
| `status-no-install` | `/claude-stack:status` | with nothing installed, the command says so and routes to `/claude-stack:setup` instead of rendering its fixed table shapes from the command body |
| `router-hands-back-one-command` | `/claude-stack` | the router reads the state, names ONE command, and does not start the walk itself |

## Last recorded run

2026-09-12, Claude Code 2.1.269, default model, `--judge-model claude-haiku-4-5`, 3 runs per arm.

| case | with | without | delta |
|---|---|---|---|
| `router-hands-back-one-command` | 1.00 | 0.00 | +1.00 |
| `status-no-install` | 1.00 | 0.33 | +0.67 |

Mean delta +0.83 over 12 runs, 112s, $0.84. The without-arm's one passing grader is
`no-invented-tables`, which a session with no plugin passes for free - it has no tables to invent.
Re-record this table whenever a command body changes; a delta that falls is the command losing its
own contract, and a `with` score under 1.00 is the command failing it outright.

## Running it

```bash
claude plugin eval setup-plugin --max-cost-usd 3 --judge-model claude-haiku-4-5
claude plugin eval setup-plugin --case status-no-install --runs 1 --ablation none   # iterate cheaply
```

Two things measured on 2.1.269 that the docs page does not spell out, so do not re-derive them: a
`regex` grader's `target` accepts `last_message` (the default) and `files`, and a plain string like
`final_message` fails case validation with `graders.N.target: Invalid input`; and `--max-cost-usd`
is checked BEFORE each run launches, so a ceiling below one run's cost still pays for the first one.

`results/` is gitignored - the artifact is machine-local and re-dated every run. The table above is
the part worth keeping.
