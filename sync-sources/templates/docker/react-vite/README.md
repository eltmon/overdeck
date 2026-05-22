# React + Vite Docker Template

Development Docker setup for React applications using Vite.

## Features

- Node.js 20 Alpine
- Vite dev server with HMR
- Hot reload via polling (Docker-compatible)
- Traefik integration for local HTTPS

## Quick Start

```bash
# Copy template to your project
cp -r templates/docker/react-vite/* /path/to/your/project/

# Start services
docker compose up -d

# View logs
docker compose logs -f app
```

## Access Points

| Service | URL | Port |
|---------|-----|------|
| Vite Dev Server | http://localhost:5173 | 5173 |

With Traefik: https://app.pan.localhost

## Environment Variables

Create a `.env` file:

```bash
APP_PORT=5173
HOSTNAME=myapp.pan.localhost
COMPOSE_PROJECT_NAME=myapp

# Pass to Vite
VITE_API_URL=http://localhost:3001
```

## Vite Configuration

For optimal Docker HMR, update `vite.config.ts`:

```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
})
```

## Development Workflow

1. **Start**: `docker compose up -d`
2. **Watch logs**: `docker compose logs -f app`
3. **Edit code**: Changes hot-reload instantly
4. **Stop**: `docker compose down`

## Adding Dependencies

```bash
# Install inside container
docker compose exec app npm install <package>

# Or rebuild
docker compose down
docker compose build --no-cache
docker compose up -d
```

## Troubleshooting

**HMR not working:**
- Ensure `CHOKIDAR_USEPOLLING=true` is set
- Check vite.config.ts has `usePolling: true`

**Port conflict:**
- Change APP_PORT in .env

**Node modules issues:**
- Remove node_modules volume: `docker compose down -v`
- Rebuild: `docker compose build --no-cache`
