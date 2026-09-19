---
description: House baseline - what belongs in shared memory. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Shared memory

## What memory is for

Project truth lives in the docs domains (`baseline-docs-root.md` names the root); memory holds what
they do not - preferences, corrections, lessons. It is cross-project, not a second copy of a project's
documented facts.

## What to save

- The user corrects you, states a preference, or you learn a project fact no docs domain already
  holds: save it with `memory_store`. Set `metadata.type` to the kind - `preference`, `correction`, or
  `project-fact`. Tag `project:<name>` (the repo's folder name) - except a preference that holds in
  every project, which carries no project tag.
- An agent saves only a lesson worth keeping past its own task - a build quirk, a fix that worked, a
  trap - typed `lesson`, tagged `agent:<agent-name>` and `project:<name>`. Task progress and handoffs
  go to serena's memory, never here.

## Before you ask or read

- Search with `memory_search` before asking the user something they may already have told you.
- Search by a related project's name before reading that project's repo.

## Tools

The `memory` MCP's tools are DEFERRED behind tool search in this harness - naming them is not having
them. Load the three above with one call:
`ToolSearch select:mcp__memory__memory_store,mcp__memory__memory_search,mcp__memory__memory_list`.
