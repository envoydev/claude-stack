#!/usr/bin/env node
'use strict';
// THE NODE SEED - one installer instead of the sh / ps1 twins (Phase 7).
//
// Node is already a hard prerequisite (every hook runs on it), so this adds no runtime dependency
// and removes the twin-parity tax: a bug gets fixed once, a flag gets added once, and a Windows
// path is the same code path as a macOS one rather than a second implementation of it.
//
// This file is the ORDER and nothing else. Every decision lives in a layer module beside it, every
// side effect arrives as an injected function, and the sequence below is the shell's own - the one
// property a rewrite must not quietly change, because each step depends on what the previous one
// left on disk (the plugins are enabled before the copied files they replace are pruned; the stamp
// is written after every copy step, so it only ever names a revision that fully landed).
//
// The twins stay reachable behind `CLAUDE_STACK_SEED=shell` for one release (R1): there is no
// Windows machine here, and `pwsh` on macOS proves PowerShell syntax, never Windows path semantics.
const fs = require('node:fs');
const path = require('node:path');

const { parseArgs, FLAG_LIST } = require('./args.js');
const { createSource } = require('./source.js');
const { loadManifest } = require('./manifest.js');
const selection = require('./selection.js');
const plugins = require('./plugins.js');
const mcp = require('./mcp.js');
const copy = require('./copy.js');
const settings = require('./settings.js');
const serena = require('./serena.js');
const memory = require('./memory.js');
const docs = require('./docs.js');
const { deriveState, writable } = require('../derive-state.js');
const seeds = require('./seeds.js');
const pinsLayer = require('./pins.js');
const stampLayer = require('./stamp.js');
const runtime = require('./runtime.js');

const USAGE = `claude-stack - install or update the Claude Code stack into a project.

Usage: node ${path.basename(__filename)} <install|update> [flags]

Action (one is REQUIRED, positional):
  install   first-time provision; wires .claude/settings.json
  update    refresh hooks/agents/rules and re-resolve the runtimes; idempotent

Named flags (any order, each optional): ${FLAG_LIST}

Every flag means exactly what it means on scripts/os/claude-stack.sh - this is a rewrite, not a
redesign. Run \`bash scripts/os/claude-stack.sh --help\` for what each one does.`;

const HOOKS_PLUGIN = 'claude-stack-hooks@claude-stack';
const STACK_MARKET_NAME = HOOKS_PLUGIN.split('@')[1];
const STACK_MARKETPLACE = 'envoydev/claude-stack';
const CORE_DEP_PLUGINS = ['superpowers@claude-plugins-official'];
const SENTRY_URL = 'https://mcp.sentry.dev/mcp/${SENTRY_SLUG}';
const SENTRY_HEADER = 'Authorization: Sentry-Bearer ${SENTRY_ACCESS_TOKEN}';
const CONTEXT7_URL = 'https://mcp.context7.com/mcp';
// permissions.deny, the Read-tool half of the credential gate: it reaches the Read TOOL ONLY (a
// shell `cat` of a denied file is not blocked by anything here - guard-secret-value.js is that
// route). RETIRED_DENY are the four ACCOUNT-settings entries releases up to 0.2.62 wrote; they are
// dropped on every run, by exact string.
const SECRET_DENY = ['Read(.env)', 'Read(.env.*)', 'Read(*.pem)', 'Read(*.pfx)', 'Read(*.p12)', 'Read(*.key)'];
const RETIRED_DENY = [
    'Read(~/.claude/settings.json)', 'Read(~/.claude/settings.local.json)',
    'Read(~/.claude-*/settings.json)', 'Read(~/.claude-*/settings.local.json)',
];
// The two hook ENGINES and the window table are copied beside the hooks rather than wired: 22
// bodies shared with cursor-stack run `node .claude/hooks/docs.js`.
const HOOK_ENGINES = ['docs.js', 'memory.js', 'model-windows.json'];

