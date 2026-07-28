#!/usr/bin/env node
'use strict';

// analyze-usage.js - offline token/tool consumption report for a Claude Code session.
//
// Why: hooks see WHO fired (instrument-tool-usage.js) but can never see tokens - token
// accounting lives per API message in the transcript JSONL Claude Code already writes.
// This script mines that transcript (plus the session's subagents/ directory) and emits
// the consumption report an agent-flow tuning pass needs: tokens by scope and model,
// exact per-dispatch subagent cost, skill/MCP/tool call+result volume, context-growth
// spikes, and an optional join against an instrument-tool-usage.js hook log.
//
// Usage:
//   node scripts/analyze-usage.js <session.jsonl>                  # full report for one session
//   node scripts/analyze-usage.js <projects-dir>                   # one-line rollup per session
//   node scripts/analyze-usage.js <session.jsonl> --hook-log <f>   # join a <docs-path>/tools-usage/<sid>.jsonl ledger
//   node scripts/analyze-usage.js <session.jsonl> --json           # machine-readable dump
//   node scripts/analyze-usage.js <s.jsonl> --from <ISO> --to <ISO> # window one run inside a long session
//   node scripts/analyze-usage.js <s.jsonl> --docs-root <path>     # extra docs prefix when CLAUDE_DOCS_PATH is non-default
//
// The headline health signal is ctx/msg (avg context re-sent per API call = input +
// cache-write + cache-read over msgs): high tool-result volume means noisy tools, but a
// high ctx/msg means carried-forward conversation - the cost driver windowing isolates.
//
// Transcripts live under ~/.claude/projects/<encoded-project-path>/: the main session is
// <session-id>.jsonl, its dispatched subagents under <session-id>/subagents/agent-*.jsonl
// (+ .meta.json with agentType/description/toolUseId). Facts this parser relies on,
// verified against real transcripts: one API response is split across several assistant
// lines that each repeat the same message.id with usage that is IDENTICAL (main session)
// or a PROGRESSIVE streaming snapshot (subagent files: output_tokens grows 4 -> 9579
// across lines) - so usage is folded as an elementwise max per message.id, never summed
// per line and never first-wins; tool_use ids are globally unique; assistant lines carry
// attributionSkill/attributionPlugin while a skill is active; result sizes are measured
// in chars and reported as ~tokens (chars/4) - approximate, oversized results may be
// offloaded to tool-results/ and undercount.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ---------- small helpers ----------

const fmt = (n) => {
  if (n == null) return '-';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
};
const approxTok = (chars) => Math.round(chars / 4);
const dur = (ms) => {
  if (!ms || ms < 0) return '-';
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
const pad = (s, w) => String(s).length >= w ? String(s) : String(s) + ' '.repeat(w - String(s).length);
const rpad = (s, w) => String(s).length >= w ? String(s) : ' '.repeat(w - String(s).length) + String(s);

function newTally() { return { input: 0, cacheCreate: 0, cacheRead: 0, output: 0, msgs: 0 }; }
const ctxOf = (t) => (t.msgs ? Math.round((t.input + t.cacheCreate + t.cacheRead) / t.msgs) : 0);
function addUsage(t, u) {
  t.input += u.input_tokens || 0;
  t.cacheCreate += u.cache_creation_input_tokens || 0;
  t.cacheRead += u.cache_read_input_tokens || 0;
  t.output += u.output_tokens || 0;
  t.msgs += 1;
}
function mergeTally(a, b) {
  a.input += b.input; a.cacheCreate += b.cacheCreate; a.cacheRead += b.cacheRead;
  a.output += b.output; a.msgs += b.msgs;
}

function readJsonl(file, onObj) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: fs.createReadStream(file) });
    rl.on('line', (l) => { try { onObj(JSON.parse(l), l); } catch { /* skip broken line */ } });
    rl.on('close', resolve);
    rl.on('error', reject);
  });
}

