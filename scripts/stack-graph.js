#!/usr/bin/env node
// Build the stack dependency graph (scripts/stack-graph.json) from the same
// sources the lint reads. Edges are directional and skills never pull skills:
//   agent  -> skill (declared skills: frontmatter, else body backtick mentions)
//   rule   -> skill / agent (body backtick mentions) + paths from frontmatter
//   skill/agent/rule -> mcp / plugin (body backtick mentions)
// Mentions are BACKTICKED tokens only (the same reliable signal the lint uses),
// so prose words like the English 'memory' never create a false edge.
'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const lint = require('./lint-skills.js');

const { ROOT, SKILLS_DIR, AGENTS_DIR, CLAUDE_RULES_DIR, CLAUDE_SH } = lint.paths;
const GRAPH_FILE = path.join(ROOT, 'scripts', 'stack-graph.json');

function frontmatterBlock(text)
{
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return m ? m[1] : null;
}

function bodyAfterFrontmatter(text)
{
    const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
    return m ? m[1] : text;
}

// Every distinct backticked token in the text (content between a pair of
// backticks, trimmed). Catalog membership - not a shape regex - decides what is
// an edge, so single-word MCPs (`serena`, `context7`) resolve as well as
// hyphenated ones (`angular-cli`). Tokenized LINE BY LINE - a markdown inline-code
// span never crosses a line, so scanning each line independently prevents a stray
// or odd backtick count (including a ```` ```bash ```` fence line) from desyncing
// the open/close pairing into later lines.
function backtickedTokens(text)
{
    const tokens = new Set();
    for (const line of text.split(/\r?\n/))
    {
        for (const m of line.matchAll(/`([^`]+)`/g)) tokens.add(m[1].trim());
    }

    return tokens;
}

// Resolve the owning plugin for a token: either the token itself is a plugin
// catalog name, or its colon prefix (`plugin:skill` namespacing) is.
function pluginFromToken(token, plugins)
{
    if (plugins.has(token)) return token;
    const i = token.indexOf(':');
    if (i === -1) return null;
    const prefix = token.slice(0, i);
    return plugins.has(prefix) ? prefix : null;
}

function catalogs()
{
    const skills = new Set(lint.localSkillDirs());
    const agents = new Set(fs.existsSync(AGENTS_DIR)
        ? fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''))
        : []);
    const mcpBlock = lint.parseFlatBlock(CLAUDE_SH, '"', 'MCPS=(', '|');
    const pluginBlock = lint.parseFlatBlock(CLAUDE_SH, '"', 'PLUGINS=(', '@');
    const mcps = new Set([...mcpBlock.active, ...mcpBlock.commented]);
    const plugins = new Set([...pluginBlock.active, ...pluginBlock.commented]);
    return { skills, agents, mcps, plugins };
}

function categorize(tokens, cat)
{
    const pick = set => [...tokens].filter(t => set.has(t)).sort();
    const plugins = new Set();
    for (const t of tokens)
    {
        const p = pluginFromToken(t, cat.plugins);
        if (p) plugins.add(p);
    }

    return { skills: pick(cat.skills), agents: pick(cat.agents), mcps: pick(cat.mcps), plugins: [...plugins].sort() };
}

function skillFiles(name)
{
    const files = [path.join(SKILLS_DIR, name, 'SKILL.md')];
    const refs = path.join(SKILLS_DIR, name, 'references');
    if (fs.existsSync(refs))
    {
        files.push(...fs.readdirSync(refs).filter(f => f.endsWith('.md')).map(f => path.join(refs, f)));
    }

    return files.filter(fs.existsSync);
}

function buildStackGraph()
{
    const cat = catalogs();
    const graph = {
        generatedBy: 'stack-graph',
        skills: {},
        agents: {},
        rules: {},
        catalog: { mcps: [...cat.mcps].sort(), plugins: [...cat.plugins].sort() },
    };

    for (const name of [...cat.skills].sort())
    {
        const tokens = new Set();
        for (const f of skillFiles(name))
        {
            for (const t of backtickedTokens(fs.readFileSync(f, 'utf8'))) tokens.add(t);
        }

        const c = categorize(tokens, cat);
        graph.skills[name] = { mcps: c.mcps, plugins: c.plugins };
    }

    for (const name of [...cat.agents].sort())
    {
        const text = fs.readFileSync(path.join(AGENTS_DIR, name + '.md'), 'utf8');
        const fmText = frontmatterBlock(text);
        let declared = [];
        let source = 'none';
        const fmPlugins = new Set();
        if (fmText)
        {
            let meta = null;
            try { meta = yaml.load(fmText); } catch { meta = null; }
            if (meta && Array.isArray(meta.skills))
            {
                declared = meta.skills.filter(s => cat.skills.has(s));
                source = 'frontmatter';
                for (const s of meta.skills)
                {
                    const p = pluginFromToken(s, cat.plugins);
                    if (p) fmPlugins.add(p);
                }
            }
        }

        const c = categorize(backtickedTokens(bodyAfterFrontmatter(text)), cat);
        const plugins = [...new Set([...fmPlugins, ...c.plugins])].sort();
        let skills = declared;
        if (source !== 'frontmatter')
        {
            skills = c.skills;
            source = c.skills.length ? 'body' : 'none';
        }

        graph.agents[name] = {
            skills: [...skills].sort(),
            skillsSource: source,
            agents: c.agents.filter(a => a !== name),
            mcps: c.mcps,
            plugins,
        };
    }

    if (fs.existsSync(CLAUDE_RULES_DIR))
    {
        for (const file of fs.readdirSync(CLAUDE_RULES_DIR).filter(f => f.endsWith('.md')).sort())
        {
            const name = file.replace(/\.md$/, '');
            const text = fs.readFileSync(path.join(CLAUDE_RULES_DIR, file), 'utf8');
            const fmText = frontmatterBlock(text);
            let paths = [];
            if (fmText)
            {
                try
                {
                    const meta = yaml.load(fmText);
                    if (meta && Array.isArray(meta.paths)) paths = meta.paths;
                }
                catch { /* check 18 in the lint already flags bad rule YAML */ }
            }

            const c = categorize(backtickedTokens(bodyAfterFrontmatter(text)), cat);
            graph.rules[name] = { skills: c.skills, agents: c.agents, mcps: c.mcps, plugins: c.plugins, paths };
        }
    }

    return graph;
}

function serialize(graph)
{
    return JSON.stringify(graph, null, 2) + '\n';
}

function readCommitted()
{
    return fs.existsSync(GRAPH_FILE) ? fs.readFileSync(GRAPH_FILE, 'utf8') : null;
}

module.exports = { buildStackGraph, serialize, GRAPH_FILE, readCommitted };

if (require.main === module)
{
    const out = serialize(buildStackGraph());
    if (process.argv.includes('--write'))
    {
        fs.writeFileSync(GRAPH_FILE, out);
        console.log(`stack-graph: wrote ${path.relative(ROOT, GRAPH_FILE)}`);
    }
    else if (readCommitted() !== out)
    {
        console.error('stack-graph: committed scripts/stack-graph.json is stale - run `node scripts/stack-graph.js --write`');
        process.exit(1);
    }
    else
    {
        console.log('stack-graph: committed graph is in sync.');
    }
}