function main(argv, env, io)
{
    const { out, err } = io;
    const cwd = io.cwd || process.cwd();
    const rt = io.runtime || runtime;

    let failures = 0;
    const log = (m) => out(`==> ${m}\n`);
    const plain = (m) => out(`${m}\n`);
    const note = (m) => { failures += 1; out(`==>   !! ${m}\n`); };

    let args;
    try { args = parseArgs(argv, env); }
    catch (e) { err(`${USAGE}\nerror: ${e.message}\n`); return 1; }

    const home = env.HOME || env.USERPROFILE || '';
    const configDir = env.CLAUDE_CONFIG_DIR
        || path.join(home, args.space ? `.claude-${args.space}` : '.claude');
    const projectRoot = rt.gitRoot(cwd) || cwd;
    const claudeDir = args.scope === 'user' ? configDir : path.join(projectRoot, '.claude');
    const skillsDir = args.scope === 'user' ? path.join(configDir, 'skills') : path.join(projectRoot, '.claude', 'skills');
    const mcpFile = path.join(projectRoot, '.mcp.json');
    const hasClaude = rt.which('claude');

    const repoUrl = env.CLAUDE_STACK_REPO_URL || 'https://github.com/envoydev/claude-stack';
    const source = createSource({
        configDir,
        sourceDir: args.source,
        repoUrl,
        log, note,
        gitRevision: rt.gitRevision,
        // The two outward routes: reached only when neither --source nor the plugin cache answered,
        // which is a machine with no `claude` CLI, or a first run before the core plugin lands.
        fetchArchive: () => rt.fetchArchive({ repoUrl }),
        clone: () => rt.cloneMain({ repoUrl }),
    });

    try
    {
        const resolved = source.resolve();
        if (!resolved) return 1;
        log(`action: ${args.action} [scope=${args.scope}, account=${configDir}]`);

        const manifest = loadManifest(resolved.dir);
        const cli = hasClaude
            ? rt.cliRunner('claude', { cwd: projectRoot, env, out: plain })
            : () => false;

        // --- the six lists, narrowed to this project -------------------------------
        let lists = {
            skills: manifest.skills, agents: manifest.agents, rules: manifest.rules,
            hooks: manifest.hooks, plugins: manifest.plugins, mcps: manifest.mcps,
        };
        const routes = plugins.pluginRoutes(env);

        let picked = null;
        let listedEngines = [];
        // The off-state surfaces this run may write back: a walk's selection answers the agents
        // layer, and the hooks layer when it carries hook lines (none = every hook, as on disk); a
        // read-back answers only what it found evidence of.
        let answered = { hooks: true, agents: true };
        if (args.installedOnly)
        {
            const raw = hasClaude ? rt.capture('claude', ['plugin', 'list', '--json'], { cwd: projectRoot, env }) : '';
            const back = selection.readBack({
                claudeDir,
                mcpServers: Object.keys(readJson(mcpFile).mcpServers || {}),
                listing: plugins.parsePluginList(raw, projectRoot),
                stackListing: plugins.parsePluginList(raw, projectRoot, { marketplace: STACK_MARKET_NAME }),
                settings: readJson(path.join(claudeDir, 'settings.json')),
                routes, manifest, sourceDir: resolved.dir,
                stampHooks: readStampHooks(path.join(claudeDir, 'claude-stack.stamp')),
                always: readJson(path.join(resolved.dir, 'meta', 'recommendations.json')).always || {},
                marketplace: STACK_MARKET_NAME, log,
            });
            if (!back.installed)
            {
                err(`error: --installed-only found nothing installed under ${claudeDir} - run 'install' (or /claude-stack:setup) first\n`);
                return 1;
            }
            picked = selection.parseSelection(back.lines.join('\n'));
            answered = back.answered;
            listedEngines = back.engines;
            if (back.context7Local && !args.context7Given)
            { args.context7 = 'local'; log('installed-only: context7 stays local - its local entry is enabled here'); }
        }
        else if (args.selection)
        {
            let text;
            try { text = fs.readFileSync(args.selection, 'utf8'); }
            catch { err(`selection file not found: ${args.selection}\n`); return 1; }
            picked = selection.parseSelection(text);
            answered = { hooks: [...picked].some((l) => l.startsWith('hook ')), agents: true };
        }
        if (picked) lists = selection.applySelection(lists, picked);

        // --- the two entries assembled at install time -----------------------------
        const pins = args.printPlan
            ? { CTX7_PIN: '', PW_PIN: '', SERENA_PIN: '', MEMORY_PIN: '', MEMORY_BACKEND: 'sqlite_vec' }
            : mcp.resolvePins({ npmLatest: npmLatest(rt), pypiLatest: pypiLatest(rt), log });

        const level = memory.resolveLevel({
            flag: args.memoryLevel,
            registeredPath: registeredMemoryPath(mcpFile),
            home, space: args.space, projectRoot,
        });

        // context7 travels as ONE catalog row with two transports: the hosted remote, or the npx
        // one that `--context7 local` adds beside it.
        lists.mcps = lists.mcps.map((entry) => (entry.startsWith('context7|') && args.context7 === 'local'
            ? `context7|-- npx -y @upstash/context7-mcp${pins.CTX7_PIN}` : entry));

        const pw = mcp.expandPlaywright({
            mcps: lists.mcps,
            browsers: args.playwrightBrowsers,
            registered: [...new Set([...registeredEngines(mcpFile), ...listedEngines])],
            enabled: args.playwrightEnabled,
        });
        lists.mcps = pw.mcps;

        if (args.printPlan)
        {
            for (const line of selection.renderPlan(lists)) plain(line);
            return 0;
        }

        // --- the run ---------------------------------------------------------------
        const tokens = {
            SERENA_CONTEXT: 'claude-code', MEMORY_DB_PATH: level.dbPath,
            SERENA_PIN: pins.SERENA_PIN, PW_PIN: pins.PW_PIN, CTX7_PIN: pins.CTX7_PIN,
            MEMORY_PIN: pins.MEMORY_PIN, MEMORY_BACKEND: pins.MEMORY_BACKEND,
        };
        const remotes = {
            sentry: { url: SENTRY_URL, header: args.sentryAuth === 'oauth' ? '' : SENTRY_HEADER },
            context7: { url: CONTEXT7_URL, header: '' },
        };
        const ctx = {
            args, env, log, note, plain, cli, rt, source: resolved, manifest, lists, routes,
            projectRoot, claudeDir, skillsDir, configDir, mcpFile, home,
            pins, tokens, remotes, level, hasClaude, picked, answered,
        };

        const pinSnapshot = args.keepPins
            ? pinsLayer.snapshotPins({ files: pinFiles(ctx), log })
            : null;

        runLayers(ctx);

        if (pinSnapshot) pinsLayer.restorePins({ snapshot: pinSnapshot, files: pinFiles(ctx), log });

        stampLayer.writeStamp({
            source: resolved, action: args.action, scope: args.scope, configDir, projectRoot, mcpFile,
            hooksCatalog: manifest.catalogs.hooks, version: releaseVersion(resolved.dir), log, note,
        });

        summarise(ctx, failures);
        return failures ? 0 : 0;   // fail-soft by design: a step that failed is REPORTED, never fatal
    }
    catch (e)
    {
        err(`error: ${e.message}\n`);
        return 1;
    }
    finally { source.cleanup(); }
}

