# Monorepo Docker Template

Development Docker setup for full-stack applications with separate frontend and backend.

## Structure

```
project/
├── frontend/          # React/Vite frontend
│   ├── package.json
│   └── src/
├── backend/           # Node.js/Express backend
│   ├── package.json
│   └── src/
├── docker-compose.yml
├── Dockerfile.frontend
├── Dockerfile.backend
└── .env
```

## Features

- Frontend: React + Vite with HMR
- Backend: Node.js with hot reload
- PostgreSQL 16 database
- Redis 7 cache
- Traefik integration for local HTTPS

## Quick Start

```bash
# Copy template
cp -r templates/docker/monorepo/* /path/to/your/project/

# Initialize frontend (if new)
mkdir -p frontend && cd frontend
npm create vite@latest . -- --template react-ts
cd ..

# Initialize backend (if new)
mkdir -p backend && cd backend
npm init -y
npm install express cors dotenv
cd ..

# Start services
docker compose up -d

# View logs
docker compose logs -f
```

## Access Points

| Service | URL | Port |
|---------|-----|------|
| Frontend | http://localhost:5173 | 5173 |
| Backend API | http://localhost:3001 | 3001 |
| PostgreSQL | localhost:5432 | 5432 |
| Redis | localhost:6379 | 6379 |

With Traefik:
- Frontend: https://app.pan.localhost
- Backend: https://api.app.pan.localhost

## Environment Variables

Create a `.env` file:

```bash
# Ports
FRONTEND_PORT=5173
BACKEND_PORT=3001

# Traefik
HOSTNAME=myapp.pan.localhost
COMPOSE_PROJECT_NAME=myapp

# Database
DB_NAME=myappdb
DB_USER=postgres
DB_PASSWORD=secretpassword
DB_PORT=5432

# Redis
REDIS_PORT=6379
```

## Development Workflow

### Start Everything

```bash
docker compose up -d
```

### Watch Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f frontend
docker compose logs -f backend
```

### Frontend Development

```bash
# Install new package
docker compose exec frontend npm install <package>

# Run tests
docker compose exec frontend npm test
```

### Backend Development

```bash
# Install new package
docker compose exec backend npm install <package>

# Run tests
docker compose exec backend npm test

# Access database
docker compose exec postgres psql -U postgres -d appdb
```

## API Communication

### Frontend → Backend

In frontend `vite.config.ts`:

```typescript
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://backend:3001',
        changeOrigin: true,
      },
    },
  },
})
```

Or use environment variable:
```typescript
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
```

### Backend CORS

In backend:
```javascript
const cors = require('cors')
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173'
}))
```

## Database Migrations

If using Prisma (backend):

```bash
docker compose exec backend npx prisma migrate dev
docker compose exec backend npx prisma generate
```

If using Knex:

```bash
docker compose exec backend npx knex migrate:latest
```

## Troubleshooting

**Frontend can't reach backend:**
- Check VITE_API_URL is correct
- Ensure backend CORS allows frontend origin
- Verify both services are on same Docker network

**Hot reload not working:**
- Check CHOKIDAR_USEPOLLING=true for frontend
- Ensure nodemon/ts-node-dev for backend
- Verify volume mounts are correct

**Database connection failed:**
- Wait for postgres healthcheck
- Check DATABASE_URL format
- Verify credentials match

## Alternative Backend Frameworks

This template uses Node.js, but you can swap the backend:

**Python/FastAPI:**
Replace `Dockerfile.backend` with the python-fastapi template.

**Java/Spring:**
Replace `Dockerfile.backend` with the spring-boot template.

**.NET:**
Replace `Dockerfile.backend` with the dotnet template.
