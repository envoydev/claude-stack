#!/usr/bin/env node
// total-time.js - normalize the time token on each drafted task line and total the day.
// Dependencies: none - Node.js built-ins only (no install, no network).
// Usage: node scripts/total-time.js < lines.txt      (one task line per input line)
//        printf '%s\n' 'ABC-1 fixed x - 1h 30m' | node scripts/total-time.js
// Output: one row per line with its normalized time, then the day total in `Xh Ym`.
// A line carrying no time token is reported as `(time not specified)` and counts as zero.

const UNIT = /(\d+(?:[.,]\d+)?)\s*(год|гг|хвил|хв|г|h|m)(?![\p{L}\d])/giu;

function minutesOf(line) {
  let total = 0, found = false;
  for (const m of line.matchAll(UNIT)) {
    const value = parseFloat(m[1].replace(',', '.'));
    const unit = m[2].toLowerCase();
    const isHour = unit === 'h' || unit === 'г' || unit === 'год' || unit === 'гг';
    total += isHour ? value * 60 : value;
    found = true;
  }
  return found ? Math.round(total) : null;
}

function format(mins) {
  if (mins === null) return '(time not specified)';
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    console.error('total-time: no input. Pipe the drafted task lines in, one per line.');
    process.exit(1);
  }
  let sum = 0, timed = 0, untimed = 0;
  lines.forEach((line, i) => {
    const mins = minutesOf(line);
    if (mins === null) untimed += 1; else { sum += mins; timed += 1; }
    console.log(`${String(i + 1).padStart(2)}. ${format(mins).padEnd(20)} ${line}`);
  });
  console.log(`Total time: ${format(sum)}  (${sum}m over ${timed} timed line(s), ${untimed} without time)`);
});