// The shell's own order. Every step depends on what the one before it left on disk.
function runLayers(ctx)
{
    const { args } = ctx;
    bootstrapSource(ctx);
    installSkillsAndAgents(ctx);
    installPlugins(ctx);
    installMcps(ctx);
    seeds.seedAccountKeys({ configDir: ctx.configDir, sentrySlug: ctx.args.sentrySlug, env: ctx.env, log: ctx.log, note: ctx.note });
    installHooksAndRules(ctx);
    importMemory(ctx);
    docs.migrateDocsDomains({ projectRoot: ctx.projectRoot, docsPath: copy.resolveDocsRoot(ctx.projectRoot), log: ctx.log });
    if (args.action === 'install') seeds.seedClaudeMd({ projectRoot: ctx.projectRoot, sourceDir: ctx.source.dir, log: ctx.log, note: ctx.note });
    serena.seedProject({
        projectRoot: ctx.projectRoot,
        selected: ctx.lists.mcps.some((e) => e.startsWith('serena|')),
        log: ctx.log,
    });
    seeds.playwrightDownloads({
        browsers: ctx.lists.mcps.filter((e) => e.startsWith('playwright-')).map((e) => e.split('|')[0].slice(11)),
        pin: ctx.pins.PW_PIN,
        run: (engine) => ctx.rt.runNode !== undefined && npxInstall(ctx, engine),
        log: ctx.log,
    });
    downconvert(ctx);
}