// ---------- generated-docs consumption ----------
// The capture skills' whole value claim is that seats READ these docs instead of
// re-deriving the project - so consumption is a first-class signal, not a grep afterthought.
// Style delivery is counted via stable marker phrases: the generated project-code-style
// rule's heading (current mechanism - see the skill's code-style-rule template) and the
// retired inject-code-style hook's injected preamble (legacy sessions).

const STYLE_RULE_MARKER = 'the project-code-style-analyzer skill owns this rule';
const STYLE_INJECT_MARKER = 'maintained by the project-code-style-analyzer';
const docsPrefixes = ['/.claude/docs/'];

function docRelPath(filePath) {
  for (const p of docsPrefixes) {
    const i = filePath.indexOf(p);
    if (i >= 0) return filePath.slice(i + p.length);
  }
  return null;
}

// ---------- transcript analysis (main session or one subagent) ----------

async function analyzeTranscript(file, window) {
  const s = {
    file,
    total: newTally(),
    byModel: {},                 // model -> tally
    toolCalls: {},               // tool name -> { calls, resultChars, errors }
    skillInvocations: {},        // skill slug -> { calls, injectedChars }
    skillAttribution: {},        // skill slug -> { msgs, output }
    mcp: {},                     // server -> { calls, resultChars, errors, tools: {tool: n} }
    agentDispatches: [],         // Agent/Task tool_use in THIS transcript: {id, desc, subagentType}
    docTouches: {},              // <docs-root>-relative path -> { reads, writes }
    styleRuleAttaches: 0,        // generated project-code-style rule attachments seen in this transcript
    styleInjections: 0,          // legacy inject-code-style hook firings seen in this transcript
    userPrompts: 0,
    compactions: 0,
    apiErrors: 0,
    firstTs: null,
    lastTs: null,
    spikes: [],                  // top context jumps: {ts, delta, ctx, causes}
  };
  const msgReg = new Map();       // message.id -> {model, skill, u:{in,cc,cr,out}} folded max per field
  const seenToolUse = new Set();  // tool_use id dedup across duplicated assistant lines
  const toolById = new Map();     // tool_use id -> { name, skill }
  let prevCtx = null;
  let pending = [];               // tool results since the previous counted assistant msg

  await readJsonl(file, (o, raw) => {
    if (window && o.timestamp) {
      const ts = Date.parse(o.timestamp);
      if ((window.from != null && ts < window.from) || (window.to != null && ts > window.to)) return;
    }
    if (raw.includes(STYLE_RULE_MARKER)) s.styleRuleAttaches++;
    if (raw.includes(STYLE_INJECT_MARKER)) s.styleInjections++;
    if (o.timestamp) { if (!s.firstTs) s.firstTs = o.timestamp; s.lastTs = o.timestamp; }
    if (o.isCompactSummary || o.compactMetadata) s.compactions++;
    if (o.isApiErrorMessage) s.apiErrors++;

    if (o.type === 'assistant' && o.message) {
      const m = o.message;
      // usage: fold as max per field per message.id (duplicate lines repeat identical
      // usage in main sessions but progressive streaming snapshots in subagent files)
      if (m.usage && m.id && m.model !== '<synthetic>') {
        let r = msgReg.get(m.id);
        if (!r) {
          r = { model: m.model, skill: o.attributionSkill || null, u: { in: 0, cc: 0, cr: 0, out: 0 } };
          msgReg.set(m.id, r);
          // context size is fixed at message start, so first sighting is exact for spikes
          const ctx = (m.usage.input_tokens || 0) + (m.usage.cache_read_input_tokens || 0) + (m.usage.cache_creation_input_tokens || 0);
          if (prevCtx != null && ctx - prevCtx > 0) {
            s.spikes.push({ ts: o.timestamp, delta: ctx - prevCtx, ctx, causes: summarizeCauses(pending) });
            s.spikes.sort((a, b) => b.delta - a.delta);
            if (s.spikes.length > 5) s.spikes.pop();
          }
          prevCtx = ctx; pending = [];
        }
        r.u.in = Math.max(r.u.in, m.usage.input_tokens || 0);
        r.u.cc = Math.max(r.u.cc, m.usage.cache_creation_input_tokens || 0);
        r.u.cr = Math.max(r.u.cr, m.usage.cache_read_input_tokens || 0);
        r.u.out = Math.max(r.u.out, m.usage.output_tokens || 0);
        if (o.attributionSkill && !r.skill) r.skill = o.attributionSkill;
      }
      if (Array.isArray(m.content)) for (const c of m.content) {
        if (c.type !== 'tool_use' || seenToolUse.has(c.id)) continue;
        seenToolUse.add(c.id);
        const t = s.toolCalls[c.name] || (s.toolCalls[c.name] = { calls: 0, resultChars: 0, errors: 0 });
        t.calls += 1;
        if (c.input && typeof c.input.file_path === 'string') {
          const rel = docRelPath(c.input.file_path);
          if (rel) {
            const d = s.docTouches[rel] || (s.docTouches[rel] = { reads: 0, writes: 0 });
            if (c.name === 'Read') d.reads += 1;
            else if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(c.name)) d.writes += 1;
          }
        }
        const info = { name: c.name };
        if (c.name === 'Skill' && c.input && c.input.skill) {
          info.skill = c.input.skill;
          const sk = s.skillInvocations[c.input.skill] || (s.skillInvocations[c.input.skill] = { calls: 0, injectedChars: 0 });
          sk.calls += 1;
        } else if (c.name.startsWith('mcp__')) {
          const server = c.name.split('__')[1] || '?';
          const mc = s.mcp[server] || (s.mcp[server] = { calls: 0, resultChars: 0, errors: 0, tools: {} });
          mc.calls += 1;
          const tool = c.name.split('__').slice(2).join('__') || '?';
          mc.tools[tool] = (mc.tools[tool] || 0) + 1;
        } else if ((c.name === 'Agent' || c.name === 'Task') && c.input) {
          s.agentDispatches.push({ id: c.id, desc: c.input.description || null, subagentType: c.input.subagent_type || null });
        }
        toolById.set(c.id, info);
      }
    }

    if (o.type === 'user' && o.message) {
      const content = o.message.content;
      if (typeof content === 'string') { if (!o.isMeta) s.userPrompts++; return; }
      if (!Array.isArray(content)) return;
      let hasResult = false;
      for (const c of content) {
        if (c.type !== 'tool_result') continue;
        hasResult = true;
        const chars = typeof c.content === 'string' ? c.content.length : JSON.stringify(c.content || '').length;
        const info = toolById.get(c.tool_use_id);
        pending.push({ name: info ? info.name : '?', chars });
        if (!info) continue;
        const t = s.toolCalls[info.name];
        if (t) { t.resultChars += chars; if (c.is_error) t.errors += 1; }
        if (info.skill) s.skillInvocations[info.skill].injectedChars += chars;
        if (info.name.startsWith('mcp__')) {
          const mc = s.mcp[info.name.split('__')[1] || '?'];
          if (mc) { mc.resultChars += chars; if (c.is_error) mc.errors += 1; }
        }
      }
      if (!hasResult && !o.isMeta && content.some((c) => c.type === 'text')) s.userPrompts++;
    }
  });

  // finalize the folded per-message usage into the tallies
  for (const r of msgReg.values()) {
    const u = { input_tokens: r.u.in, cache_creation_input_tokens: r.u.cc, cache_read_input_tokens: r.u.cr, output_tokens: r.u.out };
    addUsage(s.total, u);
    addUsage(s.byModel[r.model] || (s.byModel[r.model] = newTally()), u);
    if (r.skill) {
      const a = s.skillAttribution[r.skill] || (s.skillAttribution[r.skill] = { msgs: 0, output: 0, cacheRead: 0 });
      a.msgs += 1; a.output += r.u.out; a.cacheRead += r.u.cr;
    }
  }
  return s;
}

