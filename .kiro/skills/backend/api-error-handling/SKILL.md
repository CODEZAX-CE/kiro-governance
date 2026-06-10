---
name: api-error-handling
description: API error response format, AppError classes, status codes, and error handler middleware. Use when handling errors, defining error responses, or implementing error boundaries.
metadata:
  version: '2.0'
---

## Handling Errors in a Handler

1. Throw a specific `AppError` subclass from the service layer
2. The `errorHandler` middleware catches it and formats the response
3. Unknown errors return 500 with a generic message — never expose internals
4. Log every error with context (requestId, userId, input)

## ApiError Response Shape

```typescript
interface ApiError {
  statusCode: number;
  code: string; // Machine-readable: 'CLIENT_NOT_FOUND'
  message: string; // Human-readable: 'Client not found'
  details?: unknown; // Optional: validation errors, field-level issues
}
```

## Status Codes

| Status | When                         | Example code       |
| ------ | ---------------------------- | ------------------ |
| 400    | Validation failed            | `VALIDATION_ERROR` |
| 401    | JWT missing or expired       | `UNAUTHORIZED`     |
| 403    | Role/county/agency denied    | `FORBIDDEN`        |
| 404    | Resource not found           | `CLIENT_NOT_FOUND` |
| 409    | Duplicate or concurrent edit | `CONFLICT`         |
| 500    | Unexpected error             | `INTERNAL_ERROR`   |

## Error Classes

```typescript
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} with id ${id} not found`, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super('FORBIDDEN', message, 403);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
  }
}
```

## Gotchas

- Never return raw error messages from unknown errors — they may contain SQL, stack traces, or PII.
- Zod validation errors should be caught and re-thrown as `ValidationError` with `error.issues` as details.
- 403 vs 401: Use 401 only for missing/expired JWT. Use 403 when the user is authenticated but lacks the role or county access.
- Always include the machine-readable `code` field — the frontend switches on it, not on `message`.