// A first run with no plugin cache installs the core entry FIRST, so its cache can serve the same
// run - which is what makes the common run download nothing at all.
function bootstrapSource(ctx)
{
    if (!ctx.hasClaude || !plugins.corePluginOn(ctx.routes)) return;
    ctx.cli(['plugin', 'marketplace', 'add', STACK_MARKETPLACE], { quiet: true });
    ctx.cli(['plugin', 'marketplace', 'update', 'claude-stack'], { quiet: true });
}

function installSkillsAndAgents(ctx)
{
    const closure = plugins.resolveStackPlugins({
        routes: ctx.routes,
        runSelection: () => runSelectionPlugins(ctx),
        log: ctx.log,
    });
    ctx.routes = closure.routes;
    ctx.stackEntries = closure.entries;

    // On the plugin route only the EXTRAS travel by copy, and a leftover copy SHADOWS the plugin's
    // own with no error and no sign in the transcript - so the prune runs BEFORE the enable.
    const skillNames = ctx.lists.skills.map((e) => e.split('|').pop());
    const keepSkills = ctx.routes.skills ? closure.extraSkills : skillNames;
    if (ctx.routes.skills)
        for (const name of ctx.manifest.skills.map((e) => e.split('|').pop()))
            if (!closure.extraSkills.includes(name) && fs.existsSync(path.join(ctx.skillsDir, name)))
            { fs.rmSync(path.join(ctx.skillsDir, name), { recursive: true, force: true }); ctx.log(`  skill pruned (now carried by a plugin): ${name}`); }

    fs.mkdirSync(ctx.skillsDir, { recursive: true });
    for (const name of keepSkills)
    {
        const src = path.join(ctx.source.dir, 'stack', 'skills', name);
        if (!fs.existsSync(src)) { ctx.note(`skill '${name}' not found in the stack source`); continue; }
        fs.rmSync(path.join(ctx.skillsDir, name), { recursive: true, force: true });
        fs.cpSync(src, path.join(ctx.skillsDir, name), { recursive: true });
        ctx.log(`skill [${ctx.args.scope}]: ${name}`);
    }

    const agents = ctx.routes.skills ? closure.extraAgents.map((n) => `${n}.md`) : ctx.lists.agents;
    copy.installFromSource({
        sourceDir: ctx.source.dir, subdir: path.join('stack', 'agents'), label: 'agent',
        destDir: path.join(ctx.claudeDir, 'agents'), files: agents, log: ctx.log, note: ctx.note,
    });
}

function installPlugins(ctx)
{
    if (!ctx.hasClaude) { ctx.note('the claude CLI is not on PATH - the plugin and MCP layers were skipped'); return; }
    const listing = plugins.parsePluginList(ctx.rt.capture('claude', ['plugin', 'list', '--json'], { cwd: ctx.projectRoot, env: ctx.env }), ctx.projectRoot);
    const set = plugins.pluginSet({
        routes: ctx.routes, thirdParty: ctx.lists.plugins, hooksPlugin: HOOKS_PLUGIN,
        stackEntries: ctx.stackEntries || [], coreDeps: CORE_DEP_PLUGINS,
    });
    if (ctx.args.action === 'update')
    {
        plugins.prunedRetired({ listing, retired: [], scope: ctx.args.scope, cli: ctx.cli, log: ctx.log });
        plugins.updatePlugins({
            plugins: set, scope: ctx.args.scope, before: listing, cli: ctx.cli, log: ctx.log,
            after: () => plugins.parsePluginList(ctx.rt.capture('claude', ['plugin', 'list', '--json'], { cwd: ctx.projectRoot, env: ctx.env }), ctx.projectRoot),
        });
        return;
    }
    plugins.installPlugins({
        plugins: set, scope: ctx.args.scope, listing, coreDeps: CORE_DEP_PLUGINS,
        cli: ctx.cli, log: ctx.log, note: ctx.note,
    });
}

