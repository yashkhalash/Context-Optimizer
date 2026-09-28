const crypto = require('crypto');

// Keyword buckets used for heuristic tagging when no LLM key is available.
const TAG_RULES = [
  { tag: 'authentication', words: ['auth', 'login', 'jwt', 'session', 'oauth', 'passport', 'signin', 'signup'] },
  { tag: 'payments', words: ['payment', 'stripe', 'checkout', 'invoice', 'billing', 'razorpay', 'paypal'] },
  { tag: 'notifications', words: ['notify', 'notification', 'email', 'sms', 'push', 'mailer', 'webhook'] },
  { tag: 'database', words: ['db', 'model', 'schema', 'migration', 'mongoose', 'sequelize', 'prisma', 'sql'] },
  { tag: 'api', words: ['controller', 'route', 'router', 'endpoint', 'api'] },
  { tag: 'ui-component', words: ['component', 'button', 'modal', 'form', 'table', 'card', 'widget'] },
  { tag: 'file-upload', words: ['upload', 'multer', 's3', 'storage', 'file'] },
  { tag: 'search', words: ['search', 'index', 'elastic', 'algolia', 'query'] },
  { tag: 'testing', words: ['test', 'spec', 'mock', 'jest', 'mocha'] },
  { tag: 'admin', words: ['admin', 'dashboard', 'panel'] },
  { tag: 'user-management', words: ['user', 'profile', 'account', 'role', 'permission'] },
  { tag: 'analytics', words: ['analytics', 'tracking', 'metrics', 'stats'] },
  { tag: 'caching', words: ['cache', 'redis', 'memoize'] },
  { tag: 'scheduling', words: ['cron', 'schedule', 'queue', 'worker', 'job'] },
  { tag: 'realtime', words: ['socket', 'websocket', 'pusher', 'realtime'] }
];

function inferTags(text) {
  const lower = text.toLowerCase();
  const tags = new Set();
  for (const rule of TAG_RULES) {
    if (rule.words.some(w => lower.includes(w))) tags.add(rule.tag);
  }
  return Array.from(tags);
}

function hashId(...parts) {
  return crypto.createHash('sha1').update(parts.join('::')).digest('hex').slice(0, 12);
}

/**
 * Heuristic feature-card builder (no API key required).
 * Turns each scanned module into a searchable card with inferred tags.
 */
function buildHeuristicCards(scanResult) {
  const { repoName, repoPath, packageInfo, modules } = scanResult;
  const cards = [];

  for (const mod of modules) {
    const searchableBlob = [mod.module, ...mod.signatures, ...mod.files].join(' ');
    const tags = inferTags(searchableBlob);
    const techStack = (packageInfo?.dependencies || []).filter(dep =>
      searchableBlob.toLowerCase().includes(dep.toLowerCase().split('/').pop())
    ).slice(0, 8);

    cards.push({
      id: hashId(repoName, mod.module),
      repoName,
      repoPath,
      featureName: mod.module,
      description: describeModule(mod, tags),
      tags: tags.length ? tags : ['general'],
      techStack: techStack.length ? techStack : (packageInfo?.dependencies || []).slice(0, 5),
      files: mod.files,
      signatures: mod.signatures,
      fileCount: mod.fileCount,
      generatedBy: 'heuristic'
    });
  }

  return cards;
}

function describeModule(mod, tags) {
  const sigPreview = mod.signatures.slice(0, 6).join(', ') || 'no exported symbols detected';
  const tagPhrase = tags.length ? `Likely related to: ${tags.join(', ')}.` : '';
  return `Module "${mod.module}" (${mod.fileCount} file(s)). Key symbols: ${sigPreview}. ${tagPhrase}`.trim();
}

/**
 * LLM-based feature-card builder. Uses the Gemini API to write a
 * genuinely useful feature summary per module, when GEMINI_API_KEY
 * is set. Falls back silently to heuristic cards on any failure.
 */
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callGemini(prompt, apiKey, { maxRetries = 1, maxWaitSeconds = 8 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 500,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      }
    );

    if (resp.status === 429 && attempt < maxRetries) {
      const data = await resp.json().catch(() => null);
      const retryInfo = data?.error?.details?.find(d => d.retryDelay);
      const retrySeconds = retryInfo ? parseFloat(retryInfo.retryDelay) : (attempt + 1) * 5;
      await sleep(Math.min(retrySeconds, maxWaitSeconds) * 1000 + 500);
      continue;
    }

    return resp.json();
  }
}

async function buildLLMCards(scanResult, apiKey, onProgress) {
  const { repoName, repoPath, packageInfo, modules } = scanResult;
  const cards = [];

  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    const heuristicTags = inferTags([mod.module, ...mod.signatures].join(' '));
    try {
      const prompt = `You are cataloguing a codebase for a feature-reuse index.
Given the following module info from a repo named "${repoName}", write a JSON object
with keys: "description" (1-2 plain sentences describing what this module most likely does),
"tags" (3-6 short lowercase tags), "reusable" (true/false — is this generic enough to reuse in another project?).
Respond with ONLY the JSON object, no markdown, no preamble.

Module path: ${mod.module}
Files: ${mod.files.slice(0, 15).join(', ')}
Exported/declared symbols: ${mod.signatures.slice(0, 25).join(', ') || 'none detected'}
Package dependencies available in repo: ${(packageInfo?.dependencies || []).slice(0, 20).join(', ') || 'none'}`;

      const data = await callGemini(prompt, apiKey);
      const text = (data?.candidates || [])
        .flatMap(c => (c.content?.parts || []).map(p => p.text || ''))
        .join('')
        .trim();
      const cleaned = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      cards.push({
        id: hashId(repoName, mod.module),
        repoName,
        repoPath,
        featureName: mod.module,
        description: parsed.description || describeModule(mod, heuristicTags),
        tags: (parsed.tags && parsed.tags.length ? parsed.tags : heuristicTags),
        reusable: typeof parsed.reusable === 'boolean' ? parsed.reusable : null,
        techStack: (packageInfo?.dependencies || []).slice(0, 8),
        files: mod.files,
        signatures: mod.signatures,
        fileCount: mod.fileCount,
        generatedBy: 'llm'
      });
      onProgress?.({ index: i + 1, total: modules.length, module: mod.module, status: 'llm' });
    } catch (e) {
      // Fall back to heuristic card for this module on any error
      cards.push({
        id: hashId(repoName, mod.module),
        repoName,
        repoPath,
        featureName: mod.module,
        description: describeModule(mod, heuristicTags) + ' (LLM summary failed, heuristic used.)',
        tags: heuristicTags.length ? heuristicTags : ['general'],
        techStack: (packageInfo?.dependencies || []).slice(0, 5),
        files: mod.files,
        signatures: mod.signatures,
        fileCount: mod.fileCount,
        generatedBy: 'heuristic-fallback'
      });
      onProgress?.({ index: i + 1, total: modules.length, module: mod.module, status: 'fallback' });
    }
  }

  return cards;
}

async function buildFeatureCards(scanResult, options = {}) {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  if (apiKey && options.useLLM !== false) {
    return buildLLMCards(scanResult, apiKey, options.onProgress);
  }
  return buildHeuristicCards(scanResult);
}

module.exports = { buildFeatureCards, buildHeuristicCards, inferTags };
