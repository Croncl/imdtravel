FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# /data pertence ao usuário node: o volume nomeado herda essa permissão ao ser criado
RUN mkdir -p /data && chown node:node /data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "dist/main.js"]