function installMcps(ctx)
{
    if (!ctx.hasClaude) return;
    const retired = mcp.retiredMcps({ routes: ctx.routes, catalog: ctx.manifest.catalogs.mcps, authored: [] });
    for (const name of retired)
        if (ctx.cli(['mcp', 'remove', name, '-s', ctx.args.scope], { quiet: true })) ctx.log(`  mcp pruned: ${name}`);

    if (ctx.routes.mcps)
    {
        ctx.log('mcp: carried by the plugins (serena, context7, memory, and the picks) - nothing registered here');
        return;
    }
    for (const name of mcp.playwrightDrop({ routes: ctx.routes, browsers: pwEngines(ctx) }))
        if (ctx.cli(['mcp', 'remove', name, '-s', ctx.args.scope], { quiet: true })) ctx.log(`  mcp removed: ${name}`);

    const live = ctx.lists.mcps.filter((e) => !(mcp.isLocked(e.split('|')[0]) && mcp.corePluginOn(ctx.routes)));
    for (const entry of live)
    {
        const name = entry.split('|')[0];
        const args = entry.slice(entry.indexOf('|') + 1);
        if (ctx.args.action === 'update') ctx.cli(['mcp', 'remove', name, '-s', ctx.args.scope], { quiet: true });
        else if (ctx.cli(['mcp', 'get', name], { quiet: true })) { ctx.plain(`  mcp ${name} already configured - skipping`); continue; }
        ctx.log(`mcp [${ctx.args.scope}]: ${name}`);
        if (!ctx.cli(mcp.registerSpec({ name, args, scope: ctx.args.scope, remotes: ctx.remotes, tokens: ctx.tokens })))
            ctx.note(`mcp ${name} failed`);
    }

    // Read the RESULT back: `claude mcp add` over an existing name exits 0 without writing.
    const expects = live.map((e) => mcp.expectShape({
        name: e.split('|')[0], args: e.slice(e.indexOf('|') + 1), remotes: ctx.remotes, tokens: ctx.tokens,
    }));
    if (ctx.args.scope === 'project') mcp.verifyProject({ mcpFile: ctx.mcpFile, expects, log: ctx.log });
    else mcp.verifyUser({
        expects, scope: ctx.args.scope,
        getShape: (name) => ctx.rt.capture('claude', ['mcp', 'get', name], { cwd: ctx.projectRoot, env: ctx.env }),
        reregister: (name) =>
        {
            const entry = live.find((e) => e.split('|')[0] === name);
            ctx.cli(['mcp', 'remove', name, '-s', ctx.args.scope], { quiet: true });
            ctx.cli(mcp.registerSpec({ name, args: entry.slice(entry.indexOf('|') + 1), scope: ctx.args.scope, remotes: ctx.remotes, tokens: ctx.tokens }), { quiet: true });
        },
        log: ctx.log, note: ctx.note,
    });
}

