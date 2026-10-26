# API

The API is served from `/api` and returns JSON.

## Health check

`GET /api/health`

Response (`200 OK`):

```json
{
  "success": true,
  "message": "OwnTrace API is running"
}
```

No authentication is required for the health check.

## Authentication

Authentication uses the `owntrace_session` httpOnly cookie. Successful registration and login responses set the cookie; clients must send requests with credentials enabled. Password hashes and JWTs are never returned in JSON.

### Register

`POST /api/auth/register`

Request:

```json
{
  "name": "Example User",
  "email": "user@example.com",
  "password": "a passphrase with at least 12 characters"
}
```

Response (`201 Created`):

```json
{
  "success": true,
  "user": {
    "id": "...",
    "name": "Example User",
    "email": "user@example.com",
    "authProviders": ["password"],
    "emailVerified": false,
    "onboardingStatus": "NOT_STARTED",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

Duplicate emails return `409 EMAIL_IN_USE`. Invalid fields return `400 VALIDATION_ERROR` with a field-keyed `errors` object.

### Login

`POST /api/auth/login`

Request:

```json
{
  "email": "user@example.com",
  "password": "a passphrase with at least 12 characters"
}
```

Returns `200 OK` with the same safe user shape as registration. Invalid credentials return `401 INVALID_CREDENTIALS` without confirming whether the email exists.

### Current session

`GET /api/auth/me`

Returns `200 OK` with `{ "success": true, "user": { ... } }` for a valid cookie session. Missing, invalid, or expired sessions return `401`.

### Session discovery

`GET /api/auth/session`

Used by the browser during startup. It returns the safe user shape for a valid session or `{ "success": true, "user": null }` when no restorable session exists. Invalid cookies are cleared. This endpoint does not grant access; protected APIs still require authentication middleware and return `401` when unauthorized.

### Logout

`POST /api/auth/logout`

Clears the session cookie and returns:

```json
{
  "success": true,
  "message": "Signed out successfully."
}
```

Gmail, accounts, subscriptions, breaches, and other product APIs remain outside this authentication milestone.

## Onboarding

Both onboarding endpoints require a valid `owntrace_session` cookie. State changes are scoped to the authenticated user.

### Read onboarding status

`GET /api/onboarding`

Response (`200 OK`):

```json
{
  "success": true,
  "onboarding": {
    "status": "NOT_STARTED"
  }
}
```

### Advance onboarding

`PATCH /api/onboarding`

Request:

```json
{
  "status": "PRIVACY_REVIEWED"
}
```

The supported progression is `NOT_STARTED → PRIVACY_REVIEWED → GMAIL_PENDING`. Repeating the current step is idempotent. Unsupported states return `400 INVALID_ONBOARDING_STATUS`; skipping a required step returns `409 ONBOARDING_STEP_OUT_OF_ORDER`.

`GMAIL_PENDING` means the user completed the privacy explanation and is ready to begin connection setup. It does not mean Gmail access has been granted.


## Top K email analysis

These endpoints require the signed-in session. Responses are not publicly cacheable.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/top-k?k=3` | Ranked categories, bounded scan status and first-page results; k is1–8 |
| GET | `/api/top-k/groups` | Paginated category groups; category, status, search, kind, page and limit filters |
| PUT | `/api/top-k/consent` | Set enabled and consent version1; disabling stops active work |
| POST | `/api/top-k/scans` | Start/resume the selected gmail or outlook scan, at most250 inbox messages |
| DELETE | `/api/top-k/scans/:provider` | Stop queued/active analysis without deleting saved results |
| POST | `/api/top-k/enrichment` | Retry eligible legacy/invalid derived records within the bounded window; empty body |

`kind` is `all`, `applications` or `opportunities`; page starts at1 and group limits are6,12or24. Counts and current/historical status distributions cover all matching saved groups before pagination. Messages and linked application groups are separate counts. The current scan run is not complete mailbox history.

Body access is a separate OAuth upgrade using `/api/google/oauth/start?access=body` or `/api/microsoft/oauth/start?access=body`. Existing metadata-only grants are retained until the user approves broader read-only access. Enabling analysis also requires its OwnTrace consent. No attachments or mailbox changes are supported by this flow.
