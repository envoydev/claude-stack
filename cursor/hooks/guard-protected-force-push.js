#!/usr/bin/env node
// Cursor `beforeShellExecution` hook: block a force-push or deletion of a protected
// branch (main / master / develop). Reads { command, cwd? } on stdin, returns
// { permission }. Speaks Cursor's hooks.json v1 contract (beforeShellExecution).
//
// Shares its decision logic with the Claude guard (claude/hooks/guard-protected-force-push.js)
// so BOTH cover the same surface (the model in CLAUDE.md calls these the same guard
// re-expressed). The command is split on ;|& into segments (like the rm guard) and
// `git push` must be a segment's own COMMAND, not a substring of another program's
// argument, so `echo "git push --force"` no longer false-positives. It blocks a `git
// push` that would irreversibly rewrite or remove a protected branch:
//   - a force: -f / --force / --force-with-lease / --force-if-includes, a clustered
//     short flag (-fu / -uf), a '+'-prefixed refspec, --mirror (incl. --mirror=<value>),
//     or a forced --all;
//   - a deletion: a `:branch` (empty-source) refspec, or --delete / -d;
//   - named explicitly (refspec, normalized past any refs/heads/ prefix and one layer
//     of surrounding quotes), or a bare force/delete while HEAD is on a protected
//     branch (when cwd is available).
// A plain fast-forward push, or any force on a feature branch, passes.
// Out of scope (matches the rm guard's honesty): indirection that hides the push from
// a flat token scan - aliases, `eval`, subshells, or git invoked via a wrapper script -
// is NOT caught here; this guard reads the literal command.
'use strict';
const { execFileSync } = require('child_process');

// Same segment split as the rm guard so each `git push` is inspected as its own command.
const SEPARATORS = /[;|&]{1,2}|\n/;

const PROTECTED = ['main', 'master', 'develop'];
const FORCE_FLAG = /^(?:-f|--force|--force-with-lease|--force-if-includes)(?:=\S*)?$/;

// Strip one layer of surrounding quotes (same shape as the rm guard) so a quoted
// refspec - `git push origin "main" --force` - normalizes to the bare token.
function unquote(tok)
{
    const t = tok.trim();
    if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'"))))
    {
        return t.slice(1, -1);
    }

    return t;
}

// Unquote, then drop a leading '+' (force marker) and any 'refs/heads/' prefix for the protected check.
function normalizeBranch(ref)
{
    return unquote(ref).replace(/^\+/, '').replace(/^refs\/heads\//, '');
}

// Destination side of a refspec: '+src:dst' / 'src:dst' -> 'dst'; 'dst' -> 'dst'.
function refDestination(token)
{
    const ref = unquote(token).replace(/^\+/, '');
    const colon = ref.indexOf(':');

    return colon === -1 ? ref : ref.slice(colon + 1);
}

// Source side of a refspec; '' for a deletion refspec like ':main'.
function refSource(token)
{
    const ref = unquote(token).replace(/^\+/, '');
    const colon = ref.indexOf(':');

    return colon === -1 ? ref : ref.slice(0, colon);
}

// A "bare" push has no explicit refspec - at most the remote name; it targets HEAD.
function isBarePush(after)
{
    return after.filter(t => !t.startsWith('-')).length <= 1;
}

function currentBranch(cwd)
{
    if (!cwd)
    {
        return null; // Cursor payload didn't carry a workspace path -> fail open on the bare-push check
    }

    try
    {
        return execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
    }
    catch
    {
        return null;
    }
}

// The tokens of a segment whose COMMAND is `git push`, sliced to those after `push`;
// null if this segment is not a git push. Mirrors the rm guard's command-position
// discipline: skip leading env-assignments and benign prefixes, require `git` (or a
// `.../git` path) as the command and `push` as its subcommand. `git -C dir push` and
// `git -c k=v push` are handled by skipping git's own pre-subcommand options.
function pushArgs(seg)
{
    const tokens = seg.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])
        || tokens[i] === 'sudo' || tokens[i] === 'command' || tokens[i] === 'nice' || tokens[i] === 'time'))
    {
        i++;
    }

    const cmd = tokens[i];
    if (!cmd || !(cmd === 'git' || cmd.endsWith('/git')))
    {
        return null;
    }

    // Walk git's own options/values before the subcommand (`-C dir`, `-c k=v`, `--git-dir=...`).
    let j = i + 1;
    while (j < tokens.length && tokens[j].startsWith('-'))
    {
        const opt = tokens[j];
        j++;
        if ((opt === '-C' || opt === '-c') && j < tokens.length)
        {
            j++; // skip the option's value token
        }
    }

    return tokens[j] === 'push' ? tokens.slice(j + 1) : null;
}

function isProtectedForcePush(command, cwd)
{
    for (const seg of command.split(SEPARATORS))
    {
        const after = pushArgs(seg);
        if (after === null)
        {
            continue;
        }

        const hasForceFlag = after.some(t => FORCE_FLAG.test(t))
            || after.some(t => /^-[A-Za-z]*f[A-Za-z]*$/.test(t) && !t.startsWith('--')); // clustered -fu / -uf
        const hasDeleteFlag = after.includes('--delete') || after.includes('-d');

        // --mirror / --mirror=<value> (and a forced --all) rewrite/prune every remote ref
        // without naming them.
        if (after.some(t => t === '--mirror' || t.startsWith('--mirror='))
            || (after.includes('--all') && hasForceFlag))
        {
            return true;
        }

        // Explicit refspec whose destination is a protected branch, when the op is a force
        // ('+' prefix or a force flag) or a delete (--delete/-d, or an empty-source ':dst').
        // Unquote first so a quoted token - `"main"` or `"+main"` - is read correctly.
        const targets = after.filter(t => !t.startsWith('-') && PROTECTED.includes(normalizeBranch(refDestination(t))));
        for (const t of targets)
        {
            const u = unquote(t);
            if (u.startsWith('+') || hasForceFlag || hasDeleteFlag || refSource(t) === '')
            {
                return true;
            }
        }

        // Bare push targets HEAD's branch - block a force or delete of a protected one.
        if (isBarePush(after) && PROTECTED.includes(currentBranch(cwd)) && (hasForceFlag || hasDeleteFlag))
        {
            return true;
        }
    }

    return false;
}

let input = '';
process.stdin.on('data', d => (input += d));
process.stdin.on('end', () =>
{
    let cmd = '';
    let cwd = '';
    try
    {
        const p = JSON.parse(input);
        cmd = p.command || '';
        cwd = p.cwd || p.workspace_root || p.workspaceRoot || '';
    }
    catch {}

    if (isProtectedForcePush(cmd, cwd))
    {
        process.stdout.write(JSON.stringify({
            permission: 'deny',
            user_message: 'Blocked rewriting/deleting a shared branch (main/master/develop): no force-push, branch deletion, or --mirror. Use --force-with-lease on a feature branch and open a PR.',
            agent_message: 'A Cursor hook blocked a force-push / deletion of a protected branch (main/master/develop).'
        }));
    }
    else
    {
        process.stdout.write(JSON.stringify({ permission: 'allow' }));
    }
});
