---
name: create-ticket
description: "Generates a well-structured ticket in English from a raw description, for any issue tracker (Jira, Azure DevOps, GitHub Issues, GitLab, YouTrack): a bug report, a user story, an epic/initiative, or a technical task. Detects the type and routes to its template. Use whenever the user wants any kind of ticket created, even described casually or in Ukrainian - 'create a bug/story/epic/task ticket', 'create user story', 'create jira ticket'. Do NOT fire to write code or fix the bug rather than file it, to touch an existing ticket (query / update / comment / close), or for a commit / PR message."
---

# Create Ticket

Transforms a raw description into a clean, professional ticket written in English. Output is tracker-agnostic Markdown that pastes cleanly into Jira, Azure DevOps, GitHub, GitLab, or YouTrack.

## Pick the ticket type, then read its reference

Detect the type from the request, then read the matching reference file **before writing** - it carries the Description template, the type-specific rules, and a worked example.

| Type | Use when | Reference |
|---|---|---|
| **Bug** | something is broken - a defect, error, or regression | `references/bug.md` |
| **Story** | a user-facing capability or requirement | `references/story.md` |
| **Epic** | a large initiative spanning multiple stories / sprints | `references/epic.md` |
| **Task** | technical work that is not a bug or a user feature (refactor, performance, spike, migration, upgrade, cleanup) | `references/task.md` |

If the request is ambiguous, pick the closest type and note the assumption.

## Output Format

Always produce exactly two sections: **Title** and **Description**.

### Title

A single line. Must be:
- Concise (under 80 characters)
- Specific enough to understand at a glance without reading the description
- Phrased to fit the type - the reference shows the exact wording (bug = a statement of the problem; story / epic = a capability or outcome; task = an action or goal)
- Format: `[Area/Component] Short description`

### Description

Use the template in the type's reference file. Write in clear, professional English. Be concise - avoid filler.

## Rules (all types)

- **Language**: Always output in English, regardless of input language.
- **Tracker dialect**: Output Markdown by default - it pastes natively into GitHub, GitLab, and YouTrack, Jira Cloud converts it on paste, and Azure DevOps renders it once the large-text field is switched to Markdown. If the user names a specific tracker, adapt to its conventions (e.g. drop the `[Area]` title prefix when the tracker has a Component field that carries it).
- **Filing**: if an issue-tracker MCP is connected (e.g. Atlassian), offer to create the ticket directly after presenting it - title and description map 1:1. Never file without explicit confirmation.
- **Tone**: Neutral and factual. No emotional language, no blame. (For tasks, also technical and specific - no vague goals like "improve performance" without numbers.)
- **Assumptions**: If the description is vague, make reasonable assumptions and note them briefly - in the Problem section for bugs, the Notes section otherwise.
- **Format / delivery**: present the Description as raw, copy-pasteable Markdown inside one fenced block - headers (`##`) and symbols must stay literal, not rendered, since the user pastes it straight into the tracker. Inside it:
  - Do not hard-wrap prose - one paragraph is one line (full width); let the tracker wrap it.
  - Wrap identifiers, methods, paths, expressions, and error strings in inline code with backticks.
  - Avoid nested code fences and Markdown tables in the body; for a trace, call chain, or log excerpt use a bullet list (`- file:line - code`) under a plain lead-in line, annotating the key line inline (e.g. `← null deref`). The one sanctioned table is the task Baseline/Target metrics block (see `references/task.md`).
  - Use a normal dash `-`, never an em dash.
