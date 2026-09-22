#!/usr/bin/env node
'use strict';
// The one filter setup/configure/validate all need over `claude plugin list --json`: collapse the
// CLI's machine-global listing to the plugins that apply to THIS project (project scope at this
// cwd, or user scope), one row per name. Read `claude plugin list --json` from stdin -
// `claude plugin list --json 2>/dev/null | node scripts/plugin-scan.js` - and print
// `name<TAB>version<TAB>scope<TAB>enabled`, the four fields the installers' own scan reads.
// Extracted from configure.md's one-liner so every caller runs the SAME filter instead of
// re-deriving it - measured: one hand-rolled re-derive re-sent ~110k tokens and misread 6 enabled
// project-scope plugins as disabled.
const fs = require('fs');

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  const here = real('.');
  let data;
  try { data = JSON.parse(input); } catch { return; }
  const rows = Array.isArray(data) ? data : (data.installed || []);
  const best = {};
  for (const e of rows) {
    const name = String(e.id || '').split('@')[0];
    if (!name) continue;
    const projectPath = e.projectPath ? real(String(e.projectPath)) : null;
    if (projectPath && projectPath !== here) continue;
    const rank = projectPath ? 0 : 1;
    if (!(name in best) || rank < best[name][0]) {
      best[name] = [rank, e.version || '?', e.scope || '', e.enabled === false ? 'no' : 'yes'];
    }
  }
  for (const name of Object.keys(best).sort()) console.log([name, ...best[name].slice(1)].join('\t'));
});