function summarizeCauses(pending) {
  const by = {};
  for (const p of pending) {
    const e = by[p.name] || (by[p.name] = { n: 0, chars: 0 });
    e.n += 1; e.chars += p.chars;
  }
  return Object.entries(by).sort((a, b) => b[1].chars - a[1].chars).slice(0, 3)
    .map(([name, e]) => `${name}×${e.n} (~${fmt(approxTok(e.chars))} tok)`).join(', ');
}

// ---------- subagents (the session's <id>/subagents/ directory) ----------

async function analyzeSubagents(sessionFile, window) {
  const dir = path.join(sessionFile.replace(/\.jsonl$/, ''), 'subagents');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, f.replace(/\.jsonl$/, '.meta.json')), 'utf8')); } catch { /* meta optional */ }
    const t = await analyzeTranscript(path.join(dir, f), window);
    if (window && t.total.msgs === 0) continue; // dispatched entirely outside the window
    out.push({ id: f.replace(/^agent-|\.jsonl$/g, ''), meta, stats: t });
  }
  return out;
}

// ---------- hook-log join ----------

async function analyzeHookLog(file) {
  const byTool = {}; let rows = 0;
  await readJsonl(file, (o) => {
    if (!o.tool) return;
    rows++;
    const t = byTool[o.tool] || (byTool[o.tool] = { calls: 0, details: {} });
    t.calls += 1;
    if (o.detail) t.details[o.detail] = (t.details[o.detail] || 0) + 1;
  });
  return { rows, byTool };
}

