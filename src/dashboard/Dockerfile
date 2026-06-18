# Multi-stage build for Overdeck Dashboard
FROM node:20-alpine AS base

# Install dependencies for both frontend and server
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY server/package*.json ./server/

# Install all dependencies
RUN npm ci
RUN cd frontend && npm ci
RUN cd server && npm ci

# Build the frontend
FROM base AS frontend-builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY frontend ./frontend
WORKDIR /app/frontend
RUN npm run build

# Build the server
FROM base AS server-builder
WORKDIR /app
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY server ./server
WORKDIR /app/server
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

# Install production dependencies only
COPY server/package*.json ./server/
RUN cd server && npm ci --only=production

# Copy built assets
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY --from=server-builder /app/server/dist ./server/dist

# The server serves both API and static frontend
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/dist/index.js"]
