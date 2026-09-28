# Context Optimizer

A Node.js CLI tool that scans your existing repositories, builds a searchable
index of the **features already implemented**, and lets you query that index
before starting a new project or feature — so you reuse what exists instead
of rebuilding it.

No database, no external API required to get started. Zero npm dependencies.

## How it works

1. **Scan** — walks a repo, groups files into modules, extracts function/class
   names, API routes, and reads `package.json` + `README.md`.
2. **Summarize** — turns each module into a "feature card" (name, description,
   tags, tech stack, file paths). Works out of the box with keyword heuristics;
   if you set `GEMINI_API_KEY`, it uses Gemini to write richer, more accurate
   summaries instead.
3. **Store** — feature cards are saved to a local JSON index
   (`.context-optimizer/index.json`), which you can commit to git and share
   with your team, or point at a shared/global location.
4. **Query** — describe what you're about to build in plain English; it
   returns the most relevant existing features, with file paths, so you can
   go look at (and reuse) the real code.
5. **Browse visually** — `serve` spins up a small local web UI to search the
   index interactively.

## Install

```bash
cd context-optimizer
npm install    # no dependencies today, but future-proofs it
npm link       # optional: makes `context-optimizer` available globally
```

Or just run it directly with `node bin/cli.js ...` without installing.

## Usage

### 1. Scan your repositories

```bash
node bin/cli.js scan /path/to/old-project-1 --name project-1
node bin/cli.js scan /path/to/old-project-2 --name project-2
node bin/cli.js scan .                          # scan the current folder
node bin/cli.js scan https://github.com/user/repo.git --name repo  # or a git URL
```

Run this once per repo you want indexed. Re-run it any time a repo changes —
it replaces that repo's old entries with a fresh scan.

A git URL (`https://...git`, or a github/gitlab/bitbucket link, or `git@...`)
is shallow-cloned to a temp directory, scanned, then the clone is deleted —
useful when running the web UI somewhere (e.g. a hosted deployment) that
doesn't have your local filesystem paths available. Note that file paths
shown in query results point at that now-deleted temp clone, so they're only
useful as a pointer back to the repo itself, not a live local path.

**Optional: richer summaries with Gemini**

```bash
export GEMINI_API_KEY=AIza...
node bin/cli.js scan /path/to/old-project-1 --llm
```

Or drop it in a `.env` file in the directory you run the command from
(see `.env.example`):

```
GEMINI_API_KEY=AIza...
```

Without an API key, the tool still works using keyword-based heuristics
(looks at file/function names against known patterns like auth, payments,
notifications, file-upload, etc).

### 2. Query before building something new

```bash
node bin/cli.js query "I need user login with email and password"
node bin/cli.js query "send email notifications" --top 3
node bin/cli.js query "file upload to cloud storage" --tag file-upload
node bin/cli.js query "payment checkout" --repo project-1
```

Example output:

```
🔎 Top matches for "I need user login":

1. [project-1] src/auth  (relevance: 12)
   Module "src/auth" handles JWT-based login and token generation.
   tags: authentication, api
   files: src/auth/login.js, src/auth/middleware.js
   path: /path/to/old-project-1/src/auth/login.js

💡 Reference these before writing new code — reuse or adapt rather than rebuild.
```

### 3. List what's indexed

```bash
node bin/cli.js list
node bin/cli.js list --repo project-1
```

### 4. Browse visually

```bash
node bin/cli.js serve --port 4848
# open http://localhost:4848
```

A simple dark-mode search UI over the same index — type a description,
see matching feature cards live.

### 5. Remove a repo from the index

```bash
node bin/cli.js remove project-1
```

## Where the index lives

By default: `./.context-optimizer/index.json` (relative to wherever you run
the command). This makes it easy to commit per-team-project, or you can set:

```bash
export CONTEXT_OPTIMIZER_HOME=~/.context-optimizer
```

to keep a single global index across all your machines/projects instead.

## Using this from Claude / another coding agent

Point your coding assistant at the index file directly, or wrap the `query`
command as a pre-step before generating code:

```bash
node bin/cli.js query "<description of the feature you're about to build>" --top 5
```

Feed the output back into your prompt/context so the assistant knows what
already exists before it starts writing new code.

## Project structure

```
context-optimizer/
├── bin/
│   └── cli.js          # CLI entrypoint (scan, query, list, remove, serve)
├── src/
│   ├── config.js        # paths, ignored dirs, file-extension rules
│   ├── scanner.js        # walks repos, extracts modules + signatures
│   ├── summarizer.js      # builds feature cards (heuristic or Gemini-based)
│   ├── store.js            # JSON index read/write
│   ├── search.js            # keyword/relevance scoring search engine
│   └── webui.js               # local web UI + tiny JSON search API
├── package.json
└── README.md
```

## Extending this

- Swap `search.js`'s keyword scoring for real embeddings (e.g. call an
  embeddings API and store vectors in the card) for semantic search.
- Add a `pre-commit` or CI hook that runs `scan .` automatically so the
  index never goes stale.
- Add more `TAG_RULES` in `summarizer.js` for domains specific to your stack.
- Swap the JSON file store for SQLite/Postgres if the index grows large or
  needs to be shared across a team via a server instead of a shared file.
# Context-Optimizer
