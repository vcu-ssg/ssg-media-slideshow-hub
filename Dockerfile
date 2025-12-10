# ------------------------------------------------------------
# 📸 Photo Kiosk Player — Node 22 LTS (Debian Slim)
# ------------------------------------------------------------
FROM node:22-slim

WORKDIR /app

# ------------------------------------------------------------
# Copy package manifests first for caching
# ------------------------------------------------------------
COPY package*.json ./

# Production deps only
RUN npm ci --omit=dev

# ------------------------------------------------------------
# Copy full project into image
# ------------------------------------------------------------
COPY . .

# Ensure runtime folders exist
RUN mkdir -p \
      /app/media \
      /app/runtime/logs \
      /app/runtime/cache \
      /app/public \
      /app/pages

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Your correct backend entry point:
CMD ["node", "src/backend/server.js"]
