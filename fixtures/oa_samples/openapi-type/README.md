# OpenAPI Type OA Sample

This is a mock OA system that exposes OpenAPI endpoints.

## Endpoints

- `GET /api/flows` - List available flows
- `POST /api/flows/{flowCode}/submit` - Submit a flow
- `GET /api/flows/{flowCode}/status/{submissionId}` - Query submission status

## Sample Flows

1. **travel_expense** - 差旅费报销
   - Fields: amount (number), reason (text), date (date)

2. **leave_request** - 请假申请
   - Fields: startDate (date), endDate (date), reason (text)

## Authentication

API Key authentication via `X-API-Key` header.
