#!/usr/bin/env node
// Cursor `beforeShellExecution` hook: block a recursive `rm` of a catastrophic,
// unrecoverable target (/, ~, $HOME, or a bare *) - quoted forms too, including a
// quoted prefix with the glob outside the quotes (`"$HOME"/*`). ..-segments are
// collapsed first, so a path that resolves to root (`/home/../`, `/usr/../`) is caught;
// naming MULTIPLE single-segment absolute paths (`/usr /lib /etc /var`) is also caught -
// the multi-arg system wipe each dir dodges individually. The filesystem has no reflog,
// so this is the rm analog of guard-protected-force-push.js. Reads { command } on stdin,
// returns { permission }. Speaks Cursor's hooks.json v1 contract (beforeShellExecution).
//
// Out of scope (same honesty as the force-push guard): indirection that deletes
// without a literal recursive `rm` of one of these targets - `find ... -delete`,
// `xargs rm`, `eval`, a subshell, or rm via a wrapper script - is NOT caught here;
// this guard reads the literal command's flat tokens.
'use strict';

const SEPARATORS = /[;|&]{1,2}|\n/;

function hasRecursive(args)
{
    return args.some(t => t === '--recursive' || (/^-[A-Za-z]+$/.test(t) && /[rR]/.test(t)));
}

function unquote(tok)
{
    const t = tok.trim();
    if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'"))))
    {
        return t.slice(1, -1);
    }

    return t;
}

// Clean a token down to its comparable path: strip ALL quote characters - not just a
// fully-wrapping pair - so a quoted prefix with the glob outside the quotes (`"$HOME"/*`)
// collapses to the same '$HOME/*' as the unquoted form. Then collapse any '..' segments
// (literal-string matching would let '/home/../' and '/usr/../' resolve away to '/' at run
// time yet read as non-catastrophic here) and drop a trailing slash. $HOME stays literal.
function cleanTarget(tok)
{
    let t = unquote(tok).replace(/['"]/g, '');
    const absolute = t.startsWith('/');
    const trailingGlob = /\/\*$/.test(t);
    // Collapse '..' against earlier segments; '/home/..' -> '', './a/..' -> '.', 'a/../..' -> '..'.
    const out = [];
    for (const seg of t.split('/'))
    {
        if (seg === '..' && out.length && out[out.length - 1] !== '..' && out[out.length - 1] !== '')
        {
            out.pop();
        }
        else
        {
            out.push(seg);
        }
    }
    t = out.join('/');
    // A collapse that emptied an absolute path leaves bare '/' (or '/*' if it ended in a glob).
    if (absolute && (t === '' || t === '/'))
    {
        t = trailingGlob ? '/*' : '/';
    }

    return t.replace(/\/+$/, '') || (absolute ? '/' : t);
}

// Catastrophic, unrecoverable single targets: root, home, or a bare whole-dir glob.
function isCatastrophic(tok)
{
    // Drop '.' path segments (a no-op in a path) so './.', '././', and './*' read the
    // same as the bare cwd targets, then compare against the unrecoverable literals.
    const cleaned = (cleanTarget(tok) || '/').split('/').filter(s => s !== '.').join('/');
    const t = cleaned === '' ? '.' : cleaned;

    return t === '/' || t === '/*' || t === '/.'
        || t === '~' || t === '~/*'
        || t === '$HOME' || t === '${HOME}' || t === '$HOME/*' || t === '${HOME}/*'
        || t === '$PWD' || t === '${PWD}' || t === '$PWD/*' || t === '${PWD}/*'
        || t === '*' || t === './*' || t === '.';
}

// A single-segment absolute path ('/usr', '/etc', '/var') - non-catastrophic alone, but
// a recursive rm naming TWO OR MORE of them is a system wipe each arg dodges individually.
function isTopLevelDir(tok)
{
    return /^\/[^/]+$/.test(cleanTarget(tok));
}

function isCatastrophicRm(command)
{
    for (const seg of command.split(SEPARATORS))
    {
        const tokens = seg.trim().split(/\s+/).filter(Boolean);
        // Skip leading env-assignments and benign prefixes so `rm` must be the segment's COMMAND,
        // not an argument to another program (no false positive on `echo rm -rf /` or a commit msg).
        let i = 0;
        while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])
            || tokens[i] === 'sudo' || tokens[i] === 'command' || tokens[i] === 'nice' || tokens[i] === 'time'))
        {
            i++;
        }

        const cmd = tokens[i];
        if (!cmd || !(cmd === 'rm' || cmd.endsWith('/rm')))
        {
            continue;
        }

        const args = tokens.slice(i + 1);
        if (!hasRecursive(args))
        {
            continue;
        }

        const paths = args.filter(a => !a.startsWith('-'));
        if (paths.some(isCatastrophic) || paths.filter(isTopLevelDir).length >= 2)
        {
            return true;
        }
    }

    return false;
}

let input = '';
process.stdin.on('data', d => (input += d));
process.stdin.on('end', () => {
  let cmd = '';
  try { cmd = JSON.parse(input).command || ''; } catch {}
  if (isCatastrophicRm(cmd)) {
    process.stdout.write(JSON.stringify({
      permission: 'deny',
      user_message: 'Blocked a recursive rm of a catastrophic target (/, ~, $HOME, a bare *, or several top-level system dirs).',
      agent_message: 'A Cursor hook blocked an unrecoverable rm -rf of a root/home/glob/system-dir target.'
    }));
  } else {
    process.stdout.write(JSON.stringify({ permission: 'allow' }));
  }
});
