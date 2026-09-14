FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 python3-pip ca-certificates git \
    && pip3 install --break-system-packages -U yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=optional

COPY . .
ENV NODE_ENV=production
CMD ["node", "index.js"]
