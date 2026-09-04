#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// PreToolUse gate (matchers: Write + Edit + NotebookEdit + Bash): a session belongs to ONE
// project. Work in project A that turns out to need a change in project B - a sibling repo, a
// consumed package, a related service - is HANDED OFF, never applied: the session writes a task
// card for B and stops there. Reading and investigating B is untouched (no Read/Grep/Glob
// matcher), because deciding what B must do requires reading B.
//
// Why a hook and not prose: a cross-repo edit is a discrete event with a decidable test (does
// the write target resolve inside this project's root?), and the cost of getting it wrong is
// the expensive kind - a change landing in a repo whose tests, conventions, review and release
// this session never ran, invisible to the project that owns it.
//
// Reads pass. Writes inside the project root pass. Writes to the session's own scratch (the OS
// temp dir), to the Claude account dir (~/.claude - settings, memory, plugins), and to /dev pass.
// Everything else is blocked with the task-card instruction. exit 2 = block (stderr fed back);
// exit 0 = allow. Fail-open on anything unparseable, and on a root that cannot be resolved.
const fs = require('fs');
const os = require('os');
const path = require('path');
let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // unparseable stdin - don't block
}

const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
if (!root) process.exit(0);
// Compare REAL paths on both sides or the gate misfires: on macOS /tmp is a symlink to
// /private/tmp and os.tmpdir() reports the /var/folders form of an already-/private path, so a
// raw string comparison calls the project's own file 'outside' and an allowed temp dir 'unknown'
// (both reproduced by this hook's tests before this existed). A target that does not exist yet
// has no realpath, so resolve the deepest ancestor that does and re-attach the remainder.
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
function realish(p) {
  let dir = path.resolve(p);
  const rest = [];
  for (let i = 0; i < 64; i++) {
    if (fs.existsSync(dir)) return path.join(real(dir), ...rest);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    rest.unshift(path.basename(dir));
    dir = parent;
  }

  return path.resolve(p);
}
const ROOT = real(root);

// Anything under one of these may be written even though it is outside the project: the
// session's own scratch, the account-level Claude config (memory writes land here - blocking
// them breaks the memory system), the hook log dir, and device files. CLAUDE_STACK_ALLOW_WRITE_OUTSIDE
// is the deliberate escape hatch: a colon-separated list of extra roots for the rare project
// that really does own a second tree (a generated-output dir, a deploy checkout).
const HOME = os.homedir() || '';
const allowRoots = [
  os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/dev',
  process.env.CLAUDE_STACK_HOOK_LOG_DIR,
  ...(HOME ? [path.join(HOME, '.claude')] : []),
  ...(process.env.CLAUDE_STACK_ALLOW_WRITE_OUTSIDE || '').split(':'),
].filter(Boolean).map(real);

function inside(target, dir) {
  const t = realish(target);
  return t === dir || t.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
}
// An allowance that CONTAINS the project root would swallow the whole gate - every sibling
// repo would sit inside it too. On macOS os.tmpdir() is under /var/folders, so a project
// worked on from a temp dir is exactly that case (it is how this hook's own tests run).
const effectiveAllow = allowRoots.filter((d) => !inside(ROOT, d));
// ~/.claude-<space> account dirs are siblings of ~/.claude, matched by prefix below.
const spacePrefix = HOME && !inside(ROOT, real(HOME)) ? real(HOME) + path.sep + '.claude-' : null;
function allowed(target) {
  const t = realish(target);
  if (inside(t, ROOT)) return true;
  if (effectiveAllow.some((d) => inside(t, d))) return true;
  if (spacePrefix && t.startsWith(spacePrefix)) return true;

  return false;
}
// Resolve the way the session sees it: the hook subprocess's cwd is not the Bash tool's
// persisted cwd, so a relative path is anchored to the project root first (same anchor the
// sibling guards use). A relative path that stays inside the root is the normal case and passes.
function resolveTarget(p) {
  if (path.isAbsolute(p)) return p;

  return path.resolve(ROOT, p);
}