function installHooksAndRules(ctx)
{
    // Only the two ENGINES and the window table are copied; the hooks themselves ride their plugin.
    const hookFiles = ctx.routes.hooks
        ? HOOK_ENGINES
        : [...new Set(ctx.lists.hooks.map((e) => e.split('::')[0]))].concat(HOOK_ENGINES, 'hook-prelude.js');
    copy.installFromSource({
        sourceDir: ctx.source.dir, subdir: path.join('stack', 'hooks'), label: 'hook',
        destDir: path.join(ctx.claudeDir, 'hooks'), files: hookFiles, exec: true, log: ctx.log, note: ctx.note,
    });
    copy.installFromSource({
        sourceDir: ctx.source.dir, subdir: path.join('stack', 'rules'), label: 'rule',
        destDir: path.join(ctx.claudeDir, 'rules'), files: ctx.lists.rules, log: ctx.log, note: ctx.note,
    });
    copy.stampDocsRoot(ctx.projectRoot, { log: ctx.log, note: ctx.note });

    const catalog = readJson(path.join(ctx.source.dir, 'meta', 'environment.json')).env || [];
    const migrations = readJson(path.join(ctx.source.dir, 'meta', 'migrations.json')).env || {};
    const wired = ctx.routes.hooks ? [] : ctx.lists.hooks;
    // ONE derivation decides what this project does NOT take (Phase 8): the hooks named off and the
    // seats denied. It runs whenever the run holds a selection: one a walk answered, or the one
    // --installed-only read back from this very state (`selection.readBack`), which writes it back
    // as it was - and only for the surfaces the read found evidence of (`writable`). No selection
    // at all (a bare install) writes no off-state.
    const state = ctx.picked ? deriveState({ selectionText: [...ctx.picked].join('\n'), sourceDir: ctx.source.dir }) : null;
    const { hooksOff, hooksAnswered, agentDeny, agentAllow } = writable(state, { routes: ctx.routes, answered: ctx.answered });
    settings.writeSettings({
        file: path.join(ctx.claudeDir, 'settings.json'),
        catalog, migrations, hookSpecs: wired,
        denySpecs: SECRET_DENY, retiredDeny: RETIRED_DENY, agentDeny, agentAllow,
        retiredHooks: ctx.routes.hooks ? [...new Set(ctx.manifest.catalogs.hooks.map((e) => e.split('::')[0]))] : [],
        docsVersioning: {
            value: ctx.args.docsVersioning,
            seed: docs.docsVersioningSeed({ projectRoot: ctx.projectRoot, docsPath: copy.resolveDocsRoot(ctx.projectRoot) }),
        },
        mcpNames: ctx.routes.mcps ? [] : ctx.lists.mcps.map((e) => e.split('|')[0]),
        mcpOff: ctx.routes.mcps ? ctx.manifest.catalogs.mcps.map((e) => e.split('|')[0]).concat(mcp.PW_SERVERS) : [],
        memoryDb: ctx.level.dbPath,
        sentryAuth: ctx.args.sentryAuth || 'token',
        hooksOff, hooksAnswered,
        log: ctx.log, note: ctx.note,
    });
}

function importMemory(ctx)
{
    const settingsFile = path.join(ctx.projectRoot, '.claude', 'settings.json');
    const gate = memory.importGate({
        projectRoot: ctx.projectRoot, settingsFile,
        mcps: ctx.lists.mcps, rules: ctx.lists.rules,
        tools: { node: true, uvx: ctx.rt.which('uvx') },
    });
    const importer = path.join(ctx.source.dir, 'scripts', 'memory-import.js');
    const acct = ctx.env.CLAUDE_CONFIG_DIR ? ['--config-dir', ctx.configDir] : [];
    memory.importNotes({
        gate, importer, settingsFile,
        runImport: () => ctx.rt.runNode(importer, ['--project-root', ctx.projectRoot, ...acct], { cwd: ctx.projectRoot, env: ctx.env }).ok,
        log: ctx.log,
    });
}

// COPY ROUTE ONLY: a registered server answers `mcp__<server>__<tool>`, never the plugin spelling
// the shipped files carry.
function downconvert(ctx)
{
    const bare = mcp.bareNamedMcps({ routes: ctx.routes, mcps: ctx.lists.mcps })
        .map((n) => n.replace(/^playwright-.*/, 'playwright'));
    if (!bare.length) return;
    if (ctx.routes.skills)
    {
        ctx.log(`  !! these servers are registered under their bare names but the skills and agents come from the plugins, which name the plugin spelling: ${bare.join(' ')} - set CLAUDE_STACK_SKILLS_VIA_PLUGIN=false too, or leave them on the plugin route`);
        return;
    }
    mcp.downconvertToolNames({
        roots: [ctx.skillsDir, path.join(ctx.claudeDir, 'agents'), path.join(ctx.claudeDir, 'rules'), path.join(ctx.claudeDir, 'hooks')],
        bare, log: ctx.log,
    });
}

