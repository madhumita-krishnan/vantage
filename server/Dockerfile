FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server.js package.json ./
COPY lib ./lib
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data /app
USER node
ENV DATA_DIR=/data PORT=8787 HOST=0.0.0.0
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "server.js"]
