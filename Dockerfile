FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production EASYFILE_TRANSPORT=http EASYFILE_HOST=0.0.0.0 EASYFILE_PORT=3000 EASYFILE_DATA_DIR=/data
WORKDIR /app
RUN addgroup -S easyfile && adduser -S easyfile -G easyfile && mkdir /data && chown easyfile:easyfile /data
COPY --from=build --chown=easyfile:easyfile /app/package*.json ./
COPY --from=build --chown=easyfile:easyfile /app/node_modules ./node_modules
COPY --from=build --chown=easyfile:easyfile /app/dist ./dist
USER easyfile
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/index.js", "--transport=http"]
