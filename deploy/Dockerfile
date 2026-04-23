# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts eslint.config.js ./
COPY src/ ./src/
COPY public/ ./public/
ENV BASE_PATH=/openai-privacy-demo/
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
LABEL org.opencontainers.image.source="https://github.com/montevive/openai-privacy-filter"
LABEL org.opencontainers.image.description="Montevive Labs — OpenAI Privacy Filter browser demo + landing page"
LABEL org.opencontainers.image.licenses="Apache-2.0"

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 deploy/landing/ /usr/share/nginx/html/
COPY --from=build --chown=101:101 /src/dist/ /usr/share/nginx/html/openai-privacy-demo/

EXPOSE 8080
