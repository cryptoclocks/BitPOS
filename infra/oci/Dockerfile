FROM node:24-bookworm-slim
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
COPY data ./data
COPY tsconfig.json ./
ENV PUBLIC_URL=https://pos.cashlessthailand.com
RUN pnpm build
CMD ["node", "apps/web/dist/server/entry.mjs"]
