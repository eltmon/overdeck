# Next.js Docker Template

Development Docker setup for Next.js applications with App Router.

## Features

- Node.js 20 Alpine
- Next.js dev server with Fast Refresh
- Hot reload via polling (Docker-compatible)
- Traefik integration for local HTTPS

## Quick Start

```bash
# Copy template to your project
cp -r templates/docker/nextjs/* /path/to/your/project/

# Start services
docker compose up -d

# View logs
docker compose logs -f app
```

## Access Points

| Service | URL | Port |
|---------|-----|------|
| Next.js Dev | http://localhost:3000 | 3000 |

With Traefik: https://app.pan.localhost

## Environment Variables

Create a `.env` file:

```bash
APP_PORT=3000
HOSTNAME=myapp.pan.localhost
COMPOSE_PROJECT_NAME=myapp

# Next.js env vars
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Next.js Configuration

For optimal Docker development, update `next.config.js`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable polling for Docker
  webpack: (config) => {
    config.watchOptions = {
      poll: 1000,
      aggregateTimeout: 300,
    }
    return config
  },
}

module.exports = nextConfig
```

## Development Workflow

1. **Start**: `docker compose up -d`
2. **Watch logs**: `docker compose logs -f app`
3. **Edit code**: Changes hot-reload via Fast Refresh
4. **Stop**: `docker compose down`

## App Router vs Pages Router

This template works with both:
- **App Router**: `app/` directory (Next.js 13+)
- **Pages Router**: `pages/` directory (legacy)

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

**Hot reload not working:**
- Ensure `WATCHPACK_POLLING=true` is set
- Check next.config.js has webpack polling config

**Build errors persisting:**
- Clear .next cache: `docker compose exec app rm -rf .next`
- Restart: `docker compose restart app`

**.next volume issues:**
- Remove volumes: `docker compose down -v`
- Rebuild: `docker compose up -d --build`
