#!/bin/zsh
# Build the web app into apps/web/dist-wp1 (private outDir, delete afterwards) and serve it on 4482 with the mock API on 3001.
cd "$(dirname $0)/../../../../.."
(cd apps/web && PUBLIC_URL=http://127.0.0.1:4482 npx astro build --root . --outDir "$PWD/dist-wp1" >/dev/null 2>&1)
pkill -f "dist-wp1/server/entry.mjs"; pkill -f mock-api.mjs
(node design/figcraft/handoff/comparison-20261029/render/mock-api.mjs >/tmp/mock.log 2>&1 &)
(HOST=127.0.0.1 PORT=4482 node apps/web/dist-wp1/server/entry.mjs >/tmp/web.log 2>&1 &)
