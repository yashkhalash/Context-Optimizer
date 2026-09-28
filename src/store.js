const fs = require('fs');
const { getIndexPath, ensureStoreDir } = require('./config');

function loadIndex() {
  const indexPath = getIndexPath();
  if (!fs.existsSync(indexPath)) {
    return { repos: {}, cards: [] };
  }
  try {
    const raw = fs.readFileSync(indexPath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Warning: index file was unreadable, starting fresh.', e.message);
    return { repos: {}, cards: [] };
  }
}

function saveIndex(index) {
  ensureStoreDir();
  const indexPath = getIndexPath();
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
  return indexPath;
}

/**
 * Merge a fresh scan (repo metadata + feature cards) into the index.
 * Any previous cards belonging to this repo are replaced.
 */
function upsertRepo(scanResult, cards) {
  const index = loadIndex();

  index.repos[scanResult.repoName] = {
    repoName: scanResult.repoName,
    repoPath: scanResult.repoPath,
    scannedAt: scanResult.scannedAt,
    totalFiles: scanResult.totalFiles,
    totalCodeFiles: scanResult.totalCodeFiles,
    packageInfo: scanResult.packageInfo,
    readmeExcerpt: scanResult.readmeExcerpt
  };

  index.cards = index.cards.filter(c => c.repoName !== scanResult.repoName);
  index.cards.push(...cards);

  saveIndex(index);
  return index;
}

function removeRepo(repoName) {
  const index = loadIndex();
  delete index.repos[repoName];
  index.cards = index.cards.filter(c => c.repoName !== repoName);
  saveIndex(index);
  return index;
}

module.exports = { loadIndex, saveIndex, upsertRepo, removeRepo };
