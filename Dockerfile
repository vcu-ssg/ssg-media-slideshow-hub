# ------------------------------------------------------------
# 📸 Photo Kiosk Player — Node 22 LTS (Debian Slim)
# ------------------------------------------------------------
FROM node:22-slim

# ------------------------------------------------------------
# 🏗️ Create working directory
# ------------------------------------------------------------
WORKDIR /app

# ------------------------------------------------------------
# 📦 Copy package manifests first (for cached install)
# ------------------------------------------------------------
COPY package*.json ./

# ------------------------------------------------------------
# ⚙️ Install runtime dependencies
# ------------------------------------------------------------
RUN npm ci --omit=dev && \
    npm install --no-save express morgan js-yaml glob dotenv sharp minimatch googleapis node-fetch

# ------------------------------------------------------------
# 📂 Copy remaining project files
# ------------------------------------------------------------
# Copy everything including src/ and static folders
COPY . .

# Ensure common folders exist (prevents missing-volume errors)
RUN mkdir -p /app/photos /app/public /app/pages /app/logs /app/cache

# ------------------------------------------------------------
# 🌍 Environment defaults
# ------------------------------------------------------------
ENV NODE_ENV=production \
    PORT=3000

# ------------------------------------------------------------
# 🚀 Expose port & start kiosk
# ------------------------------------------------------------
EXPOSE 3000
CMD ["node", "src/server.js"]
