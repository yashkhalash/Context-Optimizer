const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Only accept things that actually look like a git remote — never hand
// unvalidated input to `git clone` even though spawn (no shell) already
// prevents shell injection, this keeps out obviously-wrong input early.
const GIT_URL_PATTERN = /^(https?:\/\/[^\s]+\.git|https?:\/\/(www\.)?(github|gitlab|bitbucket)\.com\/[^\s]+|git@[^\s:]+:[^\s]+\.git)$/i;

function isGitUrl(input) {
  return typeof input === 'string' && GIT_URL_PATTERN.test(input.trim());
}

function repoNameFromUrl(url) {
  const base = url.trim().replace(/\.git$/i, '').split(/[/:]/).filter(Boolean).pop();
  return base || 'repo';
}

/**
 * Shallow-clones a git URL into a fresh temp directory.
 * Returns { dir, cleanup, repoName }. Caller is responsible for calling
 * cleanup() once done with the clone (heuristic/LLM scan reads finish).
 */
function cloneRepo(url) {
  return new Promise((resolve, reject) => {
    if (!isGitUrl(url)) {
      reject(new Error('That does not look like a valid git URL (expected an https:// or git@ URL ending in .git, or a github/gitlab/bitbucket link).'));
      return;
    }

    const dir = path.join(os.tmpdir(), `context-optimizer-clone-${crypto.randomBytes(6).toString('hex')}`);
    const child = spawn('git', ['clone', '--depth', '1', url.trim(), dir]);

    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });

    child.on('error', err => reject(new Error(`git is not available: ${err.message}`)));

    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`git clone failed: ${stderr.trim().slice(-500) || 'unknown error'}`));
        return;
      }
      resolve({
        dir,
        repoName: repoNameFromUrl(url),
        cleanup: () => fs.rm(dir, { recursive: true, force: true }, () => {})
      });
    });
  });
}

module.exports = { cloneRepo, isGitUrl };
