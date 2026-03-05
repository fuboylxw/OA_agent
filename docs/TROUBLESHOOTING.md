# Troubleshooting Guide

## Common Issues and Solutions

### Installation Issues

#### Issue: `pnpm install` fails

**Symptoms**:
```
ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/...
```

**Solutions**:
1. Check internet connection
2. Clear pnpm cache: `pnpm store prune`
3. Try with different registry: `pnpm config set registry https://registry.npmmirror.com`
4. Delete `node_modules` and `pnpm-lock.yaml`, then reinstall

#### Issue: Prisma client generation fails

**Symptoms**:
```
Error: @prisma/client did not initialize yet
```

**Solutions**:
```bash
cd apps/api
pnpm prisma generate
```

### Database Issues

#### Issue: Cannot connect to PostgreSQL

**Symptoms**:
```
Error: P1001: Can't reach database server
```

**Solutions**:
1. Check if PostgreSQL is running:
   ```bash
   docker compose ps postgres
   ```

2. Verify DATABASE_URL in `.env`:
   ```bash
   DATABASE_URL="postgresql://uniflow:uniflow123@localhost:5432/uniflow_oa"
   ```

3. Check PostgreSQL logs:
   ```bash
   docker compose logs postgres
   ```

4. Restart PostgreSQL:
   ```bash
   docker compose restart postgres
   ```

#### Issue: Migration fails

**Symptoms**:
```
Error: P3009: migrate found failed migrations
```

**Solutions**:
1. Check migration status:
   ```bash
   cd apps/api
   pnpm prisma migrate status
   ```

2. Reset database (WARNING: deletes all data):
   ```bash
   pnpm prisma migrate reset
   ```

3. Or manually fix failed migration:
   ```bash
   pnpm prisma migrate resolve --applied <migration-name>
   ```

### Redis Issues

#### Issue: Cannot connect to Redis

**Symptoms**:
```
Error: Redis connection to localhost:6379 failed
```

**Solutions**:
1. Check if Redis is running:
   ```bash
   docker compose ps redis
   ```

2. Test Redis connection:
   ```bash
   redis-cli ping
   # Should return: PONG
   ```

3. Check Redis logs:
   ```bash
   docker compose logs redis
   ```

4. Restart Redis:
   ```bash
   docker compose restart redis
   ```

### Queue Issues

#### Issue: Jobs not processing

**Symptoms**:
- Bootstrap jobs stuck in CREATED status
- Submissions stuck in pending status

**Solutions**:
1. Check if worker is running:
   ```bash
   docker compose ps worker
   # Or for dev:
   ps aux | grep worker
   ```

2. Check worker logs:
   ```bash
   docker compose logs worker
   ```

3. Check Redis queue:
   ```bash
   redis-cli
   > KEYS bull:*
   > LLEN bull:bootstrap:waiting
   ```

4. Restart worker:
   ```bash
   docker compose restart worker
   ```

5. Clear stuck jobs (if needed):
   ```bash
   redis-cli
   > DEL bull:bootstrap:waiting
   > DEL bull:bootstrap:active
   ```

### API Issues

#### Issue: API returns 500 errors

**Symptoms**:
```json
{
  "statusCode": 500,
  "message": "Internal server error"
}
```

**Solutions**:
1. Check API logs:
   ```bash
   docker compose logs api
   ```

2. Check for unhandled exceptions
3. Verify all environment variables are set
4. Check database connection
5. Restart API:
   ```bash
   docker compose restart api
   ```

#### Issue: CORS errors in browser

**Symptoms**:
```
Access to XMLHttpRequest blocked by CORS policy
```

**Solutions**:
1. Check API CORS configuration in `main.ts`:
   ```typescript
   app.enableCors({
     origin: 'http://localhost:3000',
     credentials: true,
   });
   ```

2. Verify NEXT_PUBLIC_API_URL in web app:
   ```bash
   echo $NEXT_PUBLIC_API_URL
   ```

#### Issue: 404 Not Found for API endpoints

**Symptoms**:
```
GET /api/v1/bootstrap/jobs 404
```

