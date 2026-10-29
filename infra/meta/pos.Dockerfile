# Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
# meta-pos: the POS (imported from the H2 branch, see PROVENANCE) built as the Meta edition. Same steps as
# infra/oci/Dockerfile, plus the Meta blue recolouring of the web sources in this build copy and the Meta edition flag.
# Build context: an archive of this repository's POS sources (tools/meta/deploy-meta-pos.sh).
FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install --yes --no-install-recommends python3 python3-pil && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
COPY data ./data
COPY device/firmware/fonts ./device/firmware/fonts
COPY tsconfig.json ./
COPY tools/meta/meta-pos-theme.mjs ./tools/meta/meta-pos-theme.mjs
RUN node tools/meta/meta-pos-theme.mjs apps/web/src \
 && grep -rl '/images/bitpos-logo.png' apps/web/src | xargs sed -i 's#/images/bitpos-logo.png#/images/meta/bitpos-muse-logo.png#g' \
 && sed -i 's#<meta name="viewport" content="width=device-width, initial-scale=1" />#<meta name="viewport" content="width=device-width, initial-scale=1" /><link rel="icon" href="/images/meta/icon.svg" type="image/svg+xml" /><link rel="icon" href="/images/meta/icon-32.png" sizes="32x32" /><link rel="apple-touch-icon" href="/images/meta/icon-180.png" /><meta name="theme-color" content="\#0866FF" />#' apps/web/src/pages/index.astro \
 && grep -q 'images/meta/icon.svg' apps/web/src/pages/index.astro \
 && cp apps/web/public/images/meta/icon-32.png apps/web/public/favicon.ico
ENV PUBLIC_URL=https://meta-pos.cashlessthailand.com PUBLIC_BITPOS_EDITION=meta BITPOS_EDITION=meta
RUN pnpm build
CMD ["node", "apps/web/dist/server/entry.mjs"]
