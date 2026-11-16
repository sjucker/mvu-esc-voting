FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public

ENV PORT=3000
EXPOSE 3000

# node as PID 1 so SIGINT/SIGTERM reach the server and pending data is flushed
CMD ["node", "server.js"]
