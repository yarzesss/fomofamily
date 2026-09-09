# fomo family — Railway builds this instead of Railpack (avoids the node_modules/.vite EBUSY bug)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --include=dev --legacy-peer-deps --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --legacy-peer-deps
EXPOSE 3000
CMD ["node", "server/index.js"]
