# ---- Simulation ---------------------------------------------------------
# Load generator that drives drivers and rides through the API. No npm
# dependencies (uses global fetch), so it only needs the Node runtime.

FROM node:20-slim
WORKDIR /app
COPY run.js ./
USER node
CMD ["node", "run.js"]