// ---------- report ----------

function tallyRow(label, t) {
  return `  ${pad(label, 22)} ${rpad(fmt(t.input), 8)} ${rpad(fmt(t.cacheCreate), 11)} ${rpad(fmt(t.cacheRead), 11)} ${rpad(fmt(t.output), 8)} ${rpad(t.msgs, 6)} ${rpad(fmt(ctxOf(t)), 8)}`;
}

const CTX_WARN = 120000; // avg ctx/msg above this = the conversation, not the tools, is the cost

function printReport(main, agents, hookLog, window) {
  const span = main.firstTs && main.lastTs ? new Date(main.lastTs) - new Date(main.firstTs) : null;
  console.log(`Session ${path.basename(main.file, '.jsonl')}  ${main.firstTs || '?'} → ${main.lastTs || '?'} (${dur(span)})`);
  if (window) console.log(`windowed: ${window.fromStr || 'start'} → ${window.toStr || 'end'} (subagents dispatched outside the window are excluded)`);
  console.log(`user prompts ${main.userPrompts} · API messages ${main.total.msgs} · compactions ${main.compactions} · API errors ${main.apiErrors}`);

  console.log('\nTOKENS (deduped per API message; ctx/msg = avg context re-sent per call)');
  console.log(`  ${pad('scope / model', 22)} ${rpad('input', 8)} ${rpad('cache-write', 11)} ${rpad('cache-read', 11)} ${rpad('output', 8)} ${rpad('msgs', 6)} ${rpad('ctx/msg', 8)}`);
  console.log(tallyRow('main session', main.total));
  for (const [m, t] of Object.entries(main.byModel)) console.log(tallyRow('  ' + m, t));
  if (ctxOf(main.total) > CTX_WARN) {
    console.log(`  ! avg context/msg ${fmt(ctxOf(main.total))} - the cost driver is carried-forward conversation, not tool output:`);
    console.log(`    run pipeline steps in fresh sessions that resume from the plan file instead of one long chat.`);
  }
  const agentTotal = newTally();
  const byType = {};
  for (const a of agents) {
    mergeTally(agentTotal, a.stats.total);
    const type = a.meta.agentType || '(unknown)';
    const g = byType[type] || (byType[type] = { n: 0, tally: newTally(), tools: {}, descs: [], wall: 0 });
    g.n += 1; mergeTally(g.tally, a.stats.total);
    for (const [name, t] of Object.entries(a.stats.toolCalls)) g.tools[name] = (g.tools[name] || 0) + t.calls;
    if (a.meta.description && g.descs.length < 2) g.descs.push(a.meta.description);
    if (a.stats.firstTs && a.stats.lastTs) g.wall += new Date(a.stats.lastTs) - new Date(a.stats.firstTs);
  }
  if (agents.length) {
    console.log(tallyRow(`subagents (${agents.length})`, agentTotal));
    const grand = newTally(); mergeTally(grand, main.total); mergeTally(grand, agentTotal);
    console.log(tallyRow('TOTAL', grand));
  }

  if (agents.length) {
    console.log('\nSUBAGENTS (exact per-dispatch cost, grouped by agent type)');
    console.log(`  ${pad('agent type', 28)} ${rpad('n', 3)} ${rpad('output', 8)} ${rpad('cache-read', 11)} ${rpad('msgs', 5)} ${rpad('wall', 7)}  top tools`);
    for (const [type, g] of Object.entries(byType).sort((a, b) => b[1].tally.output - a[1].tally.output)) {
      const top = Object.entries(g.tools).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => `${n}×${c}`).join(' ');
      console.log(`  ${pad(type, 28)} ${rpad(g.n, 3)} ${rpad(fmt(g.tally.output), 8)} ${rpad(fmt(g.tally.cacheRead), 11)} ${rpad(g.tally.msgs, 5)} ${rpad(dur(g.wall), 7)}  ${top}`);
      if (g.descs.length) console.log(`  ${pad('', 28)} e.g. ${g.descs.map((d) => JSON.stringify(d.slice(0, 40))).join(', ')}`);
    }
  }

  const skills = new Set([...Object.keys(main.skillInvocations), ...Object.keys(main.skillAttribution)]);
  for (const a of agents) for (const k of [...Object.keys(a.stats.skillInvocations), ...Object.keys(a.stats.skillAttribution)]) skills.add(k);
  if (skills.size) {
    console.log('\nSKILLS (calls = Skill tool invocations; attributed = API msgs stamped while the skill was active - the real cost signal)');
    console.log(`  ${pad('skill', 44)} ${rpad('calls', 5)} ${rpad('result', 9)} ${rpad('attr msgs', 9)} ${rpad('attr out', 9)} ${rpad('attr cache-rd', 13)}`);
    for (const k of [...skills].sort()) {
      const inv = { calls: 0, injectedChars: 0 }, attr = { msgs: 0, output: 0, cacheRead: 0 };
      for (const src of [main, ...agents.map((a) => a.stats)]) {
        if (src.skillInvocations[k]) { inv.calls += src.skillInvocations[k].calls; inv.injectedChars += src.skillInvocations[k].injectedChars; }
        if (src.skillAttribution[k]) { attr.msgs += src.skillAttribution[k].msgs; attr.output += src.skillAttribution[k].output; attr.cacheRead += src.skillAttribution[k].cacheRead || 0; }
      }
      console.log(`  ${pad(k, 44)} ${rpad(inv.calls, 5)} ${rpad('~' + fmt(approxTok(inv.injectedChars)), 9)} ${rpad(attr.msgs, 9)} ${rpad(fmt(attr.output), 9)} ${rpad(fmt(attr.cacheRead), 13)}`);
    }
  }

  const docRows = {};
  let inject = main.styleInjections;
  let attach = main.styleRuleAttaches;
  for (const [rel, d] of Object.entries(main.docTouches)) {
    const r = docRows[rel] || (docRows[rel] = { main: 0, agents: 0, writes: 0 });
    r.main += d.reads; r.writes += d.writes;
  }
  for (const a of agents) {
    inject += a.stats.styleInjections;
    attach += a.stats.styleRuleAttaches;
    for (const [rel, d] of Object.entries(a.stats.docTouches)) {
      const r = docRows[rel] || (docRows[rel] = { main: 0, agents: 0, writes: 0 });
      r.agents += d.reads; r.writes += d.writes;
    }
  }
  if (Object.keys(docRows).length || inject || attach) {
    console.log('\nGENERATED DOCS (capture-doc consumption; reads = orientation happening, writes = capture/loop maintenance)');
    console.log(`  ${pad('doc', 44)} ${rpad('main-reads', 10)} ${rpad('agent-reads', 11)} ${rpad('writes', 6)}`);
    for (const [rel, r] of Object.entries(docRows).sort((a, b) => (b[1].main + b[1].agents) - (a[1].main + a[1].agents))) {
      console.log(`  ${pad(rel, 44)} ${rpad(r.main, 10)} ${rpad(r.agents, 11)} ${rpad(r.writes, 6)}`);
    }
    if (attach) console.log(`  ${pad('(style rule attached on file touch)', 44)} ${rpad('-', 10)} ${rpad('-', 11)} ${rpad('-', 6)}  ×${attach}`);
    if (inject) console.log(`  ${pad('(style injected by legacy hook)', 44)} ${rpad('-', 10)} ${rpad('-', 11)} ${rpad('-', 6)}  ×${inject}`);
  }

  const mcpServers = {};
  for (const src of [main, ...agents.map((a) => a.stats)]) {
    for (const [server, m] of Object.entries(src.mcp)) {
      const e = mcpServers[server] || (mcpServers[server] = { calls: 0, resultChars: 0, errors: 0, tools: {} });
      e.calls += m.calls; e.resultChars += m.resultChars; e.errors += m.errors;
      for (const [t, n] of Object.entries(m.tools)) e.tools[t] = (e.tools[t] || 0) + n;
    }
  }
  if (Object.keys(mcpServers).length) {
    console.log('\nMCP (main + subagents; results measured in chars, shown as ~tokens)');
    console.log(`  ${pad('server', 18)} ${rpad('calls', 5)} ${rpad('results', 9)} ${rpad('errors', 6)}  top tools`);
    for (const [server, m] of Object.entries(mcpServers).sort((a, b) => b[1].calls - a[1].calls)) {
      const top = Object.entries(m.tools).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => `${n}×${c}`).join(' ');
      console.log(`  ${pad(server, 18)} ${rpad(m.calls, 5)} ${rpad('~' + fmt(approxTok(m.resultChars)), 9)} ${rpad(m.errors, 6)}  ${top}`);
    }
  }

  const tools = {};
  for (const src of [main, ...agents.map((a) => a.stats)]) {
    for (const [name, t] of Object.entries(src.toolCalls)) {
      const e = tools[name] || (tools[name] = { calls: 0, resultChars: 0, errors: 0 });
      e.calls += t.calls; e.resultChars += t.resultChars; e.errors += t.errors;
    }
  }
  console.log('\nTOOLS (main + subagents; result volume = what lands back in context)');
  console.log(`  ${pad('tool', 28)} ${rpad('calls', 5)} ${rpad('results', 9)} ${rpad('errors', 6)}`);
  for (const [name, t] of Object.entries(tools).sort((a, b) => b[1].resultChars - a[1].resultChars).slice(0, 15)) {
    console.log(`  ${pad(name, 28)} ${rpad(t.calls, 5)} ${rpad('~' + fmt(approxTok(t.resultChars)), 9)} ${rpad(t.errors, 6)}`);
  }

  if (main.spikes.length) {
    console.log('\nCONTEXT SPIKES (main session - biggest single-turn context jumps and what landed before them)');
    for (const sp of main.spikes) {
      console.log(`  +${rpad(fmt(sp.delta), 7)} → ${fmt(sp.ctx)} ctx  ${sp.ts || '?'}  after: ${sp.causes || '(prompt/attachment only)'}`);
    }
  }

  if (hookLog) {
    console.log(`\nHOOK LOG join (${hookLog.rows} rows - identity ledger only, tokens come from the transcript)`);
    for (const [tool, t] of Object.entries(hookLog.byTool).sort((a, b) => b[1].calls - a[1].calls).slice(0, 10)) {
      const top = Object.entries(t.details).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d, n]) => `${d}×${n}`).join(', ');
      console.log(`  ${pad(tool, 28)} ${rpad(t.calls, 5)}  ${top}`);
    }
    const trTools = Object.values(tools).reduce((n, t) => n + t.calls, 0);
    console.log(`  cross-check: transcript saw ${trTools} tool calls vs ${hookLog.rows} hook rows (gap = unwired scope or subagent non-propagation)`);
  }
}

