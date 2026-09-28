Here's how to run the project step by step:

1. Set your API key (already in .env, but for reference):


cd /home/yash-khalash/Downloads/context-optimizer
echo "GEMINI_API_KEY=your-key-here" > .env


2. Start the web UI:


node bin/cli.js serve --port 4848
Open http://localhost:4848 in your browser.

3. Scan a repo (CLI — recommended for large repos, since you see live progress in the terminal instead of a stuck-looking browser button):


node bin/cli.js scan /path/to/repo --name my-repo --llm
Drop --llm to skip Gemini entirely and use instant heuristic tagging (no API calls, no rate-limit waiting):


node bin/cli.js scan /path/to/repo --name my-repo


4. List what's indexed:


node bin/cli.js list
node bin/cli.js list --repo my-repo

5. Query before building something new:


node bin/cli.js query "user login with email and password"
node bin/cli.js query "file upload to cloud storage" --tag file-upload
node bin/cli.js query "payment checkout" --repo my-repo

6. Remove a repo from the index:

node bin/cli.js remove my-repo


7. Wipe everything and start over:

rm -f .context-optimizer/index.json