const docsRoot = process.env.CLAUDE_DOCS_PATH || '.claude/docs';
// Name the other PROJECT, not the file: its repo root when one is findable (the nearest
// ancestor holding a .git), else the first path segment that diverges from this project.
function otherProjectName(target) {
  let dir = path.dirname(realish(target));
  for (let i = 0; i < 64; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return path.basename(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const parts = realish(target).split(path.sep);
  const rootParts = ROOT.split(path.sep);
  let i = 0;
  while (i < parts.length && i < rootParts.length && parts[i] === rootParts[i]) i++;

  return parts[i] || path.basename(path.dirname(realish(target)));
}
function block(what, target) {
  const other = otherProjectName(target);
  process.stderr.write(
    `Blocked: ${what} targets '${target}', which is outside this session's project\n` +
    `(${ROOT}). A session belongs to ONE project - a change another repo needs is HANDED OFF,\n` +
    `not applied here, because a change landing there skips that repo's tests, conventions,\n` +
    `review and release, and its own project never sees it.\n\n` +
    `Write a task card instead, inside THIS project:\n` +
    `  ${path.join(docsRoot, 'cross-project-tasks', '<other-project>.md')}\n` +
    `naming the target repo and, per task: what must change and where (file + symbol, from your\n` +
    `investigation), why this project needs it, the contract both sides must agree on, and how\n` +
    `the other side can verify it. Then finish YOUR side against the current behaviour of\n` +
    `${other}, or say plainly what is blocked until that task lands.\n\n` +
    `Reading and investigating ${other} stays open - that is how the card gets specific.\n` +
    `If this project genuinely owns that tree, add its root to CLAUDE_STACK_ALLOW_WRITE_OUTSIDE.`,
  );
  process.exit(2);
}

const input = payload.tool_input || {};
const tool = payload.tool_name;

if (tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit') {
  const target = input.file_path || input.notebook_path;
  if (!target) process.exit(0);
  const abs = resolveTarget(String(target));
  if (!allowed(abs)) block(`${tool} of a file`, String(target));
  process.exit(0);
}

if (tool !== 'Bash') process.exit(0);

// A heredoc body is DATA, not shell - a plan that DESCRIBES a command is inert text, and
// matching it blocks a document write for its own prose. Blank the payload, keep the length.
const command = String(input.command || '').replace(
  /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm,
  (m) => m.replace(/[^\n]/g, ' '),
);
if (!command.trim()) process.exit(0);

// Only WRITE-shaped commands are considered, and only the paths they actually write to. A path
// that resolves inside the project - the overwhelming majority, relative paths included - never
// reaches the check, so the false-positive surface is limited to commands genuinely writing out
// of tree. Read-shaped commands (cat, grep, ls, find, git log/diff/show) are not listed at all.
const WRITE_PATTERNS = [
  // shell redirection into a file, `>>` included; `2>&1` and `>&2` are not file targets
  { re: />>?\s*(?!&)("[^"]+"|'[^']+'|[^\s;|&<>()]+)/g, what: 'a shell redirection' },
  { re: /\btee\s+(?:-\w+\s+)*("[^"]+"|'[^']+'|[^\s;|&<>()]+)/g, what: 'a `tee` write' },
  { re: /\b(?:sed|perl)\s+[^;|&]*-i[^;|&]*?\s("[^"]+"|'[^']+'|[^\s;|&<>()]+)\s*(?:;|\||&|$)/g, what: 'an in-place edit' },
  { re: /\b(?:cp|mv|ln|install|rsync)\s+[^;|&]*?\s("[^"]+"|'[^']+'|[^\s;|&<>()]+)\s*(?:;|\||&|$)/g, what: 'a copy/move destination' },
  { re: /\b(?:rm|rmdir|mkdir|touch|truncate|chmod|chown)\s+(?:-\S+\s+)*("[^"]+"|'[^']+'|[^\s;|&<>()]+)/g, what: 'a filesystem change' },
  // `mv` REMOVES its source, so an out-of-tree source is a write to that tree even when the
  // destination is local - the destination-only rule above would have waved it through.
  { re: /\bmv\s+(?:-\S+\s+)*("[^"]+"|'[^']+'|[^\s;|&<>()]+)/g, what: 'a move OUT of another project' },
  // `git -C <dir> <mutating subcommand>` is a write to that dir even with no path argument
  { re: /\bgit\s+-C\s+("[^"]+"|'[^']+'|[^\s;|&<>()]+)\s+(?:commit|add|checkout|switch|merge|rebase|reset|revert|restore|push|pull|apply|am|cherry-pick|stash|clean|rm|mv|tag|branch\s+-[dDm])\b/g, what: 'a git write in another checkout' },
];
const unquote = (s) => s.replace(/^["']|["']$/g, '');
for (const { re, what } of WRITE_PATTERNS) {
  let m;
  while ((m = re.exec(command)) !== null) {
    const raw = unquote(m[1]);
    // Only an explicitly out-of-tree path counts: absolute, ~-rooted, or reaching up with `..`.
    // A bare relative path is this project's own file - the case that must never be blocked.
    if (!/^([~/]|\.\.[/\\])/.test(raw) && !raw.includes('/../') && !/^\.\.$/.test(raw)) continue;
    const expanded = raw.startsWith('~') && HOME ? path.join(HOME, raw.slice(1)) : raw;
    if (/\$\{?[A-Za-z_]/.test(expanded)) continue;   // an unexpanded variable - cannot judge, don't guess
    if (!allowed(resolveTarget(expanded))) block(what, raw);
  }
}
process.exit(0);
