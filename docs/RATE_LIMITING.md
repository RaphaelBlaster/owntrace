# Rate Limiting

How OwnTrace limits traffic in the Docker Compose deployment (caddy → api / mail-worker / rag, Redis for BullMQ).

## Inbound limits

| Scope | Limit | Key | Code |
|---|---|---|---|
| All `/api` routes (except mail status) | 200 / 15 min | client IP | `middleware/security.middleware.js` `apiRateLimiter` |
| Mail status polls (`GET /api/{google,microsoft}/{sync,connection}`, `/api/top-k`) | 60 / min | client IP | `mailStatusRateLimiter` |
| `POST /api/auth/register`, `/login`, `DELETE /api/auth/account` | 20 / 15 min | client IP | `authRateLimiter` |
| `/api/provider-notifications` (Gmail Pub/Sub push) | 1000 / min | client IP | `providerNotificationRateLimiter` |
| TRACE `POST /api/trace/conversations/:id/messages` | 12 / min | user id | `routes/trace.routes.js` |
| Mailbox `POST /api/mail/sync-now` | 6 / min, plus 30 s coalescing | user id | `routes/mail-refresh.routes.js` |

The 429 response body is `{ success: false, code: "RATE_LIMITED" }` (`TRACE_RATE_LIMIT` for TRACE). Rate-limit headers follow the IETF draft-8 format.

## Outbound limits

| Target | Limit | Code |
|---|---|---|
| Breach provider | 1 / s, 20 / h, 90 / day for the whole app | `services/breach-provider-rate-limit.service.js` |
| Gmail API | retries with backoff on 429 / 403 `rateLimitExceeded` | `services/gmail-sync.service.js`, `services/google-client.service.js` |

Gmail push bursts do not multiply sync work: the mail-sync job is deduplicated per `${provider}-${userId}` in BullMQ, so many notifications for one user collapse into one sync.

## Behind Caddy: client IP

Every request arrives from Caddy. Without proxy trust, all users share one IP bucket.

- Set `TRUST_PROXY=1` in `env/api.env`. That trusts exactly one hop (Caddy), so `req.ip` is the real client.
- `TRUST_PROXY=true` is rejected in production (`config/runtime.js`), because it would let clients spoof `X-Forwarded-For` and pick their own bucket.
- Only Caddy publishes ports 80/443; api is not reachable directly, so the forwarded header cannot be bypassed.

## Known limitations

1. **In-memory counters.** `SlidingWindowStore` and the TRACE / sync-now maps live in the api process. This is correct for the current single api container, but:
   - counters reset when the container restarts;
   - with more than one api replica, each keeps its own count, so the effective limit multiplies by the replica count.

   Before scaling api horizontally, move the stores to Redis (e.g. `rate-limit-redis`), which is already in the stack.
2. **Shared IPs.** Users behind one NAT (campus, mobile carrier) share the IP-keyed limits, notably 20 logins / 15 min. Per-user limits (TRACE, sync-now) are unaffected.
3. **Global breach quota.** The breach-check limit is app-wide to protect the provider's quota, so one heavy user can exhaust the daily 90 checks for everyone.
4. **Pub/Sub source IPs vary.** The webhook limit only caps floods; authenticity comes from OIDC token verification, not the limiter.

Limits are skipped when `NODE_ENV=test`.
