const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with',
  'is', 'are', 'be', 'this', 'that', 'i', 'want', 'need', 'build', 'create',
  'new', 'project', 'feature', 'implement', 'add', 'make', 'my'
]);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_/]/g, ' ')
    .split(/[\s\-_/]+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

function scoreCard(card, queryTokens) {
  const nameTokens = tokenize(card.featureName);
  const tagTokens = tokenize((card.tags || []).join(' '));
  const descTokens = tokenize(card.description);
  const sigTokens = tokenize((card.signatures || []).join(' '));
  const stackTokens = tokenize((card.techStack || []).join(' '));
  const fileTokens = tokenize((card.files || []).join(' '));

  let score = 0;
  for (const qt of queryTokens) {
    if (nameTokens.includes(qt)) score += 5;
    if (tagTokens.includes(qt)) score += 4;
    if (stackTokens.includes(qt)) score += 3;
    if (sigTokens.includes(qt)) score += 2;
    if (fileTokens.includes(qt)) score += 2;
    if (descTokens.includes(qt)) score += 1;

    // partial / substring matches (e.g. "auth" matching "authentication")
    if (nameTokens.some(t => t.includes(qt) || qt.includes(t))) score += 2;
    if (tagTokens.some(t => t.includes(qt) || qt.includes(t))) score += 2;
    if (fileTokens.some(t => t.includes(qt) || qt.includes(t))) score += 1;
  }
  return score;
}

/**
 * Search the feature card index against a free-text query.
 * Returns cards sorted by relevance score, highest first.
 */
function search(index, queryText, options = {}) {
  const { topN = 8, repoFilter = null, tagFilter = null } = options;
  const queryTokens = tokenize(queryText);

  let candidates = index.cards;
  if (repoFilter) {
    candidates = candidates.filter(c => c.repoName.toLowerCase() === repoFilter.toLowerCase());
  }
  if (tagFilter) {
    candidates = candidates.filter(c => (c.tags || []).includes(tagFilter.toLowerCase()));
  }

  const scored = candidates
    .map(card => ({ card, score: scoreCard(card, queryTokens) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return scored;
}

module.exports = { search, tokenize };
