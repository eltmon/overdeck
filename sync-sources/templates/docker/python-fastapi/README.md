# FastAPI Docker Template

Development Docker setup for FastAPI applications with PostgreSQL and Redis.

## Features

- Python 3.12
- FastAPI with Uvicorn hot reload
- PostgreSQL 16 database
- Redis 7 cache
- Traefik integration for local HTTPS

## Quick Start

```bash
# Copy template to your project
cp -r templates/docker/python-fastapi/* /path/to/your/project/

# Create requirements.txt if not exists
cat > requirements.txt << 'EOF'
fastapi>=0.109.0
uvicorn[standard]>=0.27.0
sqlalchemy>=2.0.0
psycopg2-binary>=2.9.0
redis>=5.0.0
python-dotenv>=1.0.0
EOF

# Create main.py if not exists
cat > main.py << 'EOF'
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"Hello": "World"}

@app.get("/health")
def health():
    return {"status": "healthy"}
EOF

# Start services
docker compose up -d

# View logs
docker compose logs -f app
```

## Access Points

| Service | URL | Port |
|---------|-----|------|
| FastAPI | http://localhost:8000 | 8000 |
| API Docs | http://localhost:8000/docs | 8000 |
| PostgreSQL | localhost:5432 | 5432 |
| Redis | localhost:6379 | 6379 |

With Traefik: https://app.pan.localhost

## Environment Variables

Create a `.env` file:

```bash
APP_PORT=8000
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

1. **Start**: `docker compose up -d`
2. **Watch logs**: `docker compose logs -f app`
3. **Edit code**: Changes hot-reload via Uvicorn
4. **View API docs**: http://localhost:8000/docs
5. **Stop**: `docker compose down`

## Database Setup with SQLAlchemy

```python
# database.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import os

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
```

## Alembic Migrations

```bash
# Install alembic
docker compose exec app pip install alembic

# Initialize
docker compose exec app alembic init alembic

# Create migration
docker compose exec app alembic revision --autogenerate -m "Initial"

# Run migrations
docker compose exec app alembic upgrade head
```

## Database Access

```bash
# Connect to PostgreSQL
docker compose exec postgres psql -U postgres -d appdb

# Connect to Redis
docker compose exec redis redis-cli
```

## Adding Dependencies

```bash
# Add to requirements.txt, then rebuild
docker compose down
docker compose build --no-cache
docker compose up -d
```

## Troubleshooting

**Hot reload not working:**
- Ensure volume mount is correct
- Check uvicorn has `--reload` flag

**Database connection failed:**
- Wait for postgres healthcheck
- Check DATABASE_URL environment variable

**Import errors:**
- Rebuild: `docker compose build --no-cache`
