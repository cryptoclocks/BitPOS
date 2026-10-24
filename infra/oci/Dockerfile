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
ENV PUBLIC_URL=https://pos.cashlessthailand.com
RUN pnpm build
CMD ["node", "apps/web/dist/server/entry.mjs"]
