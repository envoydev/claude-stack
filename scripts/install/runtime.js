'use strict';
// THE PROCESS EDGE - everything the layers need from the machine, in one place.
//
// Every layer above this takes its side effects as injected functions, which is what makes them
// testable without a machine. This module is the one that actually spawns, and it is deliberately
// thin: no decisions live here, only the calls.
//
// Two rules the shell learned:
//
//   - A MISSING TOOL IS FAIL-SOFT, never an abort. `claude` absent means the plugin and MCP layers
//     are skipped and reported; the file layers still land.
//   - A COMMAND'S EXIT CODE IS THE ANSWER, never its output. The verify passes read files.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const which = (cmd) => spawnSync(process.platform === 'win32' ? 'where' : 'command',
    process.platform === 'win32' ? [cmd] : ['-v', cmd],
    { shell: process.platform !== 'win32', stdio: 'ignore' }).status === 0;

// One runner for every `claude ...` call: returns true on exit 0, and prints nothing unless the
// caller asks for the output.
function cliRunner(bin, { cwd, env, out = () => {} } = {})
{
    return (argv, { quiet = false } = {}) =>
    {
        const r = spawnSync(bin, argv, { cwd, env, encoding: 'utf8' });
        if (!quiet && r.stdout) out(r.stdout.trimEnd().split('\n').slice(-1)[0]);
        return r.status === 0;
    };
}

// The captured stdout of one call, '' when it could not run - the shape every read-back wants.
function capture(bin, argv, { cwd, env } = {})
{
    const r = spawnSync(bin, argv, { cwd, env, encoding: 'utf8' });
    return r.status === 0 ? (r.stdout || '') : '';
}

function gitRoot(cwd)
{
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : '';
}

// A node script from the source snapshot, run with its own argv. Used for selection-plugins.js and
// the memory importer - both of which ship in the snapshot rather than beside this file.
function runNode(script, argv, { cwd, env } = {})
{
    const r = spawnSync(process.execPath, [script, ...argv], { cwd, env, encoding: 'utf8' });
    return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const lines = (text) => String(text).split('\n').map((l) => l.trim()).filter(Boolean);

module.exports = { which, cliRunner, capture, gitRoot, runNode, lines, join: path.join };
