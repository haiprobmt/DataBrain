# DataBrain — single container: Next.js server + migration on start.
# Not built or run in the authoring environment (no Docker daemon there); see README "Not verified".
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
RUN mkdir -p .data/storage && chown -R node:node /app
USER node
EXPOSE 3000
# Applies pending migrations, then serves. Seed the demo workspace once with: npm run db:seed
CMD ["sh", "-c", "npm run db:migrate && npm run start"]
