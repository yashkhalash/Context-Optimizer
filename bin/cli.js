#!/usr/bin/env node

const path = require('path');
const { scanRepo } = require('../src/scanner');
const { buildFeatureCards } = require('../src/summarizer');
const { upsertRepo, loadIndex, removeRepo } = require('../src/store');
const { search } = require('../src/search');
const { startServer } = require('../src/webui');
const { getIndexPath, loadDotEnv } = require('../src/config');

loadDotEnv();

function parseArgs(argv) {
  const [, , command, ...rest] = argv;
  const positional = [];
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { command, positional, flags };
}

function printHelp() {
  console.log(`
Context Optimizer — find reusable features across your own repos before building new ones.

Usage:
  context-optimizer scan <path> [--name <repoName>] [--llm] [--no-llm]
      Scan a repository and add/update its features in the index.
      --llm forces use of the Gemini API (needs GEMINI_API_KEY) for
      richer summaries. Without an API key, a heuristic summarizer is used.
      If GEMINI_API_KEY is set, LLM mode is used automatically — pass
      --no-llm to force the fast heuristic summarizer instead.

  context-optimizer query "<description of what you're building>" [--top 5] [--repo <name>] [--tag <tag>]
      Search the index for existing features relevant to a new task.

  context-optimizer list [--repo <name>]
      List all indexed repos and feature counts, or all features in a repo.

  context-optimizer remove <repoName>
      Remove a repo and its features from the index.

  context-optimizer serve [--port 4848]
      Launch a local web UI to browse/search the feature index visually.

Examples:
  context-optimizer scan ./my-old-ecommerce-app --name ecommerce-app
  context-optimizer scan ../another-repo
  context-optimizer query "I need user login with email and password"
  context-optimizer query "file upload to cloud storage" --tag file-upload
  context-optimizer serve --port 5000
`);
}

async function main() {
  const { command, positional, flags } = parseArgs(process.argv);

  if (!command || flags.help || command === 'help') {
    printHelp();
    return;
  }

  switch (command) {
    case 'scan': {
      const targetPath = positional[0] || '.';
      const repoName = flags.name || null;
      console.log(`\n📦 Scanning ${path.resolve(targetPath)} ...`);
      const scanResult = scanRepo(targetPath, repoName);
      console.log(`   Found ${scanResult.totalCodeFiles} code file(s) across ${scanResult.modules.length} module(s).`);

      const useLLM = !flags['no-llm'] && Boolean(flags.llm || process.env.GEMINI_API_KEY);
      if (flags.llm && !process.env.GEMINI_API_KEY) {
        console.log('   ⚠️  --llm passed but GEMINI_API_KEY is not set. Falling back to heuristic mode.');
      } else if (useLLM) {
        console.log('   🤖 Generating feature summaries with Gemini...');
      } else {
        console.log('   🧩 Generating feature summaries heuristically (set GEMINI_API_KEY for richer summaries)...');
      }

      const onProgress = useLLM
        ? ({ index, total, module, status }) => {
            const icon = status === 'llm' ? '✓' : '↺';
            process.stdout.write(`   [${index}/${total}] ${icon} ${module}${status === 'fallback' ? ' (fallback)' : ''}\n`);
          }
        : undefined;

      const cards = await buildFeatureCards(scanResult, { useLLM, onProgress });
      upsertRepo(scanResult, cards);

      console.log(`\n✅ Indexed "${scanResult.repoName}" — ${cards.length} feature card(s) saved.`);
      console.log(`   Index file: ${getIndexPath()}\n`);
      break;
    }

    case 'query': {
      const queryText = positional.join(' ');
      if (!queryText) {
        console.log('Please provide a description, e.g.\n  context-optimizer query "user authentication with JWT"');
        return;
      }
      const index = loadIndex();
      if (index.cards.length === 0) {
        console.log('\nNo repos indexed yet. Run `context-optimizer scan <path>` first.\n');
        return;
      }
      const topN = flags.top ? parseInt(flags.top, 10) : 5;
      const results = search(index, queryText, {
        topN,
        repoFilter: flags.repo || null,
        tagFilter: flags.tag || null
      });

      if (results.length === 0) {
        console.log(`\nNo existing features matched "${queryText}". You're likely building something new — go ahead.\n`);
        return;
      }

      console.log(`\n🔎 Top matches for "${queryText}":\n`);
      results.forEach(({ card, score }, i) => {
        console.log(`${i + 1}. [${card.repoName}] ${card.featureName}  (relevance: ${score})`);
        console.log(`   ${card.description}`);
        console.log(`   tags: ${card.tags.join(', ')}`);
        console.log(`   files: ${card.files.slice(0, 4).join(', ')}${card.files.length > 4 ? ', ...' : ''}`);
        console.log(`   path: ${path.join(card.repoPath, card.files[0] || '')}`);
        console.log('');
      });
      console.log('💡 Reference these before writing new code — reuse or adapt rather than rebuild.\n');
      break;
    }

    case 'list': {
      const index = loadIndex();
      if (flags.repo) {
        const cards = index.cards.filter(c => c.repoName.toLowerCase() === flags.repo.toLowerCase());
        if (!cards.length) {
          console.log(`No features found for repo "${flags.repo}".`);
          return;
        }
        console.log(`\nFeatures in "${flags.repo}":\n`);
        cards.forEach(c => console.log(`  - ${c.featureName}  [${c.tags.join(', ')}]`));
        console.log('');
        return;
      }

      const repoNames = Object.keys(index.repos);
      if (!repoNames.length) {
        console.log('\nNo repos indexed yet. Run `context-optimizer scan <path>` first.\n');
        return;
      }
      console.log('\nIndexed repositories:\n');
      repoNames.forEach(name => {
        const repo = index.repos[name];
        const featureCount = index.cards.filter(c => c.repoName === name).length;
        console.log(`  - ${name}  (${featureCount} feature(s), scanned ${repo.scannedAt})`);
        console.log(`      ${repo.repoPath}`);
      });
      console.log('');
      break;
    }

    case 'remove': {
      const repoName = positional[0];
      if (!repoName) {
        console.log('Usage: context-optimizer remove <repoName>');
        return;
      }
      removeRepo(repoName);
      console.log(`Removed "${repoName}" from the index.`);
      break;
    }

    case 'serve': {
      const port = flags.port ? parseInt(flags.port, 10) : parseInt(process.env.PORT, 10) || 4848;
      startServer(port);
      break;
    }

    default:
      console.log(`Unknown command: ${command}`);
      printHelp();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
