#!/usr/bin/env node
// Claude Code status line: user | branch | model | $cost | ctx% | 5H | 7D
// Pure Node (no jq dependency — jq is not installed on this Windows machine).

const os = require('os');
const { execSync } = require('child_process');

// ---- read stdin JSON ----
let raw = '';
try {
  raw = require('fs').readFileSync(0, 'utf8');
} catch {
  raw = '';
}
let data = {};
try {
  data = JSON.parse(raw || '{}');
} catch {
  data = {};
}

const get = (obj, path) =>
  path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);

// ---- ANSI colors ----
const C = {
  cyan: '\x1b[0;36m',
  yellow: '\x1b[0;33m',
  magenta: '\x1b[0;35m',
  green: '\x1b[0;32m',
  red: '\x1b[0;31m',
  blue: '\x1b[0;34m',
  reset: '\x1b[0m',
};
const paint = (color, text) => `${color}${text}${C.reset}`;

// ---- user ----
let user = '';
try {
  user = os.userInfo().username;
} catch {
  user = process.env.USER || process.env.USERNAME || '';
}

// ---- branch ----
const cwd = get(data, 'workspace.current_dir') || get(data, 'cwd') || process.cwd();
let branch = '';
try {
  branch = execSync('git rev-parse --abbrev-ref HEAD', {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim();
} catch {
  branch = '';
}

// ---- model ----
const model = get(data, 'model.display_name') || '';

// ---- cost (prefer actual billing cost; fall back to token-based estimate) ----
let cost = get(data, 'cost.total_cost_usd');
if (typeof cost !== 'number') {
  const tin = Number(get(data, 'context_window.total_input_tokens')) || 0;
  const tout = Number(get(data, 'context_window.total_output_tokens')) || 0;
  cost = (tin / 1e6) * 3.0 + (tout / 1e6) * 15.0; // Sonnet-class estimate fallback
}

// ---- context window % used (model-aware, provided by Claude Code) ----
const ctxPct = get(data, 'context_window.used_percentage');

// ---- rate limits ----
const fivePct = get(data, 'rate_limits.five_hour.used_percentage');
const weekPct = get(data, 'rate_limits.seven_day.used_percentage');

// ---- assemble ----
const parts = [];
if (user) parts.push(paint(C.cyan, user));
if (branch) parts.push(paint(C.yellow, branch));
if (model) parts.push(paint(C.magenta, model));
parts.push(paint(C.green, `$${cost.toFixed(4)}`));
if (typeof ctxPct === 'number') parts.push(paint(C.blue, `ctx:${ctxPct.toFixed(0)}%`));
if (typeof fivePct === 'number') parts.push(paint(C.red, `5H:${fivePct.toFixed(0)}%`));
if (typeof weekPct === 'number') parts.push(paint(C.red, `7D:${weekPct.toFixed(0)}%`));

process.stdout.write(parts.join(' | ') + '\n');