**Solutions**:
1. Check API is running on correct port (3001)
2. Verify global prefix in `main.ts`: `app.setGlobalPrefix('api/v1')`
3. Check route registration in modules
4. Restart API server

### Frontend Issues

#### Issue: Next.js build fails

**Symptoms**:
```
Error: Failed to compile
```

**Solutions**:
1. Check for TypeScript errors:
   ```bash
   cd apps/web
   pnpm tsc --noEmit
   ```

2. Clear Next.js cache:
   ```bash
   rm -rf .next
   pnpm build
   ```

3. Check for missing dependencies:
   ```bash
   pnpm install
   ```

#### Issue: Frontend cannot connect to API

**Symptoms**:
- Network errors in browser console
- API calls timeout

**Solutions**:
1. Verify API is running:
   ```bash
   curl http://localhost:3001/health
   ```

2. Check NEXT_PUBLIC_API_URL:
   ```bash
   # In .env or .env.local
   NEXT_PUBLIC_API_URL=http://localhost:3001
   ```

3. Check browser network tab for actual URL being called

4. Restart web server:
   ```bash
   cd apps/web
   pnpm dev
   ```

### Bootstrap Issues

#### Issue: Bootstrap job fails at DISCOVERING

**Symptoms**:
- Job status changes to FAILED
- Error in logs about OA discovery

**Solutions**:
1. Check OA URL is accessible:
   ```bash
   curl -I http://your-oa-url.com
   ```

2. Verify OpenAPI spec is valid JSON:
   ```bash
   curl http://your-oa-url.com/openapi.json | jq .
   ```

3. Check discovery agent logs
4. Try with a different OA fixture

#### Issue: Bootstrap job stuck in REVIEW

**Symptoms**:
- Job reaches REVIEW but doesn't progress

**Solutions**:
1. This is expected - REVIEW requires manual approval
2. Review the OCL report:
   ```bash
   curl http://localhost:3001/api/v1/bootstrap/jobs/{id}/report
   ```

3. Publish manually:
   ```bash
   curl -X POST http://localhost:3001/api/v1/bootstrap/jobs/{id}/publish
   ```

### Permission Issues

#### Issue: Permission denied errors

**Symptoms**:
```json
{
  "allowed": false,
  "reason": "用户没有权限"
}
```

**Solutions**:
1. Check user roles in database:
   ```sql
   SELECT * FROM users WHERE id = 'user-id';
   ```

2. Check permission policies:
   ```sql
   SELECT * FROM permission_policies WHERE process_code = 'xxx';
   ```

3. Review permission check logs in audit_logs table

4. Add user to appropriate role:
   ```sql
   UPDATE users SET roles = ARRAY['admin', 'user'] WHERE id = 'user-id';
   ```

### Chat Assistant Issues

#### Issue: Intent not detected correctly

**Symptoms**:
- Chat returns "我没有理解您的意图"
- Wrong intent detected

**Solutions**:
1. Check intent agent keywords in `intent.agent.ts`
2. Add more keywords for your use case
3. Increase confidence threshold
4. Check chat message logs

#### Issue: Form fields not extracted

**Symptoms**:
- Chat keeps asking for already provided information
- Fields not populated in draft

**Solutions**:
1. Check form agent extraction patterns in `form.agent.ts`
2. Verify field types match (number, date, text)
3. Check session metadata in database:
   ```sql
   SELECT metadata FROM chat_sessions WHERE id = 'session-id';
   ```

### Submission Issues

#### Issue: Idempotency key conflict

**Symptoms**:
```
Error: Unique constraint failed on idempotencyKey
```

**Solutions**:
1. This is expected behavior - submission already exists
2. Use a different idempotency key
3. Or retrieve existing submission:
   ```sql
   SELECT * FROM submissions WHERE idempotency_key = 'your-key';
   ```

#### Issue: Rule validation fails

**Symptoms**:
```json
{
  "valid": false,
  "errors": [
    {
      "message": "金额必须大于0",
      "level": "error"
    }
  ]
}
```

