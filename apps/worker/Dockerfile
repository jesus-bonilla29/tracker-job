# Contexto de build: raíz del repositorio (ver docker-compose.yml)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/
RUN npm ci --workspace apps/worker
COPY apps/worker apps/worker
RUN npm run build --workspace apps/worker

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/
RUN npm ci --workspace apps/worker --omit=dev
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY db db
COPY data data
USER node
CMD ["node", "apps/worker/dist/index.js"]
