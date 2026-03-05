# Deployment Guide

This guide covers deploying UniFlow OA Copilot to production.

## Prerequisites

- Docker & Docker Compose
- PostgreSQL 16
- Redis 7
- MinIO or S3-compatible storage
- Node.js 20+ (for non-Docker deployment)
- Domain name with SSL certificate

## Deployment Options

### Option 1: Docker Compose (Recommended)

1. **Clone the repository**:
```bash
git clone https://github.com/your-org/uniflow-oa.git
cd uniflow-oa/OA_agent
```

2. **Configure environment**:
```bash
cp .env.example .env
# Edit .env with production values
```

3. **Update docker-compose.yml for production**:
```yaml
# Use production images
# Enable restart policies
# Configure resource limits
# Set up volumes for persistence
```

4. **Start services**:
```bash
docker compose up -d
```

5. **Run migrations**:
```bash
docker compose exec api pnpm prisma migrate deploy
```

6. **Verify deployment**:
```bash
curl http://localhost:3001/health
```

### Option 2: Kubernetes

See `k8s/` directory for Kubernetes manifests (to be added).

### Option 3: Manual Deployment

1. **Set up PostgreSQL**:
```bash
# Create database
createdb uniflow_oa
# Run migrations
cd apps/api && pnpm prisma migrate deploy
```

2. **Set up Redis**:
```bash
# Start Redis
redis-server
```

3. **Build applications**:
```bash
pnpm install
pnpm build
```

4. **Start services**:
```bash
# API
cd apps/api && pnpm start

# Worker
cd apps/worker && pnpm start

# Web
cd apps/web && pnpm start
```

## Environment Configuration

### Required Environment Variables

```bash
# Database
DATABASE_URL="postgresql://user:password@host:5432/uniflow_oa"

# Redis
REDIS_HOST=redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# MinIO/S3
MINIO_ENDPOINT=minio-host
MINIO_PORT=9000
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key
MINIO_BUCKET=uniflow-attachments

# API
API_PORT=3001
API_HOST=0.0.0.0
NODE_ENV=production

# JWT
JWT_SECRET=your-very-long-random-secret-key

# LLM (for agents)
OPENAI_API_KEY=your-openai-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4-turbo-preview

# Tenant
DEFAULT_TENANT_ID=your-tenant-id
```

## Security Checklist

- [ ] Change all default passwords
- [ ] Use strong JWT secret
- [ ] Enable HTTPS/TLS
- [ ] Configure CORS properly
- [ ] Set up firewall rules
- [ ] Enable rate limiting
- [ ] Configure backup strategy
- [ ] Set up monitoring and alerting
- [ ] Review and restrict database permissions
- [ ] Enable audit logging
- [ ] Implement secrets management
- [ ] Set up SSL certificates

## Performance Tuning

### Database

```sql
-- Increase connection pool
ALTER SYSTEM SET max_connections = 200;

-- Enable query optimization
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
```

### Redis

```conf
# redis.conf
maxmemory 512mb
maxmemory-policy allkeys-lru
```

### Application

```bash
# Increase Node.js memory
NODE_OPTIONS="--max-old-space-size=4096"

# Worker concurrency
WORKER_CONCURRENCY=10
```

## Monitoring

### Health Checks

- API: `GET /health`
- Database: Check connection pool
- Redis: `redis-cli ping`
- Queue: Monitor BullMQ dashboard

### Metrics to Monitor

- API response time (p50, p95, p99)
- Queue processing time
- Database query performance
- Error rates
- Memory usage
- CPU usage
- Disk I/O

### Recommended Tools

- **Monitoring**: Prometheus + Grafana
- **Logging**: ELK Stack or Loki
- **Error Tracking**: Sentry
- **APM**: New Relic or Datadog

## Backup Strategy

### Database Backup

```bash
# Daily backup
pg_dump uniflow_oa > backup_$(date +%Y%m%d).sql

# Automated backup script
0 2 * * * /usr/local/bin/backup-db.sh
```

### File Storage Backup

```bash
# Backup MinIO data
mc mirror minio/uniflow-attachments /backup/minio/
```

## Scaling

### Horizontal Scaling

1. **API Servers**: Run multiple API instances behind a load balancer
2. **Workers**: Scale worker instances based on queue depth
3. **Database**: Use read replicas for read-heavy workloads
4. **Redis**: Use Redis Cluster for high availability

### Load Balancer Configuration

```nginx
upstream api_backend {
    least_conn;
    server api1:3001;
    server api2:3001;
    server api3:3001;
}

server {
    listen 80;
    server_name api.uniflow.example.com;

    location / {
        proxy_pass http://api_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Troubleshooting

### Common Issues

1. **Database connection errors**:
   - Check DATABASE_URL
   - Verify database is running
   - Check connection pool settings

2. **Queue not processing**:
   - Check Redis connection
   - Verify worker is running
   - Check worker logs

3. **High memory usage**:
   - Check for memory leaks
   - Increase Node.js memory limit
   - Scale horizontally

4. **Slow API responses**:
   - Check database query performance
   - Add database indexes
   - Enable caching
   - Scale API servers

### Logs

```bash
# API logs
docker compose logs -f api

# Worker logs
docker compose logs -f worker

# Database logs
docker compose logs -f postgres
```

## Rollback Procedure

1. **Stop new deployment**:
```bash
docker compose down
```

2. **Restore database backup**:
```bash
psql uniflow_oa < backup_YYYYMMDD.sql
```

3. **Deploy previous version**:
```bash
git checkout <previous-tag>
docker compose up -d
```

4. **Verify rollback**:
```bash
curl http://localhost:3001/health
```

## Maintenance

### Regular Tasks

- [ ] Weekly: Review logs for errors
- [ ] Weekly: Check disk space
- [ ] Monthly: Update dependencies
- [ ] Monthly: Review security advisories
- [ ] Quarterly: Performance review
- [ ] Quarterly: Backup restoration test

### Updates

```bash
# Pull latest changes
git pull origin main

# Update dependencies
pnpm install

# Run migrations
pnpm db:migrate

# Rebuild and restart
docker compose up -d --build
```

## Support

For deployment issues:
- GitHub Issues: https://github.com/your-org/uniflow-oa/issues
- Email: support@uniflow.example.com
- Documentation: See `/docs` folder
