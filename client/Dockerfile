# ---- Web client ---------------------------------------------------------
# Builds the Vite app, then serves it from nginx. nginx also reverse-proxies
# API and SSE paths to the API service, so the browser talks to one origin.

FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# Upstream API base URL, substituted into the nginx template at startup
ENV API_UPSTREAM=http://app:3000
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
