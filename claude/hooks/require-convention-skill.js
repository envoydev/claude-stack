#!/usr/bin/env node
// PreToolUse gate: block an edit to a convention-governed file type until EVERY
// owning convention skill is loaded this session. Reads the tool-call JSON on
// stdin; exit 2 blocks (stderr fed back to the model), exit 0 allows. Covers the
// direct Edit/Write tools AND every serena file-mutating tool the installer wires into
// the matcher (the symbol edits replace_symbol_body / insert_after|before_symbol, the
// line edits replace_lines / delete_lines / insert_at_line, plus create_text_file,
// replace_content/replace_regex, and rename_symbol). The path is read from
// tool_input.file_path OR .relative_path (serena uses the latter) - so an edit through
// ANY of serena's editors cannot slip the gate that a plain Edit would hit.
//
// The active table is the MERGE of one or more required variant keys, passed as
// CLI args (each a key in TABLES). At least one is required - no implicit
// default; unknown keys are ignored; zero valid keys gates nothing. e.g.:
//   "…/require-convention-skill.js cs"      -> C# only (.cs)
//   "…/require-convention-skill.js ts ng"   -> TypeScript (.ts) AND Angular (.component.ts &c.)
//   "…/require-convention-skill.js cs ng"   -> C# (.cs) AND Angular (.component.ts &c.)
//
// A file may match SEVERAL suffixes at once; the gate requires the UNION of
// their skills. With "ts ng": 'order-list.component.ts' matches '.ts'
// (-> typescript) and '.component.ts' (-> angular-conventions) - both must
// be loaded before the edit. A table therefore lists ONLY the skill its own
// suffix implies, never a companion that another suffix already covers.
//
// A suffix belongs in a table when it implies a house skill that must be loaded,
// AND that skill is enabled in every repo where the suffix occurs (else the edit
// deadlocks - a disabled skill can't be loaded to satisfy the gate). Two layers
// can apply to the same file and compose via the union:
//   - LANGUAGE baseline - suffix-pure regardless of framework: every
//     .ts/.tsx/.js/.jsx/.mjs/.cjs implies 'typescript' (the 'ts' table);
//     every .cs implies 'csharp' (the 'cs' table).
//   - FRAMEWORK layer - NOT pure on a bare suffix (an Angular .ts vs a Node .ts
//     vs an extension .ts), so it keys on COMPOUND suffixes that do imply one
//     framework: '.component.ts'/'.service.ts' &c. -> Angular ('ng').
// Union then composes them: with "ts ng", 'foo.component.ts' requires BOTH
// typescript (language) AND angular-conventions (framework);
// a plain 'foo.ts' requires just typescript. A bare '.html' stays
// ungated (Angular template vs static page is genuinely ambiguous and there's no
// language-baseline skill for it).
//
// Known, deliberate gaps (do NOT silently 'fix'): (1) edits made through Bash (sed -i,
// cat > foo.cs, > foo.cs) are not gated - matching arbitrary shell writes is brittle and
// false-positive-prone, so the gate covers the idiomatic editors only (Edit/Write + the
// serena mutators above); (2) 'loaded' means the Skill was invoked this session, not that
// its guidance is still in the live context window after a summarization - a PreToolUse
// hook cannot see the window. Both are accepted limitations, not bugs.
'use strict';
const fs = require('fs');

// Named suffix->skills tables. Select one or more by CLI args (e.g. "cs ng").
const TABLES = {
    cs: { '.cs': ['csharp'] },
    sql: { '.sql': ['database-conventions'] }, // hand-written SQL only; ORM-in-.cs is a CLAUDE.md route
    // Language baseline for ALL TypeScript/JavaScript, framework-agnostic. Composes with 'ng' via
    // union: a '.component.ts' gets both typescript and angular-conventions.
    // A '.spec.ts' matches '.ts' here (gets the language baseline) but not the Angular 'ng' entries.
    ts: {
        '.ts': ['typescript'],
        '.tsx': ['typescript'],
        '.js': ['typescript'],
        '.jsx': ['typescript'],
        '.mjs': ['typescript'],
        '.cjs': ['typescript'],
    },
    // Angular's compound suffixes imply the framework on their own (the 'ts' table carries the
    // language baseline). Bare .html stays ungated (Angular template vs static page is ambiguous).
    // '.module.ts' is deliberately absent: standalone is the Angular default, so a *.module.ts is
    // no reliable Angular signal and collides with NestJS (also *.module.ts) - it would over-gate.
    ng: {
        '.component.ts': ['angular-conventions'],
        '.service.ts': ['angular-conventions'],
        '.directive.ts': ['angular-conventions'],
        '.pipe.ts': ['angular-conventions'],
        '.guard.ts': ['angular-conventions'],
        '.resolver.ts': ['angular-conventions'],
        '.interceptor.ts': ['angular-conventions'],
        '.component.html': ['angular-conventions'],
    },
};

