const fs = require('fs');
const path = require('path');
const { IGNORED_DIRS, CODE_EXTENSIONS, MAX_FILE_BYTES } = require('./config');

/**
 * Recursively walk a directory, returning a flat list of file paths
 * (absolute), skipping ignored directories.
 */
function walk(dir, fileList = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return fileList;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && !['\.env.example'].includes(entry.name)) {
      // allow dotfiles like .env.example through generically, but skip hidden dirs
      if (entry.isDirectory()) continue;
    }
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(fullPath, fileList);
    } else if (entry.isFile()) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

/**
 * Extract simple, language-agnostic signals from a source file:
 * exported function names, class names, component names.
 * This is regex-based heuristics, not a real parser — good enough
 * to build a feature index without pulling in a full AST toolchain
 * per language.
 */
function extractSignatures(content, ext) {
  const signatures = new Set();

  const patterns = [
    /export\s+(?:default\s+)?function\s+([A-Za-z0-9_]+)/g,
    /export\s+(?:default\s+)?class\s+([A-Za-z0-9_]+)/g,
    /export\s+const\s+([A-Za-z0-9_]+)\s*=/g,
    /module\.exports\.([A-Za-z0-9_]+)\s*=/g,
    /module\.exports\s*=\s*(?:function\s+)?([A-Za-z0-9_]+)?/g,
    /class\s+([A-Za-z0-9_]+)/g,
    /function\s+([A-Za-z0-9_]+)\s*\(/g,
    /def\s+([A-Za-z0-9_]+)\s*\(/g, // python
    /router\.(get|post|put|delete|patch)\(['"`]([^'"`]+)['"`]/g // express routes
  ];

  for (const re of patterns) {
    let match;
    while ((match = re.exec(content)) !== null) {
      if (re.source.includes('router')) {
        if (match[1] && match[2]) signatures.add(`ROUTE ${match[1].toUpperCase()} ${match[2]}`);
      } else if (match[1]) {
        signatures.add(match[1]);
      }
    }
  }

  return Array.from(signatures).filter(Boolean).slice(0, 40);
}

function readSafe(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return null;
  }
}

function readPackageJson(repoPath) {
  const pkgPath = path.join(repoPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      name: parsed.name || null,
      description: parsed.description || null,
      dependencies: Object.keys(parsed.dependencies || {}),
      devDependencies: Object.keys(parsed.devDependencies || {})
    };
  } catch (e) {
    return null;
  }
}

function readReadme(repoPath) {
  const candidates = ['README.md', 'Readme.md', 'readme.md', 'README.MD'];
  for (const name of candidates) {
    const p = path.join(repoPath, name);
    if (fs.existsSync(p)) {
      const content = readSafe(p) || '';
      return content.slice(0, 4000); // cap it, we just want the gist
    }
  }
  return null;
}

/**
 * Scan a single repository directory and return a structured summary:
 * metadata + a list of "modules" (folders under src/lib/app/etc, or
 * top-level folders) each with their own extracted signatures.
 */
function scanRepo(repoPath, repoName) {
  const absPath = path.resolve(repoPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Path does not exist: ${absPath}`);
  }

  const pkg = readPackageJson(absPath);
  const readme = readReadme(absPath);
  const allFiles = walk(absPath);

  const codeFiles = allFiles.filter(f => CODE_EXTENSIONS.has(path.extname(f)));

  // Group files by their top-level module folder (e.g. src/auth, src/payments)
  const moduleMap = new Map();

  for (const filePath of codeFiles) {
    const rel = path.relative(absPath, filePath);
    const parts = rel.split(path.sep);

    // module key = the file's immediate parent directory (e.g.
    // "src/modules/v1/admin/order" for a file at .../admin/order/order.controller.ts,
    // but "src/modules/v1/admin" for a file directly at .../admin/admin.service.ts).
    // This naturally splits deeply nested feature folders apart instead of
    // collapsing everything under a shared container folder into one module.
    const dir = path.dirname(rel);
    const moduleKey = dir === '.' ? path.basename(filePath, path.extname(filePath)) : dir.split(path.sep).join('/');

    if (!moduleMap.has(moduleKey)) {
      moduleMap.set(moduleKey, { files: [], signatures: new Set() });
    }
    const entry = moduleMap.get(moduleKey);
    entry.files.push(rel);

    const content = readSafe(filePath);
    if (content) {
      const sigs = extractSignatures(content, path.extname(filePath));
      sigs.forEach(s => entry.signatures.add(s));
    }
  }

  const modules = Array.from(moduleMap.entries()).map(([key, val]) => ({
    module: key,
    fileCount: val.files.length,
    files: val.files.slice(0, 25),
    signatures: Array.from(val.signatures)
  })).filter(m => m.signatures.length > 0 || m.fileCount > 0);

  return {
    repoName: repoName || pkg?.name || path.basename(absPath),
    repoPath: absPath,
    scannedAt: new Date().toISOString(),
    packageInfo: pkg,
    readmeExcerpt: readme,
    totalFiles: allFiles.length,
    totalCodeFiles: codeFiles.length,
    modules
  };
}

module.exports = { scanRepo, walk, extractSignatures };
