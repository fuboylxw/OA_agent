# Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend Layer                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Next.js 14 (React + TailwindCSS)                    │  │
│  │  - Login, Chat, Submissions, Processes, Bootstrap    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │ HTTP/REST
┌─────────────────────────────────────────────────────────────┐
│                      API Gateway Layer                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  NestJS API Server (Port 3001)                       │  │
│  │  - REST API, Swagger Docs, Validation, Auth         │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼────────┐  ┌──────▼──────┐  ┌────────▼────────┐
│   Business     │  │   Queue     │  │   Data Layer    │
│   Modules      │  │   System    │  │                 │
│                │  │             │  │                 │
│ - Bootstrap    │  │  BullMQ     │  │  PostgreSQL 16  │
│ - Discovery    │  │  Workers    │  │  (Prisma ORM)   │
│ - Permission   │  │             │  │                 │
│ - Assistant    │  │  - Parse    │  │  30+ Tables:    │
│ - Rule Engine  │  │  - Submit   │  │  - Tenants      │
│ - Submission   │  │  - Status   │  │  - Users        │
│ - Status       │  │  - Bootstrap│  │  - Connectors   │
│ - Audit        │  │             │  │  - Templates    │
│                │  │             │  │  - Submissions  │
└────────────────┘  └─────────────┘  │  - Audit Logs   │
                                     │  - Bootstrap    │
                                     │  - IR Tables    │
                                     └─────────────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼────────┐  ┌──────▼──────┐  ┌────────▼────────┐
│   Redis 7      │  │   MinIO     │  │   External OA   │
│                │  │             │  │   Systems       │
│ - Cache        │  │ - File      │  │                 │
│ - Queue        │  │   Storage   │  │ - OpenAPI Type  │
│ - Session      │  │ - Attach-   │  │ - Form Type     │
│                │  │   ments     │  │ - Hybrid Type   │
└────────────────┘  └─────────────┘  └─────────────────┘
```

## Module Architecture

### Bootstrap Center (Batch 0)

```
┌─────────────────────────────────────────────────────────┐
│              Bootstrap State Machine                     │
│                                                          │
│  CREATED → DISCOVERING → PARSING → NORMALIZING →       │
│  COMPILING → REPLAYING → REVIEW → PUBLISHED            │
└─────────────────────────────────────────────────────────┘
         │           │           │           │
    ┌────▼────┐ ┌───▼────┐ ┌───▼────┐ ┌───▼────┐
    │Discovery│ │  IR    │ │Adapter │ │ Replay │
    │ Agent   │ │Normaliz│ │Compiler│ │Validatr│
    └─────────┘ └────────┘ └────────┘ └────────┘
         │           │           │           │
    ┌────▼───────────▼───────────▼───────────▼────┐
    │         Compatibility Engine                 │
    │  - OCL Calculator (OCL0-OCL5)               │
    │  - FAL Calculator (F0-F4)                   │
    │  - Capability Detector                      │
    └─────────────────────────────────────────────┘
```

### Assistant Module (Batch 2)

```
┌──────────────────────────────────────────────────────┐
│                  Chat Interface                       │
└──────────────────────────────────────────────────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
    ┌────▼────┐  ┌───▼────┐  ┌───▼────┐
    │ Intent  │  │ Flow   │  │ Form   │
    │ Agent   │  │ Agent  │  │ Agent  │
    └─────────┘  └────────┘  └────────┘
         │            │            │
         └────────────┼────────────┘
                      │
         ┌────────────▼────────────┐
         │   Session Management    │
         │   Draft Generation      │
         └─────────────────────────┘
```

### Submission Flow (Batch 3)

```
┌──────────────────────────────────────────────────────┐
│                  User Request                         │
└──────────────────────────────────────────────────────┘
                      │
         ┌────────────▼────────────┐
         │  Permission Check       │
         │  (Platform + OA)        │
         └────────────┬────────────┘
                      │ Allowed
         ┌────────────▼────────────┐
         │  Rule Validation        │
         │  (Validation/Calc/Cond) │
         └────────────┬────────────┘
                      │ Valid
         ┌────────────▼────────────┐
         │  Idempotency Check      │
         └────────────┬────────────┘
                      │ New
         ┌────────────▼────────────┐
         │  Create Submission      │
         └────────────┬────────────┘
                      │
         ┌────────────▼────────────┐
         │  Queue Processing       │
         │  (BullMQ Worker)        │
         └────────────┬────────────┘
                      │
         ┌────────────▼────────────┐
         │  OA Adapter Submit      │
         └────────────┬────────────┘
                      │
         ┌────────────▼────────────┐
         │  Update Status          │
         │  Audit Log              │
         └─────────────────────────┘
```

## Data Flow

### Bootstrap Flow

```
1. User uploads OA info
   ↓
2. Discovery Agent identifies OA type
   ↓
3. Parser extracts flows/fields/rules
   ↓
4. IR Normalizer creates intermediate representation
   ↓
5. Adapter Compiler generates OA connector code
   ↓
6. Replay Validator tests with sample data
   ↓
7. User reviews OCL report
   ↓
8. System publishes to Process Library
```

### Chat to Submit Flow

```
1. User: "我要报销差旅费1000元"
   ↓
