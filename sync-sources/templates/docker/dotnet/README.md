# .NET Core Docker Template

Development Docker setup for ASP.NET Core applications with SQL Server.

## Features

- .NET 8.0 SDK
- Hot reload via `dotnet watch`
- SQL Server 2022
- Traefik integration for local HTTPS

## Quick Start

```bash
# Copy template to your project
cp -r templates/docker/dotnet/* /path/to/your/project/

# Start services
docker compose up -d

# View logs
docker compose logs -f app
```

## Access Points

| Service | URL | Port |
|---------|-----|------|
| ASP.NET App | http://localhost:5000 | 5000 |
| SQL Server | localhost:1433 | 1433 |

With Traefik: https://app.pan.localhost

## Environment Variables

Create a `.env` file:

```bash
APP_PORT=5000
HTTPS_PORT=5001
HOSTNAME=myapp.pan.localhost
COMPOSE_PROJECT_NAME=myapp

# Database
DB_NAME=myappdb
DB_PASSWORD=YourStrong@Passw0rd
DB_PORT=1433
```

## Connection String

The app is configured with this connection string:
```
Server=sqlserver;Database=${DB_NAME};User Id=sa;Password=${DB_PASSWORD};TrustServerCertificate=true
```

In your `appsettings.Development.json`:
```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=sqlserver;Database=appdb;User Id=sa;Password=YourStrong@Passw0rd;TrustServerCertificate=true"
  }
}
```

## Development Workflow

1. **Start**: `docker compose up -d`
2. **Watch logs**: `docker compose logs -f app`
3. **Edit code**: Changes hot-reload via `dotnet watch`
4. **Stop**: `docker compose down`

## Entity Framework Migrations

```bash
# Run migrations
docker compose exec app dotnet ef database update

# Create migration
docker compose exec app dotnet ef migrations add MigrationName

# Remove last migration
docker compose exec app dotnet ef migrations remove
```

## SQL Server Access

```bash
# Connect via sqlcmd
docker compose exec sqlserver /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P 'YourStrong@Passw0rd'

# Or use Azure Data Studio / SSMS with:
# Server: localhost,1433
# User: sa
# Password: YourStrong@Passw0rd
```

## Troubleshooting

**Hot reload not working:**
- Ensure `DOTNET_USE_POLLING_FILE_WATCHER=true` is set
- Restart: `docker compose restart app`

**SQL Server connection failed:**
- Wait for healthcheck (can take 30-60s first time)
- Verify password meets SQL Server requirements

**Password requirements:**
SQL Server requires passwords with:
- Minimum 8 characters
- Uppercase, lowercase, numbers, and special characters
