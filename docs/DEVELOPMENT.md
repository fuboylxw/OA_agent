# Development Guide

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm >= 8
- Docker & Docker Compose
- Git
- PostgreSQL 16 (optional, can use Docker)
- Redis 7 (optional, can use Docker)

### Initial Setup

1. **Clone the repository**:
```bash
git clone https://github.com/your-org/uniflow-oa.git
cd uniflow-oa/OA_agent
```

2. **Install dependencies**:
```bash
pnpm install
```

3. **Set up environment**:
```bash
cp .env.example .env
# Edit .env with your local settings
```

4. **Start infrastructure**:
```bash
docker compose up -d postgres redis minio
```

5. **Run database migrations**:
```bash
cd apps/api
pnpm prisma migrate dev
```

6. **Seed database**:
```bash
pnpm prisma db seed
```

7. **Generate Prisma client**:
```bash
pnpm prisma generate
```

8. **Build packages**:
```bash
cd ../..
pnpm build
```

9. **Start development servers**:
```bash
pnpm dev
```

This will start:
- API server on http://localhost:3001
- Worker process
- Web app on http://localhost:3000

## Project Structure

```
OA_agent/
├── apps/
│   ├── api/              # NestJS API server
│   │   ├── src/
│   │   │   ├── modules/  # Feature modules
│   │   │   ├── processors/ # Queue processors
│   │   │   ├── main.ts   # Entry point
│   │   │   └── app.module.ts
│   │   ├── test/         # E2E tests
│   │   └── prisma/       # Database schema
│   ├── worker/           # BullMQ worker
│   └── web/              # Next.js frontend
├── packages/
│   ├── shared-types/     # Shared TypeScript types
│   ├── shared-schema/    # Zod validation schemas
│   ├── agent-kernel/     # Agent framework
│   ├── oa-adapters/      # OA system adapters
│   └── compat-engine/    # OCL/FAL calculators
├── fixtures/             # Test fixtures
├── scripts/              # Utility scripts
└── docs/                 # Documentation
```

## Development Workflow

### Creating a New Feature

1. **Create a feature branch**:
```bash
git checkout -b feature/your-feature-name
```

2. **Implement the feature**:
   - Add module in `apps/api/src/modules/`
   - Add tests
   - Update documentation

3. **Run tests**:
```bash
pnpm test
```

4. **Commit changes**:
```bash
git add .
git commit -m "feat: add your feature"
```

5. **Push and create PR**:
```bash
git push origin feature/your-feature-name
```

### Adding a New Module

1. **Generate NestJS module**:
```bash
cd apps/api
nest g module modules/your-module
nest g controller modules/your-module
nest g service modules/your-module
```

2. **Add to app.module.ts**:
```typescript
import { YourModule } from './modules/your-module/your-module.module';

@Module({
  imports: [
    // ...
    YourModule,
  ],
})
export class AppModule {}
```

3. **Add tests**:
```bash
# Create test file
touch src/modules/your-module/your-module.service.spec.ts
```

### Adding a New Agent

1. **Create agent file**:
```bash
touch apps/api/src/modules/assistant/agents/your-agent.ts
```

2. **Implement agent**:
```typescript
import { Injectable } from '@nestjs/common';
import { BaseAgent } from '@uniflow/agent-kernel';

@Injectable()
export class YourAgent extends BaseAgent<InputType, OutputType> {
  constructor() {
    super({
      name: 'your-agent',
      description: 'Agent description',
      inputSchema: YourInputSchema,
      outputSchema: YourOutputSchema,
    });
  }

  protected async run(input: InputType, context: AgentContext): Promise<OutputType> {
    // Implementation
  }
}
```

3. **Register in module**:
```typescript
@Module({
  providers: [YourAgent],
  exports: [YourAgent],
})
export class AssistantModule {}
```

### Database Changes

1. **Modify Prisma schema**:
```bash
cd apps/api
# Edit prisma/schema.prisma
```

2. **Create migration**:
```bash
pnpm prisma migrate dev --name add_your_table
```

3. **Generate client**:
```bash
pnpm prisma generate
```

### Adding API Endpoints

1. **Create DTO**:
```typescript
// dto/create-something.dto.ts
export class CreateSomethingDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}
```

2. **Add controller method**:
```typescript
@Post()
@ApiOperation({ summary: 'Create something' })
async create(@Body() dto: CreateSomethingDto) {
  return this.service.create(dto);
}
```

3. **Implement service method**:
```typescript
async create(dto: CreateSomethingDto) {
  return this.prisma.something.create({
    data: dto,
  });
}
```

