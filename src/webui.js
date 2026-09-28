const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { loadIndex, upsertRepo, removeRepo, saveIndex } = require('./store');
const { search } = require('./search');
const { scanRepo } = require('./scanner');
const { buildFeatureCards } = require('./summarizer');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

// Minimal shell-style tokenizer: splits on whitespace, respects "..." and '...' quoting.
// No shell metacharacters (pipes, redirects, $()) are interpreted — args are passed
// straight to `node bin/cli.js` via spawn (no shell), so this never runs arbitrary shell code.
function tokenizeCommand(input) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

const PAGE_TEMPLATE = (dataJson) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Context Optimizer — Feature Index</title>
<style>
  :root {
    --bg: #0f1115; --panel: #171a21; --panel-2: #1c202a; --border: #262b36; --text: #e7e9ee;
    --muted: #8b93a3; --accent: #7c9eff; --accent-dim: #4c5f8f; --tag-bg: #1f2b45; --tag-text: #a9c1ff;
    --danger-bg: #2a1414; --danger-border: #5a2a2a; --danger-text: #ff9d9d;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg); color: var(--text);
  }
  ::selection { background: var(--accent-dim); }
  .toolbar { position: sticky; top: 0; z-index: 5; background: var(--bg); border-bottom: 1px solid var(--border); }
  header {
    padding: 18px 32px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  }
  h1 { font-size: 18px; margin: 0; font-weight: 600; display: flex; align-items: center; gap: 8px; white-space: nowrap; }
  .stats { color: var(--muted); font-size: 12.5px; white-space: nowrap; }
  #search {
    flex: 1; min-width: 240px; padding: 11px 14px; border-radius: 9px;
    border: 1px solid var(--border); background: var(--panel); color: var(--text); font-size: 14px;
    outline: none; transition: border-color .15s;
  }
  #search:focus { border-color: var(--accent); }
  main { padding: 20px 32px 60px; max-width: 1100px; margin: 0 auto; }
  .section-label {
    font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted);
    margin: 0 0 10px 2px; font-weight: 600;
  }
  .card {
    background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
    padding: 16px 18px; margin-bottom: 12px; transition: border-color .15s;
  }
  .card:hover { border-color: #37404f; }
  .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .feature-title { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .feature-icon { font-size: 17px; flex-shrink: 0; }
  .feature-name { font-size: 15px; font-weight: 600; color: var(--accent); overflow-wrap: anywhere; }
  .repo-pill {
    color: var(--muted); font-size: 11px; white-space: nowrap; background: var(--panel-2);
    border: 1px solid var(--border); padding: 3px 9px; border-radius: 999px; flex-shrink: 0;
  }
  .desc { margin: 10px 0; font-size: 13.5px; line-height: 1.55; color: #cfd3dc; }
  .desc mark { background: #3d3410; color: #ffdf8a; border-radius: 3px; padding: 0 2px; }
  .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .tag { background: var(--tag-bg); color: var(--tag-text); font-size: 11px; padding: 3px 9px; border-radius: 999px; }
  .files {
    margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border);
    font-size: 11.5px; color: var(--muted); font-family: 'SF Mono', Menlo, monospace; line-height: 1.6;
  }
  .empty {
    color: var(--muted); padding: 64px 20px; text-align: center; font-size: 14px;
  }
  .empty .big { font-size: 32px; display: block; margin-bottom: 10px; }
  .toolbar-row {
    padding: 12px 32px; border-top: 1px solid var(--border);
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  }
  .toolbar-row input[type="text"] {
    padding: 9px 12px; border-radius: 9px; border: 1px solid var(--border);
    background: var(--panel); color: var(--text); font-size: 13px; outline: none;
  }
  .toolbar-row input[type="text"]:focus { border-color: var(--accent); }
  #scanPath { flex: 1; min-width: 220px; }
  #scanName { width: 180px; }
  .toolbar-row label { color: var(--muted); font-size: 12.5px; display: flex; align-items: center; gap: 5px; cursor: pointer; }
  .btn-primary {
    padding: 9px 16px; border-radius: 9px; border: none; background: var(--accent);
    color: #0f1115; font-weight: 600; font-size: 13px; cursor: pointer; white-space: nowrap;
  }
  .btn-primary:hover { filter: brightness(1.08); }
  .btn-primary:disabled { opacity: 0.55; cursor: default; filter: none; }
  #scanStatus { font-size: 12.5px; color: var(--muted); }
  .repo-bar { flex-wrap: wrap; }
  .repo-chip {
    display: inline-flex; align-items: center; gap: 0; background: var(--panel);
    border: 1px solid var(--border); border-radius: 999px; font-size: 12.5px; overflow: hidden;
  }
  .repo-chip.active { border-color: var(--accent); }
  .repo-chip .name-btn {
    background: none; border: none; color: var(--text); cursor: pointer; font-size: 12.5px;
    padding: 7px 4px 7px 14px; white-space: nowrap; display: flex; align-items: center; gap: 6px;
  }
  .repo-chip.active .name-btn { color: var(--accent); }
  .repo-chip .count { color: var(--muted); font-size: 11px; }
  .repo-chip .remove-btn {
    border: none; background: transparent; color: var(--muted); cursor: pointer;
    font-size: 14px; line-height: 1; padding: 7px 12px 7px 6px;
  }
  .repo-chip .remove-btn:hover { color: var(--danger-text); }
  .wipe-btn {
    margin-left: auto; padding: 7px 14px; border-radius: 9px; border: 1px solid var(--danger-border);
    background: var(--danger-bg); color: var(--danger-text); font-size: 12.5px; cursor: pointer; white-space: nowrap;
  }
  .wipe-btn:hover { filter: brightness(1.15); }
  .term-wrap {
    max-width: 1100px; margin: 0 auto 28px; padding: 0 32px;
  }
  .term-header {
    display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
  }
  .term-header h2 { font-size: 12px; margin: 0; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
  .term-hint { font-size: 11.5px; color: var(--muted); }
  .term-input-row { display: flex; gap: 8px; margin-bottom: 8px; }
  .term-input-row input {
    flex: 1; background: #05060a; border: 1px solid var(--border); color: #b7f5c0;
    font-family: 'SF Mono', Menlo, monospace; font-size: 13px; padding: 10px 12px; border-radius: 8px; outline: none;
  }
  .term-input-row input:focus { border-color: var(--accent); }
  .term-input-row input::placeholder { color: #4a5568; }
  .term-output {
    background: #05060a; border: 1px solid var(--border); border-radius: 10px;
    padding: 14px 16px; font-family: 'SF Mono', Menlo, monospace; font-size: 12.5px; line-height: 1.6;
    color: #c8ccd6; white-space: pre-wrap; word-break: break-word; max-height: 340px; overflow-y: auto;
  }
  .term-output:empty::before { content: 'Output will appear here.'; color: #4a5568; }
</style>
</head>
<body>
<div class="toolbar">
  <header>
    <h1>🔍 Context Optimizer</h1>
    <input id="search" type="text" placeholder="Search existing features (e.g. authentication, payment, file upload)..." />
    <div class="stats" id="stats"></div>
  </header>
  <div class="toolbar-row">
    <input id="scanPath" type="text" placeholder="Path to repo to scan (e.g. /home/you/projects/my-app)" />
    <input id="scanName" type="text" placeholder="Repo name (optional)" />
    <label><input id="scanLlm" type="checkbox" /> use LLM</label>
    <button class="btn-primary" id="scanBtn" onclick="runScan()">Scan repo</button>
    <span id="scanStatus"></span>
  </div>
  <div class="toolbar-row repo-bar" id="repoBar"></div>
</div>
<div class="term-wrap">
  <div class="term-header">
    <h2>Terminal</h2>
    <span class="term-hint">Runs "context-optimizer &lt;command&gt;" here, e.g. list, query "login", remove my-repo</span>
  </div>
  <div class="term-input-row">
    <input id="termCmd" type="text" placeholder="list  |  query &quot;user login&quot;  |  scan /path --llm  |  remove my-repo" />
    <button class="btn-primary" id="termBtn" onclick="runTerminalCommand()">Run</button>
  </div>
  <pre class="term-output" id="termOutput"></pre>
</div>
<main id="results"></main>
<script>
const DATA = ${dataJson};

function tokenize(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9\\s\\-_/]/g, ' ').split(/[\\s\\-_/]+/).filter(t => t.length > 1);
}
function scoreCard(card, qTokens) {
  const name = tokenize(card.featureName), tags = tokenize((card.tags||[]).join(' '));
  const desc = tokenize(card.description), sig = tokenize((card.signatures||[]).join(' '));
  const files = tokenize((card.files||[]).join(' '));
  let score = 0;
  for (const qt of qTokens) {
    if (name.includes(qt)) score += 5;
    if (tags.includes(qt)) score += 4;
    if (sig.includes(qt)) score += 2;
    if (files.includes(qt)) score += 2;
    if (desc.includes(qt)) score += 1;
    if (name.some(t => t.includes(qt) || qt.includes(t))) score += 2;
    if (tags.some(t => t.includes(qt) || qt.includes(t))) score += 2;
    if (files.some(t => t.includes(qt) || qt.includes(t))) score += 1;
  }
  return score;
}

const TAG_ICONS = {
  authentication: '🔐', payments: '💳', notifications: '🔔', database: '🗄️',
  api: '🔌', 'ui-component': '🎨', 'file-upload': '📁', search: '🔎',
  testing: '🧪', admin: '🛠️', 'user-management': '👤', analytics: '📊',
  caching: '⚡', scheduling: '⏰', realtime: '📡', general: '📦'
};
function iconFor(tags) {
  for (const t of (tags || [])) if (TAG_ICONS[t]) return TAG_ICONS[t];
  return '📄';
}
function escapeHtml(s) {
  return (s || '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}
function highlight(text, qTokens) {
  let safe = escapeHtml(text);
  if (!qTokens || !qTokens.length) return safe;
  const pattern = qTokens.filter(Boolean).sort((a,b)=>b.length-a.length).map(t => t.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')).join('|');
  if (!pattern) return safe;
  return safe.replace(new RegExp('(' + pattern + ')', 'ig'), '<mark>$1</mark>');
}

function render(cards, qTokens) {
  const el = document.getElementById('results');
  if (!cards.length) {
    el.innerHTML = '<div class="empty"><span class="big">🗂️</span>No matching features found.<br>Try a different term, clear the repo filter, or run a scan first.</div>';
    return;
  }
  el.innerHTML = cards.map(c => \`
    <div class="card">
      <div class="card-top">
        <div class="feature-title">
          <span class="feature-icon">\${iconFor(c.tags)}</span>
          <span class="feature-name">\${highlight(c.featureName, qTokens)}</span>
        </div>
        <span class="repo-pill">\${escapeHtml(c.repoName)}</span>
      </div>
      <div class="desc">\${highlight(c.description, qTokens)}</div>
      <div class="tags">\${(c.tags||[]).map(t => \`<span class="tag">#\${escapeHtml(t)}</span>\`).join('')}</div>
      <div class="files">\${(c.files||[]).slice(0,6).map(escapeHtml).join(' · ')}</div>
    </div>
  \`).join('');
}

let activeRepo = null; // null = all repos (mirrors CLI "list" with no --repo)

function scopedCards() {
  return activeRepo ? DATA.cards.filter(c => c.repoName === activeRepo) : DATA.cards;
}

function update() {
  const q = document.getElementById('search').value.trim();
  const pool = scopedCards();
  if (!q) { render(pool.slice(0, 30), null); return; }
  const qTokens = tokenize(q);
  const scored = pool.map(c => ({ c, s: scoreCard(c, qTokens) })).filter(r => r.s > 0)
    .sort((a,b) => b.s - a.s).slice(0, 30).map(r => r.c);
  render(scored, qTokens);
}

async function removeRepo(name) {
  if (!confirm('Remove "' + name + '" and its ' + DATA.cards.filter(c=>c.repoName===name).length + ' feature(s) from the index?')) return;
  const resp = await fetch('/api/repo/' + encodeURIComponent(name), { method: 'DELETE' });
  if (resp.ok) location.reload();
  else alert('Failed to remove repo.');
}

async function wipeAll() {
  if (!confirm('Wipe the ENTIRE index (' + Object.keys(DATA.repos).length + ' repo(s), ' + DATA.cards.length + ' feature(s))? This cannot be undone.')) return;
  const resp = await fetch('/api/wipe', { method: 'POST' });
  if (resp.ok) location.reload();
  else alert('Failed to wipe index.');
}

function renderRepoBar() {
  const el = document.getElementById('repoBar');
  const names = Object.keys(DATA.repos);
  if (!names.length) { el.innerHTML = ''; return; }

  const chips = names.map(name => {
    const count = DATA.cards.filter(c => c.repoName === name).length;
    const isActive = activeRepo === name;
    return \`
      <span class="repo-chip\${isActive ? ' active' : ''}">
        <button class="name-btn" onclick="toggleRepo('\${name}')" title="Filter to this repo">\${name} <span class="count">(\${count})</span></button>
        <button onclick="removeRepo('\${name}')" title="Remove this repo">×</button>
      </span>
    \`;
  }).join('');

  el.innerHTML = chips + '<button class="wipe-btn" onclick="wipeAll()">Wipe all data</button>';
}

function toggleRepo(name) {
  activeRepo = (activeRepo === name) ? null : name;
  renderRepoBar();
  update();
}

document.getElementById('search').addEventListener('input', update);
document.getElementById('stats').textContent = Object.keys(DATA.repos).length + ' repo(s) · ' + DATA.cards.length + ' feature(s) indexed';
renderRepoBar();
render(DATA.cards.slice(0, 30), null);

async function runTerminalCommand() {
  const input = document.getElementById('termCmd');
  const command = input.value.trim();
  const btn = document.getElementById('termBtn');
  const out = document.getElementById('termOutput');
  if (!command) return;

  btn.disabled = true;
  out.textContent = '';

  try {
    const resp = await fetch('/api/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command })
    });
    if (!resp.body) { out.textContent = await resp.text(); return; }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out.textContent += decoder.decode(value, { stream: true });
      out.scrollTop = out.scrollHeight;
    }
  } catch (e) {
    out.textContent += '\\n[error: ' + e.message + ']';
  } finally {
    btn.disabled = false;
  }

  // scan/remove/wipe-like commands change the index; refresh data after a run
  if (/^(scan|remove|wipe)\\b/.test(command)) {
    setTimeout(() => location.reload(), 600);
  }
}

document.getElementById('termCmd').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runTerminalCommand();
});

async function runScan() {
  const repoPath = document.getElementById('scanPath').value.trim();
  const repoName = document.getElementById('scanName').value.trim();
  const useLLM = document.getElementById('scanLlm').checked;
  const btn = document.getElementById('scanBtn');
  const status = document.getElementById('scanStatus');

  if (!repoPath) { status.textContent = 'Enter a repo path first.'; return; }

  btn.disabled = true;
  status.textContent = 'Scanning... this can take a while for large repos.';

  try {
    const resp = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath, repoName, useLLM })
    });

    if (!resp.ok || !resp.body) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || 'Scan failed');
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalMsg = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.type === 'progress') {
          const icon = msg.status === 'llm' ? '✓' : '↺';
          status.textContent = 'Scanning [' + msg.index + '/' + msg.total + '] ' + icon + ' ' + msg.module;
        } else if (msg.type === 'done' || msg.type === 'error') {
          finalMsg = msg;
        }
      }
    }

    if (!finalMsg) throw new Error('Scan ended unexpectedly.');
    if (finalMsg.type === 'error') throw new Error(finalMsg.error || 'Scan failed');

    status.textContent = 'Indexed "' + finalMsg.repoName + '" — ' + finalMsg.cardCount + ' feature(s).';
    location.reload();
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}
</script>
</body>
</html>`;

function startServer(port = 4848) {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      const index = loadIndex();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(PAGE_TEMPLATE(JSON.stringify(index)));
    } else if (req.url.startsWith('/api/search')) {
      const url = new URL(req.url, `http://localhost:${port}`);
      const q = url.searchParams.get('q') || '';
      const index = loadIndex();
      const results = search(index, q, { topN: 20 });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(results.map(r => r.card)));
    } else if (req.url.startsWith('/api/repo/') && req.method === 'DELETE') {
      const name = decodeURIComponent(req.url.slice('/api/repo/'.length));
      if (!name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'repo name is required' }));
        return;
      }
      removeRepo(name);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ removed: name }));
    } else if (req.url === '/api/wipe' && req.method === 'POST') {
      saveIndex({ repos: {}, cards: [] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ wiped: true }));
    } else if (req.url === '/api/exec' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let command;
        try {
          ({ command } = JSON.parse(body || '{}'));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid request body');
          return;
        }
        if (!command || typeof command !== 'string' || !command.trim()) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('command is required');
          return;
        }

        const args = tokenizeCommand(command.trim());
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.write(`$ context-optimizer ${args.join(' ')}\n\n`);

        const child = spawn(process.execPath, [CLI_PATH, ...args], {
          cwd: path.join(__dirname, '..'),
          env: process.env
        });
        child.stdout.on('data', d => res.write(d));
        child.stderr.on('data', d => res.write(d));
        child.on('close', code => {
          res.write(`\n[exited with code ${code}]\n`);
          res.end();
        });
        child.on('error', e => {
          res.write(`\n[failed to run: ${e.message}]\n`);
          res.end();
        });
      });
    } else if (req.url === '/api/scan' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { repoPath, repoName, useLLM } = JSON.parse(body || '{}');
          if (!repoPath || typeof repoPath !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'repoPath is required' }));
            return;
          }
          const resolved = path.resolve(repoPath);
          if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Not a directory: ${resolved}` }));
            return;
          }

          const scanResult = scanRepo(resolved, repoName || null);
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
          res.write(JSON.stringify({ type: 'start', total: scanResult.modules.length }) + '\n');

          const onProgress = (progress) => {
            res.write(JSON.stringify({ type: 'progress', ...progress }) + '\n');
          };

          buildFeatureCards(scanResult, { useLLM: Boolean(useLLM), onProgress })
            .then(cards => {
              upsertRepo(scanResult, cards);
              res.write(JSON.stringify({ type: 'done', repoName: scanResult.repoName, cardCount: cards.length }) + '\n');
              res.end();
            })
            .catch(e => {
              res.write(JSON.stringify({ type: 'error', error: e.message }) + '\n');
              res.end();
            });
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request body' }));
        }
      });
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port, () => {
    console.log(`\n🌐 Context Optimizer UI running at http://localhost:${port}\n`);
  });

  return server;
}

module.exports = { startServer };
