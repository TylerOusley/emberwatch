FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public
COPY shared ./shared

# Railway supplies PORT at runtime. Configure DATA_DIR=/data and attach
# a persistent volume at /data in the Railway service settings.
EXPOSE 3000
CMD ["node", "server/index.js"]
