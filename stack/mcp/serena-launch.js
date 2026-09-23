#!/usr/bin/env node
'use strict';
// THE SERENA SERVER'S LAUNCHER - it exists to pick the Python serena runs on.
//
// A plugin MCP entry is a fixed argv, and the right interpreter is a property of the MACHINE: 3.13
// everywhere, the x64 3.13 on Windows on ARM (uv-python.js says why). A fixed `--python` in the
// entry would be wrong on one of them, and a hand patch of the cached entry is lost on the next
// marketplace refresh - measured: the entry Claude Code launches is read from the marketplace clone,
// not the plugin cache, so a patch there too is overwritten by `claude plugin marketplace update`.
//
//   node serena-launch.js --package serena-agent@<ver> -- <serena arguments>
//
// Everything after `--` goes to serena unchanged. stdout is the MCP stream: nothing is written to it
// here, diagnostics go to stderr, which Claude Code shows in the server's log.
//
// It also spells SERENA_HOME in the platform's own separator, and leaves it RELATIVE. serena 1.7.0
// execs the TypeScript server through npm's .bin shim, so on Windows the path reaches cmd.exe
// UNQUOTED: '.serena/home\...' is cut at its first '/' ('.serena' is not recognized as an internal
// or external command), and an absolute path would be cut at the first space in the project's own
// path the same way. The cwd of a plugin server is the project (measured), so '.serena\home' is that
// project's own home, as it is on the copy route.
const path = require('node:path');
const { pythonRequest, runUvx } = require('./uv-python.js');

const nativeHome = (value, platform = process.platform) => (platform === 'win32' ? path.win32 : path.posix).normalize(value);
// The copy route registers the same spelling - the same directory on disk either way.
const serenaHomeFor = (platform = process.platform) => nativeHome('.serena/home', platform);

function main(argv)
{
    const at = argv.indexOf('--package');
    const rest = argv.indexOf('--');
    // The pin is passed in by the generated plugin entry (meta/mcp-pins.json owns the version), so
    // an absent flag means the entry was hand-edited - say so rather than launch something else.
    if (at < 0 || !argv[at + 1] || argv[at + 1] === '--')
    {
        process.stderr.write('serena-launch: --package <spec> is required (the plugin entry passes it)\n');
        return 2;
    }
    const spec = argv[at + 1];
    const projectDir = process.cwd();
    const args = rest < 0 ? [] : argv.slice(rest + 1);
    const env = { ...process.env };
    if (env.SERENA_HOME) env.SERENA_HOME = nativeHome(env.SERENA_HOME);
    process.stderr.write(`serena-launch: ${spec}, python ${pythonRequest({ env, projectDir })}, home ${env.SERENA_HOME || '(serena default)'}\n`);
    runUvx(['--from', spec, 'serena', ...args], { env, projectDir, label: 'serena-launch' });
    return null;   // the process lives as long as the child does
}

if (require.main === module)
{
    const rc = main(process.argv.slice(2));
    if (rc !== null) process.exit(rc);
}
module.exports = { main, nativeHome, serenaHomeFor };
