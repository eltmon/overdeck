# Spring Boot Docker Template

Development Docker setup for Spring Boot applications with PostgreSQL and Redis.

## Features

- Java 21 with Maven
- Hot reload via spring-boot-devtools
- PostgreSQL 16 database
- Redis 7 cache
- Remote debugging on port 5005
- Traefik integration for local HTTPS

## Quick Start

```bash
# Copy template to your project
cp -r templates/docker/spring-boot/* /path/to/your/project/

# Start services
docker compose up -d

# View logs
docker compose logs -f app
```

## Access Points

| Service | URL | Port |
|---------|-----|------|
| Application | http://localhost:8080 | 8080 |
| Debug | localhost:5005 | 5005 |
| PostgreSQL | localhost:5432 | 5432 |
| Redis | localhost:6379 | 6379 |

With Traefik: https://app.pan.localhost

## Environment Variables

Create a `.env` file:

```bash
# Application
APP_PORT=8080
DEBUG_PORT=5005
HOSTNAME=myapp.pan.localhost

# Database
DB_NAME=myappdb
DB_USER=postgres
DB_PASSWORD=secretpassword
DB_PORT=5432

# Redis
REDIS_PORT=6379

# Docker Compose
COMPOSE_PROJECT_NAME=myapp
```

## Development Workflow

1. **Start services**: `docker compose up -d`
2. **Watch logs**: `docker compose logs -f app`
3. **Edit code**: Changes auto-reload via spring-boot-devtools
4. **Debug**: Attach debugger to port 5005
5. **Stop**: `docker compose down`

## Database Access

```bash
# Connect to PostgreSQL
docker compose exec postgres psql -U postgres -d appdb

# View Redis
docker compose exec redis redis-cli
```

## Customization

### Add Dependencies

Edit `pom.xml` and restart:
```bash
docker compose restart app
```

### Change Java Version

Edit `Dockerfile.dev`:
```dockerfile
FROM eclipse-temurin:17-jdk  # or 11-jdk
```

### Add Services

Edit `docker-compose.yml` to add services like Elasticsearch, RabbitMQ, etc.

## Troubleshooting

**Hot reload not working:**
- Ensure `spring-boot-devtools` is in pom.xml
- Check SPRING_DEVTOOLS_RESTART_ENABLED is true

**Database connection failed:**
- Wait for postgres healthcheck to pass
- Check DB_* environment variables

**Port conflicts:**
- Change ports in .env file
- Check for other services using same ports
