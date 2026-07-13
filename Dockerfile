# Point.47 LMS — Backend (production image)
FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies only (leverages layer caching).
COPY package*.json ./
RUN npm ci --omit=dev

# App source
COPY src ./src

# Run as non-root.
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 5000

# Container healthcheck hits the public liveness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health/live',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]
