#!/usr/bin/env node
// Repo lint: keep the registration surfaces and all cross-skill references in
// sync. The installer is split per agent into four manifests:
//   claude/claude-stack.{sh,ps1}  and  cursor/cursor-stack.{sh,ps1}
// SKILLS and MCPS are SHARED (must be identical across all four); PLUGINS are
// claude-only (claude-stack.sh must equal claude-stack.ps1; cursor carries none).
// Catches the failure modes that actually happen:
//   1. a skill directory exists but is missing from a manifest or the README
//      index (it would silently never install);
//   2. a SKILL.md references a skill name that does not exist anywhere (typo or
//      rename rot, e.g. `vertical-slice` vs `vertical-slice-architecture`);
//   3. a SKILL.md frontmatter block that js-yaml (the parser skills.sh uses)
//      cannot load, which silently drops the skill from the registry, e.g. an
//      unquoted `description:` containing `Companion: ` (colon-space);
//   4. drift between the four manifests, or between them and the stack HTML;
//   5. headline Skills/Plugins/MCP/Hooks/Agents/Rules counts in the per-agent
//      READMEs drifting from the actual installer/on-disk set sizes (those prose
//      numbers can no longer lie);
//   6. a backticked skill name that resolves to nothing - scanned in skill files,
//      claude/agents/*.md subagents, AND the base templates + cursor rules + claude rules
//      (CLAUDE.template.md / AGENTS.template.md / cursor/rules/*.mdc / claude/rules/*.md),
//      where a renamed skill would otherwise rot silently; tokens there resolve against
//      skills + plugins + MCPs + agent names + NON_SKILL_TOKENS;
//   7. a false 'Vendored from' label on a house dotnet-* skill (they are
//      original work; honest 'Adapted from'/attribution is allowed);
//   8. the claude and cursor installers listing the SKILLS block in a DIFFERENT
//      ORDER (not just a different set);
//   9. the on-disk claude/agents/*.md set diverging from the agents the
//      installers fetch (the AGENTS manifest array) - same check for cursor/agents/*.md
//      against the CURSOR_AGENTS manifest in BOTH cursor-stack.{sh,ps1}.
// Also verifies the require-convention-skill hook only demands skills that exist,
// that every NON_SKILL_TOKENS allowlist entry is still actually used (no dead
// config), that claude/rules/*.md + claude/agents/*.md frontmatter parses as
// strict YAML with the required keys (an unquoted ': ' scalar breaks GitHub
// rendering and strict parsers - the skills already get this via check 1),
// and warns (soft) on over-long SKILL.md descriptions.
// Needs js-yaml (run `npm install` once). Run: node scripts/lint-skills.js
//   -> exit 0 clean (warnings allowed), 1 with findings.
'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const CLAUDE_SH = path.join(ROOT, 'claude', 'claude-stack.sh');
const CLAUDE_PS1 = path.join(ROOT, 'claude', 'claude-stack.ps1');
const CURSOR_SH = path.join(ROOT, 'cursor', 'cursor-stack.sh');
const CURSOR_PS1 = path.join(ROOT, 'cursor', 'cursor-stack.ps1');
const README = path.join(ROOT, 'README.md');
const CLAUDE_README = path.join(ROOT, 'claude', 'README.md');
const CURSOR_README = path.join(ROOT, 'cursor', 'README.md');
const STACK_HTML = path.join(ROOT, 'claude', 'claude-stack.html');
const CURSOR_STACK_HTML = path.join(ROOT, 'cursor', 'cursor-stack.html');
const AGENTS_DIR = path.join(ROOT, 'claude', 'agents');
const CURSOR_AGENTS_DIR = path.join(ROOT, 'cursor', 'agents');
const CLAUDE_TEMPLATE = path.join(ROOT, 'claude', 'CLAUDE.template.md');
const CURSOR_TEMPLATE = path.join(ROOT, 'cursor', 'AGENTS.template.md');
const CURSOR_RULES_DIR = path.join(ROOT, 'cursor', 'rules');
const CLAUDE_RULES_DIR = path.join(ROOT, 'claude', 'rules');
const CONVENTION_HOOK = path.join(ROOT, 'claude', 'hooks', 'require-convention-skill.js');
const PLUGIN_MARKETPLACE_URLS = new Set([
    'https://github.com/anthropics/claude-plugins-official',
    'https://github.com/jarrodwatts/claude-hud',
    'https://github.com/DietrichGebert/ponytail',
]);

// Backticked kebab-case tokens that look like skill names but are not
// (code identifiers, example selectors). Extend when lint flags a false positive.
// Every entry here MUST appear as a backtick in some skill file (check 11 fails
// any dead entry), so this stays an exact, self-pruning allowlist.
const NON_SKILL_TOKENS = new Set([
    'app-order-list', // Angular selector example in angular-conventions
    'order-list',     // Angular selector example in angular-conventions
    'axe-core',       // a11y testing package in angular-conventions, not a skill
    'jest-axe',       // a11y testing package in angular-conventions, not a skill
    // old Angular Material button directive selectors named in angular-material's
    // v20 migration note (matButton replaced them) - code identifiers, not skills.
    'mat-button',
    'mat-raised-button',
    'mat-flat-button',
    'mat-stroked-button',
    // Claude Code SKILL.md frontmatter field (manual-only skills), backticked in
    // prose in project-task-flow + the base template - a field name, not a skill.
    'disable-model-invocation',
    // the two GENERATED per-project awareness rules (written by the capture skills,
    // never in the installer manifest) - rule file names, not skills; referenced by
    // project-task-flow's in-session scoping step.
    'baseline-project-architecture',
    'baseline-project-related-context',
    // MCP server names stamped by project-capabilities' routing map - servers, not skills.
    'angular-cli',
    'chrome-devtools',
    'appium-mcp',
    // built-in Claude Code agent type named in the base template's navigation
    // guidance (don't delegate single-symbol lookups to it) - not a house skill.
    'general-purpose',
    // real .NET CLI diagnostic tools (global tools), backticked as code identifiers
    // in dotnet-diagnostics/references/dumps.md - not house skills.
    'dotnet-dump',
    'dotnet-gcdump',
    // PostgreSQL extension module named in database-conventions' SQL style reference
    // (pre-v13 UUID generation) - a Postgres module, not a house skill.
    'uuid-ossp',
    // file-naming style term backticked in the typescript style reference - a
    // convention name, not a house skill.
    'kebab-case',
]);

