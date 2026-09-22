#!/usr/bin/env node
'use strict';
// THE NODE SEED - one installer instead of the sh / ps1 twins (Phase 7).
//
// Node is already a hard prerequisite (every hook runs on it), so this adds no runtime dependency
// and removes the twin-parity tax: a bug gets fixed once, a flag gets added once, and a Windows
// path is the same code path as a macOS one rather than a second implementation of it.
//
// UNTIL THE LAYERS LAND, THIS REFUSES TO INSTALL. T1 is the flag surface and the source snapshot;
// the copy, settings, plugin, MCP, serena, memory and docs layers are T2 to T4. A seed that ran
// with half its layers would write a half-installed project and report success, which is worse than
// not running - so `install` and `update` exit non-zero and name the shell twin, and `--print-plan`
// is the one action that works, because it only reports.
//
// The twins stay the default route until this is complete and proven (Phase 7's R1): there is no
// Windows machine here, and `pwsh` on macOS proves PowerShell syntax, never Windows path semantics.
const path = require('node:path');

const { parseArgs, FLAG_LIST } = require('./args.js');
const { createSource } = require('./source.js');

const USAGE = `claude-stack - install or update the Claude Code stack into a project.

Usage: node ${path.basename(__filename)} <install|update> [flags]

Action (one is REQUIRED, positional):
  install   first-time provision; wires .claude/settings.json
  update    refresh hooks/agents/rules and re-resolve the runtimes; idempotent

Named flags (any order, each optional): ${FLAG_LIST}

Every flag means exactly what it means on scripts/os/claude-stack.sh - this is a rewrite, not a
redesign. Run \`bash scripts/os/claude-stack.sh --help\` for what each one does.`;

// The layers this seed still needs before it can install anything. Named, so the refusal says what
// is missing rather than 'not implemented'.
const PENDING_LAYERS = ['copy', 'settings', 'plugins', 'mcp', 'serena', 'memory', 'docs', 'stamp'];

function main(argv, env, io)
{
    const { out, err } = io;

    let args;
    try { args = parseArgs(argv, env); }
    catch (e)
    {
        err(`${USAGE}\nerror: ${e.message}\n`);
        return 1;
    }

    const configDir = env.CLAUDE_CONFIG_DIR
        || path.join(env.HOME || env.USERPROFILE || '', args.space ? `.claude-${args.space}` : '.claude');

    const source = createSource({
        configDir,
        sourceDir: args.source,
        repoUrl: env.CLAUDE_STACK_REPO_URL || 'https://github.com/envoydev/claude-stack',
        log: (m) => out(`==> ${m}\n`),
        note: (m) => err(`  !! ${m}\n`),
        fetchArchive: () => null,   // T1 resolves a handed source and the plugin cache; the two
        clone: () => null,          // outward routes land with the rest of the run, in T7
    });

    try
    {
        const resolved = source.resolve();
        if (!resolved) return 1;

        out(`==> action: ${args.action} [scope=${args.scope}, account=${configDir}]\n`);
        out(`==> source: ${resolved.dir} (${resolved.route})\n`);

        if (args.printPlan)
        {
            out(`==> plan: ${args.action} from ${resolved.route}, scope ${args.scope}, context7 ${args.context7}\n`);
            for (const key of ['space', 'memoryLevel', 'docsVersioning', 'sentryAuth', 'sentrySlug', 'selection'])
                if (args[key]) out(`      ${key}: ${args[key]}\n`);
            if (args.playwrightBrowsers.length) out(`      playwright: ${args.playwrightBrowsers.join(', ')}\n`);
            return 0;
        }

        err(`error: this seed is incomplete - the ${PENDING_LAYERS.join(', ')} layers are not built yet (Phase 7, T2-T4).\n`
            + `Use the shell installer for a real run: bash scripts/os/claude-stack.sh ${args.action} ...\n`);
        return 2;
    }
    finally { source.cleanup(); }
}

if (require.main === module)
{
    process.exitCode = main(process.argv.slice(2), process.env, {
        out: (s) => process.stdout.write(s),
        err: (s) => process.stderr.write(s),
    });
}

module.exports = { main, USAGE, PENDING_LAYERS };
