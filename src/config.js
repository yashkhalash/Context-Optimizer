const path = require('path');
const os = require('os');
const fs = require('fs');

// Loads KEY=value pairs from a .env file in the current working directory
// into process.env, without overwriting variables already set. No-op if the
// file doesn't exist.
function loadDotEnv(dir = process.cwd()) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// The index lives in the current working directory by default so it can be
// committed to git and shared with your team. You can override with
// CONTEXT_OPTIMIZER_HOME env var to keep it global instead (e.g. ~/.context-optimizer).
const DEFAULT_LOCAL_DIR = path.join(process.cwd(), '.context-optimizer');
const GLOBAL_DIR = path.join(os.homedir(), '.context-optimizer');

function getStoreDir() {
  if (process.env.CONTEXT_OPTIMIZER_HOME) {
    return process.env.CONTEXT_OPTIMIZER_HOME;
  }
  return DEFAULT_LOCAL_DIR;
}

function getIndexPath() {
  return path.join(getStoreDir(), 'index.json');
}

function ensureStoreDir() {
  const dir = getStoreDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// Directories we never want to walk into.
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out',
  '.next', '.nuxt', 'coverage', '.cache', 'vendor', '__pycache__',
  '.venv', 'venv', 'env', '.idea', '.vscode', 'target', 'bin', 'obj',
  '.context-optimizer'
]);

// Extensions we attempt to parse for function/class/component signatures.
const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.java', '.go', '.rb', '.php', '.cs', '.vue'
]);

const MAX_FILE_BYTES = 300 * 1024; // skip huge generated files

module.exports = {
  loadDotEnv,
  getStoreDir,
  getIndexPath,
  ensureStoreDir,
  IGNORED_DIRS,
  CODE_EXTENSIONS,
  MAX_FILE_BYTES,
  GLOBAL_DIR
};