4. **Add tests**:
```typescript
it('should create something', async () => {
  const result = await service.create({ name: 'test' });
  expect(result).toBeDefined();
});
```

## Testing

### Unit Tests

```bash
# Run all unit tests
pnpm test

# Run tests for specific module
pnpm test -- modules/bootstrap

# Run tests in watch mode
pnpm test -- --watch

# Run with coverage
pnpm test -- --coverage
```

### Integration Tests

```bash
# Run integration tests
pnpm test:integration

# Run specific integration test
pnpm test:integration -- bootstrap
```

### E2E Tests

```bash
# Run E2E tests
pnpm test:e2e

# Run specific E2E test
pnpm test:e2e -- e2e.spec.ts
```

### Writing Tests

**Unit Test Example**:
```typescript
describe('YourService', () => {
  let service: YourService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [YourService],
    }).compile();

    service = module.get<YourService>(YourService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should do something', async () => {
    const result = await service.doSomething();
    expect(result).toEqual(expectedValue);
  });
});
```

**E2E Test Example**:
```typescript
describe('YourController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/your-endpoint (POST)', () => {
    return request(app.getHttpServer())
      .post('/your-endpoint')
      .send({ data: 'test' })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('id');
      });
  });
});
```

## Debugging

### VS Code Debug Configuration

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug API",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["dev"],
      "cwd": "${workspaceFolder}/apps/api",
      "console": "integratedTerminal"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Tests",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["test", "--", "--runInBand"],
      "cwd": "${workspaceFolder}/apps/api",
      "console": "integratedTerminal"
    }
  ]
}
```

### Logging

Local runtime logs are now organized under the repository root `.logs` directory:

```bash
# Show the current session and recent archives
pnpm logs

# Print the current API log file path
pnpm logs:path -- api

# Tail the latest worker stderr
pnpm logs:tail -- worker stderr 120

# Archive old loose files left in .logs root
pnpm logs:organize
```

Current runs write to `.logs/current/`, and previous runs are archived to `.logs/runs/`.

Enable debug logging:

```bash
# All debug logs
DEBUG=* pnpm dev

# Specific namespace
DEBUG=uniflow:* pnpm dev

# Prisma queries
DEBUG=prisma:query pnpm dev
```

### Database Debugging

```bash
# Open Prisma Studio
cd apps/api
pnpm prisma studio

# View database
psql -U uniflow -d uniflow_oa

# Check migrations
pnpm prisma migrate status
```

## Code Style

### ESLint

```bash
# Check for issues
pnpm lint

# Fix auto-fixable issues
pnpm lint --fix
```

### Prettier

```bash
# Format all files
pnpm format

# Check formatting
pnpm format:check
```

### Commit Messages

Follow Conventional Commits:

```
type(scope): subject

body

footer
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting
- `refactor`: Code refactoring
- `test`: Tests
- `chore`: Maintenance

Example:
```
feat(assistant): add intent detection for cancel action

Implemented keyword matching and confidence scoring
for cancel intent detection.

Closes #123
```

## Performance Tips

1. **Use indexes**: Add database indexes for frequently queried fields
2. **Cache results**: Use Redis for expensive operations
3. **Batch operations**: Use Prisma's batch operations
4. **Lazy loading**: Don't load unnecessary relations
5. **Connection pooling**: Configure Prisma connection pool

## Security Best Practices

1. **Never commit secrets**: Use `.env` files
2. **Validate inputs**: Use Zod schemas
3. **Sanitize outputs**: Prevent XSS
4. **Use parameterized queries**: Prisma does this automatically
5. **Enable CORS properly**: Configure allowed origins
6. **Rate limiting**: Implement for public endpoints
7. **Audit logging**: Log all sensitive operations

## Useful Commands

```bash
# Install new dependency
pnpm add <package>

# Install dev dependency
pnpm add -D <package>

# Update dependencies
pnpm update

# Check outdated packages
pnpm outdated

# Clean install
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Build all packages
pnpm build

# Clean build artifacts
pnpm clean

# Generate Prisma client
cd apps/api && pnpm prisma generate

# Create migration
cd apps/api && pnpm prisma migrate dev --name <name>

# Reset database
cd apps/api && pnpm prisma migrate reset

# View database
cd apps/api && pnpm prisma studio
```

## Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [Prisma Documentation](https://www.prisma.io/docs/)
- [Next.js Documentation](https://nextjs.org/docs)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Zod Documentation](https://zod.dev/)

## Getting Help

- Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- Search [GitHub Issues](https://github.com/your-org/uniflow-oa/issues)
- Ask in team chat
- Email: dev@uniflow.example.com