// Merge the tables for every valid variant key; duplicate suffixes concatenate
// their skill lists rather than clobbering each other.
function mergeTables(keys)
{
    const merged = {};
    for (const key of keys)
    {
        const table = TABLES[key];
        if (!table)
        {
            continue;
        }

        for (const [suffix, owners] of Object.entries(table))
        {
            merged[suffix] = [...(merged[suffix] ?? []), ...owners];
        }
    }

    return merged;
}

// Union of skills across ALL suffixes the file matches (not first-match-wins).
// Match case-insensitively (suffixes in TABLES are lowercase) so a '.CS' / '.TS' on a
// case-insensitive filesystem - macOS, Windows - cannot evade the gate by casing.
function requiredSkills(table, file)
{
    const lower = file.toLowerCase();
    const skills = new Set();
    for (const [suffix, owners] of Object.entries(table))
    {
        if (lower.endsWith(suffix))
        {
            for (const skill of owners)
            {
                skills.add(skill);
            }
        }
    }

    return [...skills];
}

// Collect every skill invoked via a Skill tool call this session, in ONE pass over the
// transcript (vs re-scanning per required skill). Structural check: an ASSISTANT-role
// message whose content[] holds a tool_use named "Skill" with a string input.skill. The
// role filter matters: only the assistant emits real tool_use blocks, so a user message
// that merely quotes a tool_use shape - or a plain-text mention of the skill anywhere in
// chat - can never satisfy the gate. Returns the set of loaded skill names.
function loadedSkills(text)
{
    const loaded = new Set();
    if (!text.includes('"Skill"'))
    {
        return loaded; // fast reject: no Skill tool call appears anywhere
    }

    for (const line of text.split('\n'))
    {
        if (!line.includes('"Skill"'))
        {
            continue; // only lines naming the Skill tool can carry a load
        }

        let obj;
        try
        {
            obj = JSON.parse(line);
        }
        catch
        {
            continue; // skip partial / non-JSON lines
        }

        const message = obj?.message;
        if (message?.role !== 'assistant' || !Array.isArray(message.content))
        {
            continue; // only assistant-role messages carry genuine tool_use blocks
        }

        for (const block of message.content)
        {
            if (block?.type === 'tool_use' && block?.name === 'Skill' && typeof block?.input?.skill === 'string')
            {
                loaded.add(block.input.skill);
            }
        }
    }

    return loaded;
}

function main()
{
    const table = mergeTables(process.argv.slice(2));
    if (Object.keys(table).length === 0)
    {
        process.exit(0); // at least one valid variant key is required - none -> gate nothing
    }

    let payload;
    try
    {
        payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    }
    catch
    {
        process.exit(0); // can't parse hook input -> don't block on a harness malfunction
    }

    const file = payload?.tool_input?.file_path ?? payload?.tool_input?.relative_path ?? '';
    const skills = requiredSkills(table, file);
    if (skills.length === 0)
    {
        process.exit(0); // no convention skill governs this file type
    }

    const transcript = payload?.transcript_path ?? '';
    let text = '';
    if (transcript)
    {
        try
        {
            text = fs.readFileSync(transcript, 'utf8');
        }
        catch
        {
            text = ''; // unreadable / missing -> treat as nothing loaded (fail closed)
        }
    }

    const loaded = loadedSkills(text);
    const missing = skills.filter(skill => !loaded.has(skill));
    if (missing.length === 0)
    {
        process.exit(0);
    }

    const plural = missing.length > 1 ? 's' : '';
    process.stderr.write(`Load the ${missing.join(' and ')} skill${plural} before editing ${file} - conventions are the source of truth, not recall.\n`);
    process.exit(2);
}

main();