// ---------- entry ----------

async function main() {
  const args = process.argv.slice(2);
  const flagVal = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const flagValIdx = new Set(['--hook-log', '--from', '--to', '--docs-root'].map((f) => args.indexOf(f) + 1).filter((i) => i > 0));
  const target = args.find((a, i) => !a.startsWith('--') && !flagValIdx.has(i));
  const asJson = args.includes('--json');
  const hookFile = flagVal('--hook-log');
  const docsRoot = flagVal('--docs-root');
  if (docsRoot) docsPrefixes.push(docsRoot.endsWith('/') ? docsRoot : docsRoot + '/');
  const fromStr = flagVal('--from'), toStr = flagVal('--to');
  const window = fromStr || toStr
    ? { from: fromStr ? Date.parse(fromStr) : null, to: toStr ? Date.parse(toStr) : null, fromStr, toStr }
    : null;
  if (!target || (window && (Number.isNaN(window.from) || Number.isNaN(window.to)))) {
    console.error('usage: analyze-usage.js <session.jsonl | sessions-dir> [--from <ISO ts>] [--to <ISO ts>] [--hook-log <tool-usage.jsonl>] [--json]');
    process.exit(1);
  }

  if (fs.statSync(target).isDirectory()) {
    // rollup mode: one line per session in the directory, newest first
    const files = fs.readdirSync(target).filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(target, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    console.log(`  ${pad('session', 38)} ${pad('start', 12)} ${rpad('output', 8)} ${rpad('cache-read', 11)} ${rpad('msgs', 6)} ${rpad('ctx/msg', 8)} ${rpad('agents', 6)} ${rpad('agent-out', 9)}`);
    const grand = newTally();
    for (const f of files) {
      const s = await analyzeTranscript(f, window);
      const agents = await analyzeSubagents(f, window);
      const at = newTally();
      for (const a of agents) mergeTally(at, a.stats.total);
      mergeTally(grand, s.total); mergeTally(grand, at);
      console.log(`  ${pad(path.basename(f, '.jsonl'), 38)} ${pad((s.firstTs || '?').slice(0, 10), 12)} ${rpad(fmt(s.total.output), 8)} ${rpad(fmt(s.total.cacheRead), 11)} ${rpad(s.total.msgs, 6)} ${rpad(fmt(ctxOf(s.total)), 8)} ${rpad(agents.length, 6)} ${rpad(fmt(at.output), 9)}`);
    }
    console.log(`  ${pad('TOTAL', 38)} ${pad('', 12)} ${rpad(fmt(grand.output), 8)} ${rpad(fmt(grand.cacheRead), 11)} ${rpad(grand.msgs, 6)}`);
    console.log('\nRun again with one session file for the full skills/MCP/tools/spikes report.');
    return;
  }

  const mainStats = await analyzeTranscript(target, window);
  const agents = await analyzeSubagents(target, window);
  const hookLog = hookFile ? await analyzeHookLog(hookFile) : null;
  if (asJson) {
    console.log(JSON.stringify(window ? { window: { from: fromStr, to: toStr }, main: mainStats, agents, hookLog } : { main: mainStats, agents, hookLog }, null, 2));
    return;
  }
  printReport(mainStats, agents, hookLog, window);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