2. Intent Agent: CREATE_SUBMISSION (confidence: 0.9)
   ↓
3. Flow Agent: Matches "travel_expense"
   ↓
4. Permission Check: Platform ✓, OA ✓
   ↓
5. Form Agent: Extracts amount=1000, asks for reason
   ↓
6. User: "原因是出差北京"
   ↓
7. Form Agent: Extracts reason, asks for date
   ↓
8. User: "日期2024-03-15"
   ↓
9. Form Agent: All fields complete
   ↓
10. Rule Engine: Validates amount > 0 ✓
   ↓
11. Create Draft (status: ready)
   ↓
12. User confirms
   ↓
13. Submit to Queue
   ↓
14. Worker processes → OA Adapter → OA System
   ↓
15. Update status, return submission ID
```

## Technology Stack

### Backend
- **Framework**: NestJS (Node.js)
- **ORM**: Prisma
- **Queue**: BullMQ
- **Validation**: Zod + class-validator
- **API Docs**: Swagger/OpenAPI

### Frontend
- **Framework**: Next.js 14
- **UI**: React + TailwindCSS
- **State**: React Hooks
- **HTTP**: Axios

### Database
- **Primary**: PostgreSQL 16
- **Cache**: Redis 7
- **Storage**: MinIO (S3-compatible)

### DevOps
- **Containerization**: Docker + Docker Compose
- **CI/CD**: GitHub Actions
- **Monitoring**: (To be added: Prometheus, Grafana)

## Design Patterns

### 1. State Machine Pattern
- Bootstrap job lifecycle
- Clear state transitions
- Event-driven progression

### 2. Agent Pattern
- Modular AI agents
- Input/output validation
- Composable agent chains

### 3. Adapter Pattern
- OA system abstraction
- Pluggable adapters
- Uniform interface

### 4. Repository Pattern
- Data access abstraction
- Prisma as repository layer
- Clean separation of concerns

### 5. Queue Pattern
- Async processing
- Retry mechanism
- Dead letter queue

### 6. Audit Pattern
- Trace ID propagation
- Comprehensive logging
- Event sourcing

## Security Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Security Layers                     │
├─────────────────────────────────────────────────────┤
│  1. Network Layer                                   │
│     - HTTPS/TLS                                     │
│     - Firewall rules                                │
│     - Rate limiting                                 │
├─────────────────────────────────────────────────────┤
│  2. Authentication Layer                            │
│     - JWT tokens (to be implemented)                │
│     - Session management                            │
│     - Password hashing                              │
├─────────────────────────────────────────────────────┤
│  3. Authorization Layer                             │
│     - RBAC (Role-Based Access Control)              │
│     - ABAC (Attribute-Based Access Control)         │
│     - OA real-time permission check                 │
├─────────────────────────────────────────────────────┤
│  4. Data Layer                                      │
│     - Input validation (Zod)                        │
│     - SQL injection prevention (Prisma)             │
│     - XSS prevention                                │
├─────────────────────────────────────────────────────┤
│  5. Audit Layer                                     │
│     - All operations logged                         │
│     - Trace ID tracking                             │
│     - Immutable audit logs                          │
└─────────────────────────────────────────────────────┘
```

## Scalability

### Horizontal Scaling

- **API Servers**: Stateless, can scale horizontally
- **Workers**: Scale based on queue depth
- **Database**: Read replicas for read-heavy workloads
- **Redis**: Redis Cluster for high availability

### Vertical Scaling

- **Database**: Increase CPU/RAM for complex queries
- **Redis**: Increase memory for larger cache
- **Workers**: Increase concurrency per instance

### Performance Optimizations

1. **Caching Strategy**:
   - Process templates (Redis)
   - User sessions (Redis)
   - OCL reports (Redis, 1 hour TTL)

2. **Database Optimization**:
   - Indexes on foreign keys
   - Indexes on query fields (tenantId, userId, status)
   - Connection pooling

3. **Queue Optimization**:
   - Priority queues for urgent tasks
   - Batch processing for bulk operations
   - Rate limiting per OA system

## Monitoring & Observability

### Metrics to Track

1. **Business Metrics**:
   - Bootstrap success rate
   - Submission success rate
   - Average processing time
   - User satisfaction (implicit)

2. **Technical Metrics**:
   - API response time (p50, p95, p99)
   - Queue processing time
   - Database query performance
   - Error rates
   - Cache hit rate

3. **Infrastructure Metrics**:
   - CPU usage
   - Memory usage
   - Disk I/O
   - Network throughput

### Logging Strategy

- **Structured Logging**: JSON format
- **Log Levels**: ERROR, WARN, INFO, DEBUG
- **Trace ID**: Propagated through all services
- **Sensitive Data**: Never log passwords, tokens, PII

## Future Enhancements

1. **Real LLM Integration**: Replace mock agents with GPT-4
2. **Multi-language Support**: i18n for frontend
3. **Advanced Analytics**: Dashboard with charts
4. **Webhook Support**: Real-time notifications
5. **Mobile App**: React Native app
6. **Plugin System**: Custom agent plugins
7. **GraphQL API**: Alternative to REST
8. **Microservices**: Split into smaller services