const findings = [];
const warnings = [];   // soft (printed, never fail the build)

function flag(message)
{
    findings.push(message);
}

function warn(message)
{
    warnings.push(message);
}

// Parse "repo|skill" entries from the SKILLS block of an installer manifest
// (MCP entries share the same "a|b" line format, so scope to the block).
// Commented entries are still inventory (resolvable references), not installs.
function parseManifest(file, quote, blockStart)
{
    const active = new Map();    // skill -> repo
    const commented = new Map();
    const entry = new RegExp(`^\\s*(#?)\\s*${quote}([^|${quote}]+)\\|([^${quote}]+)${quote}`);
    let inBlock = false;
    for (const line of fs.readFileSync(file, 'utf8').split('\n'))
    {
        if (!inBlock)
        {
            inBlock = line.trimEnd().endsWith(blockStart);
            continue;
        }

        if (line.trim() === ')')
        {
            break;
        }

        const m = line.match(entry);
        if (m)
        {
            (m[1] === '#' ? commented : active).set(m[3], m[2]);
        }
    }

    return { active, commented };
}

// Count/collect the active (uncommented) quoted entries of a simple string-array
// block (AGENTS / HOOKS / RULES) - one quoted token per line, block ends at ')'.
// For HOOK/RULE entries that carry a '::'/'|' tail, the leading token is taken.
// Returns the ordered list of active entry names; commented lines are skipped.
function parseStringArray(file, quote, blockStart)
{
    const names = [];
    const quoted = new RegExp(`^\\s*(#?)\\s*${quote}([^${quote}]+)${quote}`);
    let inBlock = false;
    for (const line of fs.readFileSync(file, 'utf8').split('\n'))
    {
        if (!inBlock)
        {
            inBlock = line.trimEnd().endsWith(blockStart);
            continue;
        }

        if (line.trim() === ')')
        {
            break;
        }

        const m = line.match(quoted);
        if (m && m[1] !== '#')
        {
            names.push(m[2].split(/::|\|/)[0]);
        }
    }

    return names;
}

function localSkillDirs()
{
    return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
}

