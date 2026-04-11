# Hybrid Type OA Sample

This is a mock OA system that combines both API and form-based approaches.

## Features

- API endpoints for listing flows and querying status
- HTML forms for submission
- OAuth2 authentication

## Sample Flow

**meeting_room** - 会议室预约

API Endpoints:
- `GET /api/meeting_room` - Get meeting room info
- `GET /api/meeting_room/status/{bookingId}` - Query booking status

Form Submission:
- URL: `http://localhost:8080/forms/meeting_room`
- Fields: roomId, startTime, endTime, purpose

## Authentication

OAuth2 with client credentials flow.
