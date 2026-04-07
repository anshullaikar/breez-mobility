#!/bin/sh
# API container entrypoint: apply migrations, optionally seed, start server.
set -e

npx prisma migrate deploy

if [ "$SEED_ON_START" = "true" ]; then
  node prisma/seed.js
fi

exec node src/server.js
