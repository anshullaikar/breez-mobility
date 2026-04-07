# ---- API service --------------------------------------------------------
# Express API + Prisma. Runs migrations on start, optionally seeds.

FROM node:20-slim AS base
# Prisma's query engine needs OpenSSL
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma/
RUN npx prisma generate

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma/
COPY src ./src/
COPY public ./public/
COPY scripts ./scripts/
RUN chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "scripts/start.sh"]
