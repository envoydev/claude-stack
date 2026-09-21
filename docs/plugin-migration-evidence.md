# Plugin-native migration - Phase 0 spike evidence

Every row is a run, not a reading: the command, what came back, and the verdict the plan's PASS
condition gives it. A spike that was not run is reported NOT RUN, never implied as passing.

Harness: Claude Code 2.1.278 on macOS. Spike plugin `spike` 0.0.1, loaded with `--plugin-dir`, in a
throwaway git project under the session scratchpad.

**One deviation from the plan's Phase 0 preamble.** It asks for a throwaway `CLAUDE_CONFIG_DIR` so
nothing touches the real account dir. A throwaway config dir carries no credentials, so
`claude -p` answers `Not logged in - Please run /login` and measures nothing; looking for the
credential store to copy it is not something this run will do. The spikes therefore run against the
authenticated config dir, with the PROJECT still in the scratchpad. What this costs: the spike
sessions' own transcripts land under that config dir's `projects/` tree like any other session.
Nothing is installed into it - `--plugin-dir` loads the plugin for the one invocation.

---

## S1 preload naming - PASS

**Question.** Does a plugin agent's `skills:` frontmatter preload a plugin skill, under the BARE
skill name, the plugin-SCOPED name, or neither? And does a plugin agent resolve when dispatched by
its bare name?

**Setup.** Skill `alpha` whose body is `The passphrase is HERON-42`. Two agents, identical but for
one frontmatter line: `seat-bare` (`skills: alpha`) and `seat-scoped` (`skills: spike:alpha`). Both
`tools: Read`, `model: haiku` - no `Skill` tool, so a preload is the only route to the passphrase.

**Run 1 - what registers.**

```
claude --plugin-dir $S/plugin -p 'List every agent type available to you ...' --output-format json
```

```
claude, Explore, general-purpose, Plan, spike:seat-bare, spike:seat-scoped, statusline-setup
```

The skill registers as `spike:alpha`. Both agents register, plugin-scoped.

**Run 2 - the scoped preload.** Dispatch `spike:seat-scoped`, 'ask it for the passphrase, reply with
its answer only'. Result: `HERON-42`. The subagent transcript's only tool call is
`SubagentHandback` - no `Skill` call.

**Run 3 - the bare preload.** Dispatch `spike:seat-bare`, same prompt. Result: `HERON-42`. Same
transcript shape: `SubagentHandback` only, no `Skill` call.

**Run 4 - the bare AGENT name.** Dispatch with `subagent_type: seat-scoped`, no prefix, instructed
not to retry under another spelling:

```
Agent type 'seat-scoped' not found. Available agents: claude, Explore, general-purpose,
Plan, spike:seat-bare, spike:seat-scoped, statusline-setup
```

**Verdict: PASS.** The plan's condition was 'one form answers HERON-42 with no Skill tool call'.
BOTH forms do. Agents move to the plugin; they do not stay in the seed.

**What it settles for the build:**
- `skills:` in agent frontmatter may keep its bare spelling. The 43 seats need no rewrite of that
  line, which removes a whole edit pass from Phase 3.
- The DISPATCH surface does change: a plugin agent is addressable only as `<plugin>:<agent>`. Every
  place that names a bare seat name has to carry the prefix - the skills that dispatch seats, the
  trio protocol, and `guard-unapproved-dispatch.js`, whose `*-implementer` test is a bare-name match
  today.
- Hook matchers on `SubagentStart` / `SubagentStop` take the scoped identifier and are regexes, so
  they need anchoring: `^claude-stack:aspnet-implementer$`. `docs-session.js` is wired on both
  events and attributes writes per `agent_id`, so this is a Phase 2 edit, not a Phase 3 one.

**Docs check (same sitting, context7 `/websites/code_claude`):**
- `skills` on an agent: 'Array of skill names to preload into the agent context', and 'To preload
  Skills into the agent's context, use the `skills` field rather than listing `Skill` here'
  (agent-sdk/typescript, AgentDefinition).
- Plugin agent naming: 'For subagents shipped by a plugin, the agent type is the plugin-scoped
  identifier such as `my-plugin:reviewer`, not the bare frontmatter name. The colon places a
  plugin-scoped name on the regular-expression path, so anchor the matcher with `^` and `$` for an
  exact match' (hooks, SubagentStart).

---

## S2-S10 - NOT RUN

Not yet executed. One step per run, per the run prompt.