function summarise(ctx, failures)
{
    const hookFiles = new Set(ctx.lists.hooks.map((e) => e.split('::')[0]));
    let line = `  installed/refreshed this run - skills=${ctx.lists.skills.length}, plugins=${ctx.lists.plugins.length}`
        + `, mcps=${ctx.lists.mcps.length}, hooks=${hookFiles.size}, agents=${ctx.lists.agents.length}, rules=${ctx.lists.rules.length}`
        + `; memory=${ctx.level.level} (${ctx.level.dbPath})`;
    if (ctx.args.space) line += `; space=${ctx.args.space}`;
    line += ctx.args.keepPins ? '; keep-pins=on' : '; keep-pins=off (agent model/effort pins reset to catalog defaults)';
    const engines = pwEngines(ctx);
    if (engines.length) line += `; playwright=${engines.join(',')}`;
    ctx.log(`${line}; context7=${ctx.args.context7}`);
    if (failures) ctx.log(`  ${failures} step(s) reported a failure above - the rest of the run completed`);
}

// --- small readers ---------------------------------------------------------

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }

function readStampHooks(file)
{
    try { return (/^shipped-hooks: (.*)$/m.exec(fs.readFileSync(file, 'utf8')) || [])[1].split(',').filter(Boolean); }
    catch { return []; }
}

function releaseVersion(sourceDir)
{
    try { return JSON.parse(fs.readFileSync(path.join(sourceDir, 'setup-plugin', '.claude-plugin', 'plugin.json'), 'utf8')).version || ''; }
    catch { return ''; }
}

const registeredMemoryPath = (mcpFile) =>
{
    const entry = readJson(mcpFile).mcpServers?.memory;
    const p = entry && entry.env && entry.env.MCP_MEMORY_SQLITE_PATH;
    return typeof p === 'string' && p ? p : '';
};

const registeredEngines = (mcpFile) => Object.keys(readJson(mcpFile).mcpServers || {})
    .map((n) => (/^playwright-(chrome|msedge|firefox|webkit)$/.exec(n) || [])[1])
    .filter(Boolean);

const pwEngines = (ctx) => ctx.lists.mcps.filter((e) => e.startsWith('playwright-')).map((e) => e.split('|')[0].slice(11));

const pinFiles = (ctx) => pinsLayer.pinFiles({
    projectRoot: ctx.projectRoot, skillsDir: ctx.skillsDir,
    agents: ctx.lists.agents, skills: ctx.lists.skills,
});

function runSelectionPlugins(ctx)
{
    const script = path.join(ctx.source.dir, 'scripts', 'selection-plugins.js');
    if (!fs.existsSync(script)) throw new Error('selection-plugins.js is not in this source');
    const lines = plugins.selectionLines({
        routes: ctx.routes, skills: ctx.lists.skills, agents: ctx.lists.agents,
        mcps: ctx.lists.mcps, context7Mode: ctx.args.context7,
    });
    const file = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'stack-sel-')), 'selection.txt');
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    const entries = ctx.rt.runNode(script, ['--selection', file], { cwd: ctx.projectRoot, env: ctx.env });
    if (!entries.ok) throw new Error(`plugin set not computed (${entries.stderr.split('\n')[0]})`);
    const copyList = ctx.rt.runNode(script, ['--selection', file, '--copy'], { cwd: ctx.projectRoot, env: ctx.env });
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    return { entries: ctx.rt.lines(entries.stdout), copy: ctx.rt.lines(copyList.stdout) };
}

const npmLatest = (rt) => (pkg) => rt.capture('npm', ['view', pkg, 'version'], { env: { ...process.env, npm_config_fetch_timeout: '15000' } }).trim();
const pypiLatest = (rt) => (pkg) =>
{
    const body = rt.capture('curl', ['-fsSL', '--max-time', '15', `https://pypi.org/pypi/${pkg}/json`]);
    try { return JSON.parse(body).info.version; } catch { return ''; }
};

const npxInstall = (ctx, engine) => ctx.rt.capture('npx', ['-y', '-p', `@playwright/mcp${ctx.pins.PW_PIN}`, 'playwright', 'install', engine], { cwd: ctx.projectRoot, env: ctx.env }) !== '';

if (require.main === module)
{
    process.exitCode = main(process.argv.slice(2), process.env, {
        out: (s) => process.stdout.write(s),
        err: (s) => process.stderr.write(s),
    });
}

module.exports = { main, USAGE, HOOKS_PLUGIN, CORE_DEP_PLUGINS, HOOK_ENGINES, SECRET_DENY, RETIRED_DENY };