// Parse a flat installer block (PLUGINS / MCPS) of quoted entries. The entry's
// name is the part before `sep` ('@' for plugins, '|' for MCPs). Bare variable
// lines (e.g. "$MEMORY_ENTRY" / $MemoryEntry) are resolved by locating the
// variable's assignment elsewhere in the file. Returns empty sets if the block
// is absent (e.g. PLUGINS in a cursor manifest).
function parseFlatBlock(file, quote, blockStart, sep)
{
    const text = fs.readFileSync(file, 'utf8');
    const active = new Set();
    const commented = new Set();
    const quoted = new RegExp(`^\\s*(#?)\\s*${quote}([^${quote}]+)${quote}`);
    const variable = /^\s*(#?)\s*"?\$([A-Za-z_][A-Za-z0-9_]*)"?\s*(#.*)?$/;
    let inBlock = false;
    for (const line of text.split('\n'))
    {
        if (!inBlock)
        {
            inBlock = line.trimEnd().endsWith(blockStart);
            continue;
        }

        if (line.trim() === ')')
        {
            break;
        }

        const resolveVar = varName =>
            text.match(new RegExp(`^\\$?${varName}\\s*=\\s*${quote}([a-z0-9-]+)\\${sep}`, 'm'))?.[1] ?? null;

        let name = null;
        let isCommented = false;
        const q = line.match(quoted);
        const v = line.match(variable);
        if (q)
        {
            name = q[2].startsWith('$') ? resolveVar(q[2].slice(1)) : q[2].split(sep)[0];
            isCommented = q[1] === '#';
        }
        else if (v)
        {
            name = resolveVar(v[2]);
            isCommented = v[1] === '#';
        }

        if (name)
        {
            (isCommented ? commented : active).add(name);
        }
    }

    return { active, commented };
}

// Extract the stack HTML's view of the inventory: personal skill names,
// third-party repo skill names, plugin names (from plugin-URL skill rows and
// "/plugin install X@" install cells), and MCP server names.
function parseStackHtml()
{
    const html = fs.readFileSync(STACK_HTML, 'utf8');
    const personal = new Set([...html.split('const personal = {')[1].split('};')[0]
        .matchAll(/\["([a-z0-9-]+)","/g)].map(m => m[1]));
    const personalManual = new Set([...html.split('const personal = {')[1].split('};')[0]
        .matchAll(/\["([a-z0-9-]+)",[^\n]*"manual"\]/g)].map(m => m[1]));

    const repoBlock = html.split('const repository = [')[1].split('\n];')[0];
    const repoSkills = new Set();
    const plugins = new Set();
    for (const m of repoBlock.matchAll(/\["([a-zA-Z0-9:_-]+)","[^"]*","([^"]+)"/g))
    {
        if (PLUGIN_MARKETPLACE_URLS.has(m[2]))
        {
            plugins.add(m[1].split(':')[0]);
        }
        else
        {
            repoSkills.add(m[1]);
        }
    }

    const otherBlock = html.split('const otherTools = [')[1].split('\n];')[0];
    const mcps = new Set();
    for (const m of otherBlock.matchAll(/\["([a-z0-9-]+)", "([^"]+)", "[^"]*", "([^"]*)"/g))
    {
        if (m[2].startsWith('MCP server'))
        {
            mcps.add(m[1]);
        }

        const install = m[3].match(/\/plugin install ([a-z0-9-]+)@/);
        if (install)
        {
            plugins.add(install[1]);
        }
    }

    const hooksBlock = (html.split('const hooks = [')[1] ?? '').split('\n];')[0];
    const hooks = new Set([...hooksBlock.matchAll(/\["([a-z0-9-]+)"/g)].map(m => m[1]));

    return { personal, personalManual, repoSkills, plugins, mcps, hooks };
}

// Every manifest in `manifests` ({label -> Set}) must hold the same entries as
// the reference (the first). Flags both-direction diffs against the reference,
// which transitively proves all four agree.
function assertSameSet(what, manifests)
{
    const labels = Object.keys(manifests);
    const [refLabel, refSet] = [labels[0], manifests[labels[0]]];
    for (const label of labels.slice(1))
    {
        const set = manifests[label];
        for (const name of refSet)
        {
            if (!set.has(name))
            {
                flag(`${what} '${name}' is in ${refLabel} but not ${label}`);
            }
        }

        for (const name of set)
        {
            if (!refSet.has(name))
            {
                flag(`${what} '${name}' is in ${label} but not ${refLabel}`);
            }
        }
    }
}

function main()
{
    const dirs = localSkillDirs();

    // SKILLS are SHARED across all four manifests. Parse each; claude-stack.sh is
    // the reference for the existing dir/README/HTML checks, and a 4-way parity
    // check proves the other three match it.
    const skills = {
        'claude-stack.sh':  parseManifest(CLAUDE_SH, '"', 'SKILLS=('),
        'claude-stack.ps1': parseManifest(CLAUDE_PS1, "'", '$Skills = @('),
        'cursor-stack.sh':  parseManifest(CURSOR_SH, '"', 'SKILLS=('),
        'cursor-stack.ps1': parseManifest(CURSOR_PS1, "'", '$Skills = @('),
    };
    const primary = skills['claude-stack.sh'];   // canonical SKILLS view (all four are identical)

    const readme = fs.readFileSync(README, 'utf8');
    const readmeSection = readme.split(/^## Available skills$/m)[1]?.split(/^## /m)[0] ?? '';
    const readmeNames = new Set([...readmeSection.matchAll(/^- \*\*([a-z0-9-]+)\*\*/gm)].map(m => m[1]));

    // 1. Every skill dir has a SKILL.md whose YAML frontmatter loads cleanly,
    //    names the skill after its directory, and carries a non-empty description.
    //    Also collects the manual-only set (disable-model-invocation) for check 19.
    const manualSkills = new Set();
    for (const dir of dirs)
    {
        const skillFile = path.join(SKILLS_DIR, dir, 'SKILL.md');
        if (!fs.existsSync(skillFile))
        {
            flag(`skills/${dir}/ has no SKILL.md`);
            continue;
        }

        const fm = fs.readFileSync(skillFile, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!fm)
        {
            flag(`skills/${dir}/SKILL.md has no YAML frontmatter block`);
            continue;
        }

        let meta;
        try
        {
            meta = yaml.load(fm[1]);
        }
        catch (err)
        {
            flag(`skills/${dir}/SKILL.md frontmatter is not valid YAML: ${err.reason || err.message}`);
            continue;
        }

        if (meta === null || typeof meta !== 'object' || Array.isArray(meta))
        {
            flag(`skills/${dir}/SKILL.md frontmatter did not parse to a mapping`);
            continue;
        }

        if (meta.name !== dir)
        {
            flag(`skills/${dir}/SKILL.md frontmatter name is '${meta.name}', expected '${dir}'`);
        }

        if (typeof meta.description !== 'string' || meta.description.trim() === '')
        {
            flag(`skills/${dir}/SKILL.md frontmatter has no non-empty 'description'`);
        }

        if (meta['disable-model-invocation'] === true)
        {
            manualSkills.add(dir);
        }
    }

    // 2. Every local skill is registered (uncommented) in the manifests and the README.
    for (const dir of dirs)
    {
        if (!primary.active.has(dir))
        {
            flag(`skills/${dir} is not registered in the installer SKILLS block`);
        }

        if (!readmeNames.has(dir))
        {
            flag(`skills/${dir} is missing from README.md 'Available skills'`);
        }
    }

    // 2b. ...and the reverse: every README 'Available skills' bullet backs a real local
    //     skill dir (a phantom/renamed bullet with no skills/<name>/ would otherwise pass).
    for (const name of readmeNames)
    {
        if (!dirs.includes(name))
        {
            flag(`README.md 'Available skills' lists '${name}' but skills/${name}/ does not exist`);
        }
    }

    // 3. Every active envoydev manifest entry has a local directory.
    for (const [skill, repo] of primary.active)
    {
        if (repo === 'envoydev/agents-stack' && !dirs.includes(skill))
        {
            flag(`SKILLS registers envoydev/agents-stack|${skill} but skills/${skill}/ does not exist`);
        }
    }

    // 4. All four manifests agree on the active SKILLS set.
    assertSameSet('skill', Object.fromEntries(
        Object.entries(skills).map(([label, m]) => [label, new Set(m.active.keys())])));

    // 4b. The four manifests must list the active SKILLS in the SAME ORDER, not
    //     just the same set - the installers were aligned so a diff/review of one
    //     against another stays line-for-line. parseManifest's Map preserves
    //     insertion order, so the active keys ARE the install order. Compare each
    //     against claude-stack.sh and report the first divergence per manifest.
    const refOrder = [...primary.active.keys()];
    for (const [label, m] of Object.entries(skills))
    {
        if (label === 'claude-stack.sh')
        {
            continue;
        }

        const order = [...m.active.keys()];
        const n = Math.min(refOrder.length, order.length);
        for (let i = 0; i < n; i++)
        {
            if (order[i] !== refOrder[i])
            {
                flag(`${label} SKILLS order diverges from claude-stack.sh at position ${i + 1}: '${order[i]}' vs '${refOrder[i]}'`);
                break;
            }
        }
    }

    // 5. The ps1 'every skill (N)' inventory count matches active + commented entries.
    for (const [label, file, parsed] of [['claude-stack.ps1', CLAUDE_PS1, skills['claude-stack.ps1']],
        ['cursor-stack.ps1', CURSOR_PS1, skills['cursor-stack.ps1']]])
    {
        const counted = fs.readFileSync(file, 'utf8').match(/every skill \((\d+)\)/);
        if (counted)
        {
            const inventory = parsed.active.size + parsed.commented.size;
            if (Number(counted[1]) !== inventory)
            {
                flag(`${label} says 'every skill (${counted[1]})' but lists ${inventory} entries`);
            }
        }
    }

    // 6. Every backticked hyphenated token in skill files resolves to a known
    //    skill (any manifest entry, active or commented, or a local dir) or the
    //    explicit non-skill allowlist. The regex now also accepts a leading
    //    uppercase letter and PascalCase/UPPER segments, so a real skill like
    //    `OpenTelemetry-NET-Instrumentation` is validated instead of skipped.
    //    Capitalized tokens unrelated to any skill (HTTP headers like
    //    `Content-Type`, ticket IDs like `PROJ7-4521`) are left alone; a
    //    capitalized token is only flagged when it case-insensitively COLLIDES
    //    with a known skill but the exact casing is wrong (a real reference typo).
    const known = new Set(dirs);
    for (const m of Object.values(skills))
    {
        for (const k of m.active.keys()) known.add(k);
        for (const k of m.commented.keys()) known.add(k);
    }
    const knownLower = new Map([...known].map(k => [k.toLowerCase(), k]));
    const matchedNonSkill = new Set();   // for check 11 (dead-allowlist reverse check)
    for (const dir of dirs)
    {
        const files = [path.join(SKILLS_DIR, dir, 'SKILL.md')];
        const refsDir = path.join(SKILLS_DIR, dir, 'references');
        if (fs.existsSync(refsDir))
        {
            files.push(...fs.readdirSync(refsDir).filter(f => f.endsWith('.md')).map(f => path.join(refsDir, f)));
        }

        for (const file of files)
        {
            if (!fs.existsSync(file))
            {
                continue;
            }

            const text = fs.readFileSync(file, 'utf8');
            for (const m of text.matchAll(/`([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)`/g))
            {
                const token = m[1];
                if (NON_SKILL_TOKENS.has(token))
                {
                    matchedNonSkill.add(token);
                    continue;
                }

                if (known.has(token))
                {
                    continue;   // exact match - a real skill reference, incl. PascalCase names
                }

                // Not an exact known skill. A lowercase token that is not known
                // is a typo/rename-rot. A capitalized token is only a finding
                // when it collides case-insensitively with a real skill (a
                // casing typo); otherwise it is an unrelated identifier/header.
                const collision = knownLower.get(token.toLowerCase());
                if (token === token.toLowerCase())
                {
                    flag(`${path.relative(ROOT, file)} references \`${token}\` - not a known skill (typo? add to NON_SKILL_TOKENS if intentional)`);
                }
                else if (collision)
                {
                    flag(`${path.relative(ROOT, file)} references \`${token}\` - wrong casing for skill '${collision}'`);
                }
            }
        }
    }

    // 7. The convention hook only demands skills that exist locally. A gated
    //    skill is a quoted token inside a suffix's owner array (the `: [...]`
    //    value); the suffix keys themselves (`'.cs'` &c.) are not skills.
    if (fs.existsSync(CONVENTION_HOOK))
    {
        const hookText = fs.readFileSync(CONVENTION_HOOK, 'utf8');
        const gated = new Set();
        for (const arr of hookText.matchAll(/:\s*\[([^\]]*)\]/g))
        {
            for (const m of arr[1].matchAll(/'([a-z0-9-]+)'/g))
            {
                gated.add(m[1]);
            }
        }

        for (const name of gated)
        {
            if (!dirs.includes(name))
            {
                flag(`hooks/require-convention-skill.js gates on '${name}' but skills/${name}/ does not exist`);
            }
        }
    }

    // 8-10. The agent scripts are the source of truth for EVERYTHING in use:
    // skills, plugins, and MCPs. PLUGINS are claude-only (claude-stack.sh ==
    // claude-stack.ps1; cursor scripts carry none); MCPS are shared (all four
    // identical). The stack HTML must agree with claude-stack.sh (the superset).
    const html = parseStackHtml();
    const pluginsClaudeSh = parseFlatBlock(CLAUDE_SH, '"', 'PLUGINS=(', '@');
    const pluginsClaudePs1 = parseFlatBlock(CLAUDE_PS1, "'", '$Plugins = @(', '@');
    const mcps = {
        'claude-stack.sh':  parseFlatBlock(CLAUDE_SH, '"', 'MCPS=(', '|'),
        'claude-stack.ps1': parseFlatBlock(CLAUDE_PS1, "'", '$Mcps = @(', '|'),
        'cursor-stack.sh':  parseFlatBlock(CURSOR_SH, '"', 'MCPS=(', '|'),
        'cursor-stack.ps1': parseFlatBlock(CURSOR_PS1, "'", '$Mcps = @(', '|'),
    };

    // 18. Backticked skill names in the base templates + cursor rules + claude rules must
    //     resolve too, or a renamed skill rots silently there (the gap check 6
    //     left open). Unlike a skill file, a template/rule legitimately names
    //     plugins (`csharp-lsp`, `claude-hud`), MCPs (`angular-cli`,
    //     `chrome-devtools`), subagents (`ng-build-error-resolver`), and the
    //     superpowers workflow skills - so resolve against the full registration
    //     surface (skills + plugins + MCPs + agent names) plus NON_SKILL_TOKENS,
    //     and only flag a token that matches NONE of them. The same case-collision
    //     rule as check 6: a capitalized token is a finding only when it
    //     case-insensitively collides with a known skill (a casing typo).
    const mcpsRef = mcps['claude-stack.sh'];   // shared set; canonical view
    const resolvable = new Set(known);   // all skills (dirs + every manifest selector)
    for (const s of [...pluginsClaudeSh.active, ...pluginsClaudeSh.commented]) resolvable.add(s);
    for (const s of [...mcpsRef.active, ...mcpsRef.commented]) resolvable.add(s);
    if (fs.existsSync(AGENTS_DIR))
    {
        for (const f of fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md'))) resolvable.add(f.replace(/\.md$/, ''));
    }

    const resolvableLower = new Map([...resolvable].map(k => [k.toLowerCase(), k]));
    const templateFiles = [CLAUDE_TEMPLATE, CURSOR_TEMPLATE];
    if (fs.existsSync(CURSOR_RULES_DIR))
    {
        templateFiles.push(...fs.readdirSync(CURSOR_RULES_DIR).filter(f => f.endsWith('.mdc')).map(f => path.join(CURSOR_RULES_DIR, f)));
    }

    if (fs.existsSync(CLAUDE_RULES_DIR))
    {
        templateFiles.push(...fs.readdirSync(CLAUDE_RULES_DIR).filter(f => f.endsWith('.md')).map(f => path.join(CLAUDE_RULES_DIR, f)));
    }

    for (const file of templateFiles.filter(fs.existsSync))
    {
        const text = fs.readFileSync(file, 'utf8');
        for (const m of text.matchAll(/`([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)`/g))
        {
            const token = m[1];
            if (NON_SKILL_TOKENS.has(token))
            {
                matchedNonSkill.add(token);
                continue;
            }

            if (resolvable.has(token))
            {
                continue;
            }

            const collision = resolvableLower.get(token.toLowerCase());
            if (token === token.toLowerCase())
            {
                flag(`${path.relative(ROOT, file)} references \`${token}\` - not a known skill/plugin/MCP/agent (typo? add to NON_SKILL_TOKENS if intentional)`);
            }
            else if (collision)
            {
                flag(`${path.relative(ROOT, file)} references \`${token}\` - wrong casing for '${collision}'`);
            }
        }
    }

    // 8. HTML skills vs manifests (personal section vs dirs; repo rows vs third-party inventory).
    for (const name of html.personal)
    {
        if (!dirs.includes(name))
        {
            flag(`HTML personal row '${name}' has no skills/${name}/ directory`);
        }
    }

    for (const dir of dirs)
    {
        if (!html.personal.has(dir))
        {
            flag(`skills/${dir} is missing from the HTML personal section`);
        }
    }

    // 8b. cursor-stack.html's personal inventory was previously unchecked (parseStackHtml
    //     reads only claude-stack.html). Validate its personal-skill rows against the dirs
    //     both directions. (Cursor HTML has no 'otherTools' block, so check only personal.)
    if (fs.existsSync(CURSOR_STACK_HTML))
    {
        const cursorPersonal = new Set([...(fs.readFileSync(CURSOR_STACK_HTML, 'utf8')
            .split('const personal = {')[1] ?? '').split('};')[0].matchAll(/\["([a-z0-9-]+)","/g)].map(m => m[1]));
        for (const name of cursorPersonal)
        {
            if (!dirs.includes(name))
            {
                flag(`cursor-stack.html personal row '${name}' has no skills/${name}/ directory`);
            }
        }

        for (const dir of dirs)
        {
            if (!cursorPersonal.has(dir))
            {
                flag(`skills/${dir} is missing from the cursor-stack.html personal section`);
            }
        }
    }

    const thirdPartyActive = new Set([...primary.active.keys()].filter(s => primary.active.get(s) !== 'envoydev/agents-stack'));
    const inventory = new Set([...thirdPartyActive, ...primary.commented.keys()]);
    for (const name of thirdPartyActive)
    {
        if (!html.repoSkills.has(name))
        {
            flag(`manifest skill '${name}' is missing from the HTML repository section`);
        }
    }

    for (const name of html.repoSkills)
    {
        if (!inventory.has(name))
        {
            flag(`HTML repository row '${name}' is not in the installer manifests (active or commented)`);
        }
    }

    // 8c. cursor-stack.html's third-party `repository` block was also unchecked (8b
    //     covers only its personal block) - validate it against the manifest inventory
    //     both directions, exactly as the claude repository block is checked above.
    if (fs.existsSync(CURSOR_STACK_HTML))
    {
        const cursorBlock = (fs.readFileSync(CURSOR_STACK_HTML, 'utf8').split('const repository = [')[1] ?? '').split('\n];')[0];
        const cursorRepo = new Set();
        for (const m of cursorBlock.matchAll(/\["([a-zA-Z0-9:_-]+)","[^"]*","([^"]+)"/g))
        {
            if (!PLUGIN_MARKETPLACE_URLS.has(m[2]))
            {
                cursorRepo.add(m[1]);
            }
        }

        for (const name of thirdPartyActive)
        {
            if (!cursorRepo.has(name))
            {
                flag(`manifest skill '${name}' is missing from the cursor-stack.html repository section`);
            }
        }

        for (const name of cursorRepo)
        {
            if (!inventory.has(name))
            {
                flag(`cursor-stack.html repository row '${name}' is not in the installer manifests (active or commented)`);
            }
        }
    }

    // 9. Plugins: claude-only. claude-stack.sh == claude-stack.ps1; cursor carries none;
    //    every active plugin appears in the HTML (and vice versa).
    assertSameSet('plugin', { 'claude-stack.sh': pluginsClaudeSh.active, 'claude-stack.ps1': pluginsClaudePs1.active });
    for (const [label, file] of [['cursor-stack.sh', CURSOR_SH], ['cursor-stack.ps1', CURSOR_PS1]])
    {
        const cursorPlugins = label.endsWith('.ps1')
            ? parseFlatBlock(file, "'", '$Plugins = @(', '@')
            : parseFlatBlock(file, '"', 'PLUGINS=(', '@');
        for (const name of cursorPlugins.active)
        {
            flag(`${label} should carry no plugins (claude-only) but lists '${name}'`);
        }
    }

    for (const name of pluginsClaudeSh.active)
    {
        if (!html.plugins.has(name))
        {
            flag(`active plugin '${name}' is missing from the HTML inventory`);
        }
    }

    for (const name of html.plugins)
    {
        if (!pluginsClaudeSh.active.has(name) && !pluginsClaudeSh.commented.has(name))
        {
            flag(`HTML references plugin '${name}' which is not in the installer PLUGINS block (active or commented)`);
        }
    }

    // 10. MCPs: shared. All four agree, and the HTML MCP rows equal the manifest set exactly.
    assertSameSet('MCP', Object.fromEntries(
        Object.entries(mcps).map(([label, m]) => [label, m.active])));
    const mcpsPrimary = mcps['claude-stack.sh'];
    for (const name of mcpsPrimary.active)
    {
        if (!html.mcps.has(name))
        {
            flag(`active MCP '${name}' is missing from the HTML inventory`);
        }
    }

    for (const name of html.mcps)
    {
        if (!mcpsPrimary.active.has(name) && !mcpsPrimary.commented.has(name))
        {
            flag(`HTML lists MCP '${name}' which is not in the installer MCPS block (active or commented)`);
        }
    }

    // 11. Reverse allowlist check: every NON_SKILL_TOKENS entry must actually
    //     appear as a backtick in some scanned surface - a skill file (check 6)
    //     or a base template / cursor rule / claude rule (check 18), both of which
    //     record matches. A never-matched entry is dead config (e.g. a `dev-log` left
    //     behind after the trigger word stopped being backticked) - prune it.
    for (const token of NON_SKILL_TOKENS)
    {
        if (!matchedNonSkill.has(token))
        {
            flag(`NON_SKILL_TOKENS lists '${token}' but no skill file / template / rule backticks it - dead allowlist entry, remove it`);
        }
    }

    // 12. The active manifest set sizes (and the installer's HOOKS/AGENTS/RULES
    //     arrays) are the single source of truth; the headline counts in the
    //     per-agent READMEs must equal them so the prose cannot silently drift.
    //     Claude carries Skills/Plugins/MCP/Hooks/Agents/Rules; Cursor carries
    //     Skills/MCP/Hooks/Rules/Agents (no Plugins). Both spell the count two
    //     ways: a table cell ('| 67 |') and an inline '(67)'. Hook / agent / rule
    //     counts come from the installer array sizes (all cursor rules are now
    //     vendored on disk, but the installer CURSOR_RULES array - not the on-disk
    //     .mdc set - stays authoritative, since a rule could still be fetched by
    //     url). The claude Rules count is validated against the CLAUDE_RULES array
    //     the same way. The cursor Agents count is validated against CURSOR_AGENTS.
    const skillCount = primary.active.size;
    const pluginCount = pluginsClaudeSh.active.size;
    const mcpCount = mcpsPrimary.active.size;
    const claudeHookCount = parseStringArray(CLAUDE_SH, '"', 'HOOKS=(').length;
    const claudeAgentCount = parseStringArray(CLAUDE_SH, '"', 'AGENTS=(').length;
    const claudeRuleCount = parseStringArray(CLAUDE_SH, '"', 'CLAUDE_RULES=(').length;
    const cursorHookCount = parseStringArray(CURSOR_SH, '"', 'CURSOR_HOOKS=(').length;
    const cursorRuleCount = parseStringArray(CURSOR_SH, '"', 'CURSOR_RULES=(').length;
    const cursorAgentCount = parseStringArray(CURSOR_SH, '"', 'CURSOR_AGENTS=(').length;

    // 12b. Stack hooks in claude-stack.html: the 'Stack hooks' section rows and the
    //      c-hooks count must match the installer HOOKS=() array (names stripped of
    //      their .js, both directions; count tied to the array size - same rigor as
    //      the README hook count above).
    const installerHooks = new Set(parseStringArray(CLAUDE_SH, '"', 'HOOKS=(').map(n => n.replace(/\.js$/, '')));
    for (const name of installerHooks)
    {
        if (!html.hooks.has(name))
        {
            flag(`active hook '${name}' is missing from the claude-stack.html Stack hooks section`);
        }
    }

    for (const name of html.hooks)
    {
        if (!installerHooks.has(name))
        {
            flag(`claude-stack.html Stack hooks row '${name}' is not in the installer HOOKS block`);
        }
    }

    const htmlHookCount = (fs.readFileSync(STACK_HTML, 'utf8').match(/id="c-hooks">(\d+)</) || [])[1];
    if (htmlHookCount == null)
    {
        flag('claude-stack.html: no c-hooks count element found to verify against the HOOKS array');
    }
    else if (Number(htmlHookCount) !== claudeHookCount)
    {
        flag(`claude-stack.html: c-hooks count is ${htmlHookCount} but the installer holds ${claudeHookCount} hooks`);
    }

    const readmeCount = (file, label, rowLabel) =>
    {
        const text = fs.readFileSync(file, 'utf8');
        // '| **Skills** | 67 |' (claude) or '| **Skills** (67) |' (cursor).
        const m = text.match(new RegExp(`\\*\\*${rowLabel}[^*]*\\*\\*\\s*(?:\\((\\d+)\\)|\\|\\s*(\\d+))`));
        if (!m)
        {
            flag(`${label}: no headline '${rowLabel}' count found to verify against the manifests`);
            return null;
        }

        return Number(m[1] ?? m[2]);
    };

    for (const [file, label] of [[CLAUDE_README, 'claude/README.md'], [CURSOR_README, 'cursor/README.md']])
    {
        const checks = [['Skills', skillCount], ['MCP servers', mcpCount]];
        if (file === CLAUDE_README)
        {
            checks.push(['Plugins', pluginCount]);   // Cursor carries no plugins
            checks.push(['Hooks', claudeHookCount]);
            checks.push(['Agents', claudeAgentCount]);
            checks.push(['Rules', claudeRuleCount]);
        }
        else
        {
            checks.push(['Hooks', cursorHookCount]);
            checks.push(['Rules', cursorRuleCount]);   // Claude has no Rules row
            checks.push(['Agents', cursorAgentCount]); // Cursor now ships the 4 resolver subagents
        }

        for (const [rowLabel, expected] of checks)
        {
            const got = readmeCount(file, label, rowLabel);
            if (got !== null && got !== expected)
            {
                flag(`${label}: headline ${rowLabel} count is ${got} but the installer holds ${expected}`);
            }
        }
    }

    // 12b. The on-disk claude/agents/*.md set must equal the agents the installers
    //      fetch (the AGENTS manifest array - both claude shells agree). A drift
    //      means a committed subagent never installs, or the installer fetches an
    //      agent that no longer exists in-repo.
    const agentManifestSh = new Set(parseStringArray(CLAUDE_SH, '"', 'AGENTS=('));
    const agentManifestPs1 = new Set(parseStringArray(CLAUDE_PS1, "'", '$Agents = @('));
    assertSameSet('agent', { 'claude-stack.sh': agentManifestSh, 'claude-stack.ps1': agentManifestPs1 });
    const agentDiskSet = fs.existsSync(AGENTS_DIR)
        ? new Set(fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')))
        : new Set();
    assertSameSet('agent file', { 'claude/agents/': agentDiskSet, 'claude-stack.sh AGENTS': agentManifestSh });

    // 12c. Same parity for the CURSOR subagents: the on-disk cursor/agents/*.md set must equal the
    //      CURSOR_AGENTS manifest array in BOTH cursor shells (both shells agree first, then the
    //      on-disk set equals them). A drift means a committed Cursor subagent never installs, or the
    //      installer fetches a Cursor agent that no longer exists in-repo.
    const cursorAgentManifestSh = new Set(parseStringArray(CURSOR_SH, '"', 'CURSOR_AGENTS=('));
    const cursorAgentManifestPs1 = new Set(parseStringArray(CURSOR_PS1, "'", '$CursorAgents = @('));
    assertSameSet('cursor agent', { 'cursor-stack.sh': cursorAgentManifestSh, 'cursor-stack.ps1': cursorAgentManifestPs1 });
    const cursorAgentDiskSet = fs.existsSync(CURSOR_AGENTS_DIR)
        ? new Set(fs.readdirSync(CURSOR_AGENTS_DIR).filter(f => f.endsWith('.md')))
        : new Set();
    assertSameSet('cursor agent file', { 'cursor/agents/': cursorAgentDiskSet, 'cursor-stack.sh CURSOR_AGENTS': cursorAgentManifestSh });

    // 12d. Same parity for the CLAUDE rules: the on-disk claude/rules/*.md set must equal the
    //      CLAUDE_RULES manifest array in BOTH claude shells (both shells agree first, then the
    //      on-disk set equals them). A drift means a committed rule never installs, or the
    //      installer fetches a rule that no longer exists in-repo.
    const ruleManifestSh = new Set(parseStringArray(CLAUDE_SH, '"', 'CLAUDE_RULES=('));
    const ruleManifestPs1 = new Set(parseStringArray(CLAUDE_PS1, "'", '$ClaudeRules = @('));
    assertSameSet('rule', { 'claude-stack.sh': ruleManifestSh, 'claude-stack.ps1': ruleManifestPs1 });
    assertSameSet('rule file', {
        'claude/rules/': new Set(fs.existsSync(CLAUDE_RULES_DIR) ? fs.readdirSync(CLAUDE_RULES_DIR).filter(f => f.endsWith('.md')) : []),
        'claude-stack.sh CLAUDE_RULES': ruleManifestSh,
    });

    // 13. The Claude subagents reference house skills by backticked name (e.g.
    //     `csharp`, `dotnet-testing`). Each backticked hyphenated token must
    //     resolve to a local skill dir or a manifest selector. Tool names
    //     (`Edit`, `Read`) and code identifiers (`fakeAsync`, `setTimeout`) are
    //     single words, not hyphenated, so they are not scanned here.
    if (fs.existsSync(AGENTS_DIR))
    {
        for (const agentFile of fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')))
        {
            const text = fs.readFileSync(path.join(AGENTS_DIR, agentFile), 'utf8');
            for (const m of text.matchAll(/`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g))
            {
                const token = m[1];
                if (!known.has(token) && !NON_SKILL_TOKENS.has(token))
                {
                    flag(`claude/agents/${agentFile} references skill \`${token}\` - not a local skill dir or a manifest selector`);
                }
            }
        }
    }

    // 13b. Same reference check for the Cursor subagents: each backticked hyphenated token in
    //      cursor/agents/*.md must resolve to a local skill dir or a manifest selector (the cursor
    //      bodies cite house skills like `angular-conventions` / `package-management` the same way).
    //      Mirrors check 13; the same rule keeps a renamed skill from rotting silently in the Cursor
    //      twins. (Cursor agents have NO `tools:` field and no Skill-tool gate, so check 16's
    //      Skill-allowlist guard intentionally does NOT scan them - it stays scoped to claude/agents.)
    if (fs.existsSync(CURSOR_AGENTS_DIR))
    {
        for (const agentFile of fs.readdirSync(CURSOR_AGENTS_DIR).filter(f => f.endsWith('.md')))
        {
            const text = fs.readFileSync(path.join(CURSOR_AGENTS_DIR, agentFile), 'utf8');
            for (const m of text.matchAll(/`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g))
            {
                const token = m[1];
                if (!known.has(token) && !NON_SKILL_TOKENS.has(token))
                {
                    flag(`cursor/agents/${agentFile} references skill \`${token}\` - not a local skill dir or a manifest selector`);
                }
            }
        }
    }

    // 14. House dotnet-* skills are original work, not vendored copies. Guard
    //     against the CONTRADICTORY 'Vendored from <kit>' inventory label
    //     reappearing on a dotnet-* SKILL.md (or its references) or either stack
    //     HTML in a dotnet-* context. Scoped to the false 'vendored from' label
    //     only - an honest 'Adapted from' / third-party notice is NOT blocked, so
    //     a future genuinely-incorporated skill can still carry its MIT credit.
    //     (The ponytail row's vendoring note is unrelated and lives on a
    //     non-dotnet row, so scope the HTML scan to dotnet-* lines.)
    const provenance = /\bvendored from\b/i;
    for (const dir of dirs.filter(d => d.startsWith('dotnet')))
    {
        const files = [path.join(SKILLS_DIR, dir, 'SKILL.md')];
        const refsDir = path.join(SKILLS_DIR, dir, 'references');
        if (fs.existsSync(refsDir))
        {
            files.push(...fs.readdirSync(refsDir).filter(f => f.endsWith('.md')).map(f => path.join(refsDir, f)));
        }

        for (const file of files.filter(fs.existsSync))
        {
            if (provenance.test(fs.readFileSync(file, 'utf8')))
            {
                flag(`${path.relative(ROOT, file)} contains a 'Vendored from' label - house dotnet-* skills are original work, drop the provenance note`);
            }
        }
    }

    for (const [htmlFile, label] of [[STACK_HTML, 'claude-stack.html'], [CURSOR_STACK_HTML, 'cursor-stack.html']])
    {
        if (!fs.existsSync(htmlFile))
        {
            continue;
        }

        for (const line of fs.readFileSync(htmlFile, 'utf8').split('\n'))
        {
            if (/dotnet-/.test(line) && provenance.test(line))
            {
                flag(`${label} has a dotnet-* line with a 'Vendored from' label - house dotnet-* skills are original work`);
            }
        }
    }

    // 15. Soft warning: an OUTLIER-length SKILL.md description. The house style
    //     deliberately packs routing into descriptions (Companions + version floor +
    //     negative scope) so the rich .NET/router skills legitimately run 800-1050;
    //     warning at 800 fired on half the corpus and just flagged the house norm.
    //     The cap is set above that norm to catch a genuinely bloated outlier (the
    //     1300-char case), not the intentional routing prose. Not a failure - a nudge.
    const DESC_SOFT_LIMIT = 1100;
    for (const dir of dirs)
    {
        const skillFile = path.join(SKILLS_DIR, dir, 'SKILL.md');
        if (!fs.existsSync(skillFile))
        {
            continue;
        }

        const fm = fs.readFileSync(skillFile, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!fm)
        {
            continue;
        }

        let meta;
        try
        {
            meta = yaml.load(fm[1]);
        }
        catch
        {
            continue;   // check 1 already flagged the YAML failure
        }

        if (meta && typeof meta.description === 'string' && meta.description.length > DESC_SOFT_LIMIT)
        {
            warn(`skills/${dir}/SKILL.md description is ${meta.description.length} chars (> ${DESC_SOFT_LIMIT}) - consider tightening`);
        }
    }

    // 16. An agent told to invoke the Skill tool must carry 'Skill' in its tools:
    //     allowlist - otherwise it deadlocks on the very convention gate the
    //     instruction exists to satisfy (the exact regression this guards against).
    if (fs.existsSync(AGENTS_DIR))
    {
        for (const agentFile of fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')))
        {
            const text = fs.readFileSync(path.join(AGENTS_DIR, agentFile), 'utf8');
            const toolsLine = text.match(/^tools:\s*(.+)$/m);
            const tools = toolsLine ? toolsLine[1].split(',').map(t => t.trim()) : [];
            if (/invoke the Skill tool/i.test(text) && !tools.includes('Skill'))
            {
                flag(`claude/agents/${agentFile} tells the agent to invoke the Skill tool but 'Skill' is not in its tools: allowlist - it would deadlock on the convention gate`);
            }
        }
    }

    // 17. The Cursor angular rule's globs must match the convention hook's 'ng'
    //     suffix table. A drift (e.g. a '.module.ts' glob the hook excludes) means
    //     the two stacks gate Angular files differently for the same project.
    const NG_RULE = path.join(ROOT, 'cursor', 'rules', 'angular-conventions.mdc');
    if (fs.existsSync(CONVENTION_HOOK) && fs.existsSync(NG_RULE))
    {
        const ngBlock = fs.readFileSync(CONVENTION_HOOK, 'utf8').split('ng: {')[1]?.split('}')[0] ?? '';
        const ngSuffixes = new Set([...ngBlock.matchAll(/'([^']+)'\s*:/g)].map(m => m[1]));
        const globsLine = fs.readFileSync(NG_RULE, 'utf8').match(/^globs:\s*"([^"]+)"/m);
        const ruleSuffixes = new Set((globsLine ? globsLine[1].split(',') : [])
            .map(g => g.trim().replace(/^\*\*\/\*/, '')));
        for (const s of ngSuffixes)
        {
            if (!ruleSuffixes.has(s)) flag(`cursor/rules/angular-conventions.mdc globs miss '${s}' that the hook 'ng' table gates`);
        }

        for (const s of ruleSuffixes)
        {
            if (!ngSuffixes.has(s)) flag(`cursor/rules/angular-conventions.mdc globs '${s}' but the hook 'ng' table does not gate it (drift)`);
        }
    }

    // 18. claude/rules/*.md and claude/agents/*.md frontmatter must be strict
    //     YAML - the same failure mode check 1 guards for skills: an unquoted
    //     scalar containing ': ' breaks GitHub rendering AND any strict
    //     frontmatter parser. Rules need a non-empty description (pathless
    //     baseline) or a paths string array (path-scoped). Agents need
    //     name (= filename) plus the house keys: description, model, effort, tools.
    let rulesChecked = 0;
    let agentsChecked = 0;
    for (const target of [
        { dir: path.join(ROOT, 'claude', 'rules'), kind: 'rule' },
        { dir: path.join(ROOT, 'claude', 'agents'), kind: 'agent' },
    ])
    {
        for (const file of fs.readdirSync(target.dir).filter(f => f.endsWith('.md')).sort())
        {
            const rel = `claude/${target.kind === 'rule' ? 'rules' : 'agents'}/${file}`;
            if (target.kind === 'rule') rulesChecked++; else agentsChecked++;
            const fm = fs.readFileSync(path.join(target.dir, file), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
            if (!fm)
            {
                flag(`${rel} has no YAML frontmatter block`);
                continue;
            }

            let meta;
            try
            {
                meta = yaml.load(fm[1]);
            }
            catch (err)
            {
                flag(`${rel} frontmatter is not valid YAML: ${err.reason || err.message}`);
                continue;
            }

            if (meta === null || typeof meta !== 'object' || Array.isArray(meta))
            {
                flag(`${rel} frontmatter did not parse to a mapping`);
                continue;
            }

            if (target.kind === 'rule')
            {
                const hasDesc = typeof meta.description === 'string' && meta.description.trim() !== '';
                const hasPaths = Array.isArray(meta.paths) && meta.paths.length > 0 && meta.paths.every(p => typeof p === 'string');
                if (!hasDesc && !hasPaths)
                {
                    flag(`${rel} frontmatter needs a non-empty 'description' (pathless) or a 'paths' string array (path-scoped)`);
                }
            }
            else
            {
                const expected = file.replace(/\.md$/, '');
                if (meta.name !== expected)
                {
                    flag(`${rel} frontmatter name is '${meta.name}', expected '${expected}'`);
                }

                for (const key of ['description', 'model', 'effort', 'tools'])
                {
                    if (typeof meta[key] !== 'string' || meta[key].trim() === '')
                    {
                        flag(`${rel} frontmatter has no non-empty '${key}'`);
                    }
                }
            }
        }
    }

    // 19. The HTML personal-skills invocation column must match frontmatter:
    //     every disable-model-invocation skill carries the "manual" row flag,
    //     and no auto-invoked skill claims it.
    for (const name of manualSkills)
    {
        if (!html.personalManual.has(name))
        {
            flag(`claude-stack.html personal row for '${name}' misses the "manual" invocation flag (its SKILL.md sets disable-model-invocation)`);
        }
    }

    for (const name of html.personalManual)
    {
        if (!manualSkills.has(name))
        {
            flag(`claude-stack.html marks '${name}' manual but its SKILL.md does not set disable-model-invocation`);
        }
    }

    if (warnings.length > 0)
    {
        for (const warning of warnings)
        {
            console.error(`WARN: ${warning}`);
        }

        console.error('');
    }

    if (findings.length > 0)
    {
        for (const finding of findings)
        {
            console.error(`LINT: ${finding}`);
        }

        console.error(`\n${findings.length} finding(s).`);
        process.exit(1);
    }

    console.log(`lint-skills: clean (${dirs.length} skills, ${primary.active.size} active manifest entries, `
        + `${pluginsClaudeSh.active.size} plugins, ${mcpsPrimary.active.size} MCPs; 4 manifests + HTML in sync; `
        + `${rulesChecked} rules + ${agentsChecked} agents frontmatter-clean).`);
}

main();
