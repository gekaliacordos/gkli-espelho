FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation util-linux && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true WHATSAPP_CHROME=/usr/bin/chromium WHATSAPP_AUTH_PATH=/data
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY conexao.mjs ./
CMD ["flock", "--exclusive", "--nonblock", "--no-fork", "/data/espelhar-worker.lock", "node", "conexao.mjs"]