**Solutions**:
1. Check form data meets rule requirements
2. Review rule expressions in process template
3. Fix form data and resubmit
4. Or update rule if it's incorrect

### Docker Issues

#### Issue: Docker Compose fails to start

**Symptoms**:
```
ERROR: Service 'postgres' failed to build
```

**Solutions**:
1. Check Docker is running:
   ```bash
   docker info
   ```

2. Check disk space:
   ```bash
   df -h
   ```

3. Clean up Docker:
   ```bash
   docker system prune -a
   ```

4. Rebuild images:
   ```bash
   docker compose build --no-cache
   ```

#### Issue: Port already in use

**Symptoms**:
```
Error: bind: address already in use
```

**Solutions**:
1. Find process using the port:
   ```bash
   lsof -i :3001
   # Or on Windows:
   netstat -ano | findstr :3001
   ```

2. Kill the process:
   ```bash
   kill -9 <PID>
   ```

3. Or change port in `.env`:
   ```bash
   API_PORT=3002
   ```

### Performance Issues

#### Issue: Slow API responses

**Symptoms**:
- API calls take > 5 seconds
- Timeouts

**Solutions**:
1. Check database query performance:
   ```sql
   EXPLAIN ANALYZE SELECT * FROM submissions WHERE tenant_id = 'xxx';
   ```

2. Add missing indexes:
   ```sql
   CREATE INDEX idx_submissions_tenant_user ON submissions(tenant_id, user_id);
   ```

3. Enable query logging in Prisma:
   ```typescript
   const prisma = new PrismaClient({
     log: ['query', 'info', 'warn', 'error'],
   });
   ```

4. Check Redis cache hit rate
5. Scale horizontally (add more API instances)

#### Issue: High memory usage

**Symptoms**:
- Node.js process using > 2GB RAM
- Out of memory errors

**Solutions**:
1. Increase Node.js memory limit:
   ```bash
   NODE_OPTIONS="--max-old-space-size=4096"
   ```

2. Check for memory leaks:
   ```bash
   node --inspect apps/api/dist/main.js
   ```

3. Use Chrome DevTools to profile memory

4. Restart services periodically

### Testing Issues

#### Issue: Tests fail with database errors

**Symptoms**:
```
Error: Database 'uniflow_oa_test' does not exist
```

**Solutions**:
1. Create test database:
   ```bash
   createdb uniflow_oa_test
   ```

2. Run test migrations:
   ```bash
   DATABASE_URL="postgresql://...uniflow_oa_test" pnpm prisma migrate deploy
   ```

3. Use separate test database in CI/CD

#### Issue: E2E tests timeout

**Symptoms**:
```
Timeout - Async callback was not invoked within the 30000 ms timeout
```

**Solutions**:
1. Increase test timeout in jest config:
   ```javascript
   testTimeout: 60000
   ```

2. Check if services are running
3. Add more wait time for async operations
4. Use proper test fixtures

## Debug Mode

Enable debug logging:

```bash
# API
DEBUG=* pnpm dev

# Prisma
DEBUG="prisma:*" pnpm dev

# BullMQ
DEBUG="bull:*" pnpm dev
```

## Getting Help

If you're still stuck:

1. Check GitHub Issues: https://github.com/your-org/uniflow-oa/issues
2. Search existing issues first
3. Create new issue with:
   - Clear description
   - Steps to reproduce
   - Error messages
   - Environment details (OS, Node version, etc.)
   - Logs

4. Email support: support@uniflow.example.com

## Useful Commands

```bash
# Check all services status
docker compose ps

# View logs for all services
docker compose logs -f

# View logs for specific service
docker compose logs -f api

# Restart all services
docker compose restart

# Stop all services
docker compose down

# Remove all data (WARNING: destructive)
docker compose down -v

# Check database
psql -U uniflow -d uniflow_oa -c "SELECT COUNT(*) FROM submissions;"

# Check Redis
redis-cli INFO stats

# Check disk space
df -h

# Check memory
free -h

# Check processes
ps aux | grep node
```
