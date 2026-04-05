FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY prisma ./prisma/
RUN npx prisma generate

COPY . .

CMD sh -c "npx prisma db push --skip-generate && node prisma/seed.js && node src/server.js"
