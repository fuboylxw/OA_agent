# UniFlow OA Copilot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Enterprise-grade OA (Office Automation) intelligent assistant system for universities.

## 🌟 Features

- **🔍 Universal OA Compatibility**: Automatically discover and integrate any OA system
- **🤖 Intelligent Assistant**: Natural language interface for office workflows
- **🔐 Dual-Layer Permissions**: Platform RBAC+ABAC + OA real-time validation
- **📊 Full Audit Trail**: Complete traceability with trace IDs
- **⚡ High Performance**: Queue-based processing, Redis caching
- **🎯 Smart Automation**: OCL/FAL-based automation level assessment
- **🔄 Idempotent Operations**: Duplicate prevention for submissions
- **📈 Real-time Status**: Live status tracking with timeline

## 🏗️ Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Next.js   │────▶│   NestJS    │────▶│ PostgreSQL  │
│  Frontend   │     │     API     │     │  Database   │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ├────▶ Redis (Cache/Queue)
                           ├────▶ MinIO (Storage)
                           └────▶ BullMQ (Workers)
```

## 🚀 Quick Start

### Prerequisites

- Node.js >= 20
- pnpm >= 8
- Docker & Docker Compose

### Option 1: Automated Setup

```bash
cd OA_agent
./setup.sh
pnpm dev
```

### Option 2: Manual Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Set up environment
cp .env.example .env

# 3. Start infrastructure
docker compose up -d postgres redis minio

# 4. Run migrations
pnpm db:migrate

# 5. Seed database
pnpm db:seed

# 6. Build packages
pnpm build

# 7. Start development servers
pnpm dev
```

### Option 3: Full Docker

```bash
docker compose up --build
```

## 📱 Access Points

- **Frontend**: http://localhost:3000
- **API**: http://localhost:3001
- **API Documentation**: http://localhost:3001/api/docs
- **Health Check**: http://localhost:3001/health

## 🧪 Testing

```bash
# Unit tests
pnpm test

# Integration tests
pnpm test:integration

# Bootstrap smoke test
pnpm bootstrap:smoke

# E2E tests
pnpm test:e2e
```

## 📚 Documentation

- [Implementation Status](./IMPLEMENTATION_STATUS.md) - Detailed implementation progress
- [Final Summary](./FINAL_SUMMARY.md) - Complete feature list and architecture
- [API Documentation](http://localhost:3001/api/docs) - Interactive API docs (when running)

## 🎯 Key Concepts

### OCL (OA Compatibility Level)

- **OCL0**: Not accessible
- **OCL1**: Read-only access
- **OCL2**: Semi-write access
- **OCL3**: Stable submission
- **OCL4**: Deep integration
- **OCL5**: Full lifecycle support

### FAL (Flow Automation Level)

- **F0**: Guidance only
- **F1**: Smart form filling
- **F2**: Semi-automatic (user confirmation)
- **F3**: Fully automatic submission
- **F4**: Unattended automation

### Bootstrap Pipeline

```
CREATED → DISCOVERING → PARSING → NORMALIZING →
COMPILING → REPLAYING → REVIEW → PUBLISHED
```

## 📦 Project Structure

```
OA_agent/
├── apps/
│   ├── api/              # NestJS API server
│   ├── worker/           # BullMQ background workers
│   └── web/              # Next.js frontend
├── packages/
│   ├── shared-types/     # TypeScript types
│   ├── shared-schema/    # Zod schemas
│   ├── agent-kernel/     # AI agent framework
│   ├── oa-adapters/      # OA system adapters
│   └── compat-engine/    # OCL/FAL calculators
├── fixtures/
│   └── oa_samples/       # Sample OA systems
├── prisma/
│   ├── schema.prisma     # Database schema (30+ tables)
│   └── migrations/       # Migration files
└── scripts/
    └── bootstrap-smoke.ts # Verification script
```

## 🔧 Technology Stack

- **Backend**: NestJS, Prisma, BullMQ
- **Frontend**: Next.js 14, React, TailwindCSS
- **Database**: PostgreSQL 16
- **Cache/Queue**: Redis 7
- **Storage**: MinIO
- **Validation**: Zod
- **API Docs**: Swagger/OpenAPI

## 🎨 Features by Module

### Bootstrap Center (Batch 0)
- Automatic OA discovery
- OCL/FAL assessment
- Adapter compilation
- Replay validation

### Core APIs (Batch 1)
- Connector management
- Process library
- Audit logging

### Business Logic (Batch 2)
- Permission engine
- Chat assistant
- Intent detection
- Flow matching

### Submission System (Batch 3)
- Rule engine
- Idempotent submission
- Status tracking
- Action matrix (cancel/urge/supplement/delegate)

### Frontend (Batch 4)
- Login page
- Chat workspace
- My applications
- Process library
- Bootstrap center
- Connector management

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines first.

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

Built with ❤️ for university office automation

## 📞 Support

For issues and questions:
- GitHub Issues: [Report an issue](https://github.com/your-org/uniflow-oa/issues)
- Documentation: See `/docs` folder
- Email: support@uniflow.example.com

---

**Note**: This is an MVP implementation. For production use, please review security settings, add proper authentication, and conduct thorough testing.
