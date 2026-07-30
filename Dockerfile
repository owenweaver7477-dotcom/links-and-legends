# Links & Legends — a plain long-running Node process.
# Socket.IO needs real WebSockets, so this will NOT work on serverless/edge.
FROM node:20-alpine

WORKDIR /app

# install deps first so layer caching survives source edits
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# the server already binds 0.0.0.0 and honours $PORT
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["node", "server.js"]
