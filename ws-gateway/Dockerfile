FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json /app/package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js /app/server.js

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --retries=10 --start-period=10s \
  CMD curl -fsS http://localhost:8080/health || exit 1

CMD ["node", "server.js"]
