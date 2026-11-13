# Architecture

OwnTrace is a modular React/Express application with MongoDB, deployed as Docker Compose services on one AWS EC2 host (Mumbai). One image runs as `api` (HTTP API and webhooks), `mail-worker` (all background loops) and `rag` (the private TRACE service). Caddy handles HTTPS and is the only published service. Redis carries the BullMQ `mail-sync` queue between api and mail-worker. MongoDB runs on the host and remains the source of truth. Locally, `OWNTRACE_ROLE=all` (the default) runs everything in one process without Redis.

## Boundaries

| Component | Responsibility |
| --- | --- |
| `client/` | React/Vite pages, authenticated API requests and TRACE streaming UI |
| `server/src/routes/` | Authentication, validation and HTTP contracts |
| `server/src/services/` | Mail access, processing, queries and background work |
| `server/src/shared/queue.js` | The only shared module: BullMQ enqueue/worker helpers for the `mail-sync` queue |
| `server/src/worker.js` | Background loops started by the `mail-worker` role |
| `server/src/trace-server.js` | Entry point of the `rag` (TRACE) service |
| Redis | BullMQ queue only; not a cache and not used for rate limiting |
| MongoDB | Users, sessions, encrypted provider credentials, scan jobs/checkpoints, derived records and conversations |
| External providers | Gmail, Microsoft Graph, TypeSafe Jev, Inception Mercury and optional XposedOrNot breach checks |

Local Vite proxies `/api` to Express on port 5000. Authentication uses a signed JWT in an httpOnly cookie plus a server-side session record. Private queries use the authenticated user ID, not a model-provided identity. Provider tokens are stored encrypted and are not exposed to TRACE.

## Two email paths

**Metadata discovery** derives account and subscription evidence from sender/subject/date metadata. It does not require body access. Connecting a provider starts the metadata flow; authenticated provider notifications can schedule later work when push is configured.

**Top K** is an independent opt-in analysis page. It requires read-only body permission plus analysis consent. Its bounded worker reads up to 250 inbox messages, fetches metadata in pages of at most 25 and sends eligible excerpts to Mercury in small batches. The separate Orders pipeline remains available; Top K does not replace Dashboard or the account inventory.

1. Store the scan job, its provider, run ID and checkpoint in MongoDB.
2. Fetch the next inbox metadata page and deduplicate against saved message fingerprints.
3. Send minimized metadata to Jev. High-confidence marketing, spam and personal results can avoid body processing; eligible or uncertain cases proceed to Mercury.
4. Fetch body excerpts under the optional grant. Redact sensitive patterns, cap excerpt size and exclude attachments from analysis.
5. Validate model structure and supporting evidence. Save derived cards with batched MongoDB writes; checkpoint only after successful persistence.
6. Rank categories by recency, importance and required action. Only a bounded number of messages contribute to each category score, reducing newsletter-volume dominance. Marketing, spam, personal and review-only categories do not become top-ranked categories.

Malformed model output has bounded retries/single-message recovery with validation retained. Transport errors remain failures rather than invented classifications. Failed scans retain their checkpoint for supported resumption. While a refresh runs, reads include the previous completed run for the same user and connection, bounded to250 saved messages; once refresh completes, reads use only its run. Stop, consent withdrawal and disconnect are checked before committing results.

Google Pub/Sub and Microsoft Graph notifications enqueue work. With `REDIS_URL` set, the api adds one `mail-sync` BullMQ job per provider and user (deduplicated by `${provider}-${userId}`); the mail-worker turns it into a due MongoDB sync job and syncs from the stored cursor (`gmailHistoryId`), not from the notification. If Redis is unreachable the api queues the MongoDB job directly. Pub/Sub redelivers unacknowledged pushes for 7 days and a daily safety poll catches stale mailboxes, so downtime is caught up without a manual rescan. Notifications arriving during active work are coalesced into a follow-up. The worker checks persisted jobs; this polling is not a full mailbox scan each second. OAuth grants, callback configuration and provider access must remain valid. Body-enabled Top K notifications use its bounded flow rather than launching a legacy metadata scan in parallel.

## Application evidence and grouping

Saved email events are the evidence layer. Mercury can extract an employer, role, supported application reference and status; unknown details remain unknown. A recommendation or invitation to apply is an opportunity, not proof that an application was submitted.

- An application reference is scoped to the employer. Conflicting extracted roles remain separate.
- Compatible employer, role and provider-thread evidence can support a group when an application reference is unavailable.
- Company identity alone never joins applications. A requisition identifies a job, not necessarily one person's application.
- Group timelines preserve dated events; latest supported saved status and historical event counts are distinct.
- Ambiguous records stay separate. Group counts do not establish unique applications or employer-verified status.

Queries use the signed-in user and current scan run, filter before pagination, and return full matching counts and status distributions alongside page examples. Enrichment can update older derived job records without resetting the original scan. Pending enrichment is a processing state; unresolved linkage is ambiguity and can remain unresolved afterward.

The scan covers **INBOX only, at most the latest 250 messages**. Archive moves, older threads and messages outside this window can break a visible timeline. Missing events cannot establish complete application history or prove that no rejection/reply exists. Gmail body analysis has live test evidence; Outlook body analysis still requires a live mailbox test despite automated integration coverage.

## TRACE

TRACE uses Mercury for retrieval planning and validated read-only tool selection. There is no Jev gate on users' questions. The server checks the session, onboarding and consent for the configured conversation provider before access; existing compatible consent is retained. Tools cannot accept arbitrary URLs, run code or change private records.

Every personal-record turn retrieves current saved data. Tool-family coverage prevents finalizing a planned records answer without its matching lookup. Failed retrieval is distinct from a successful empty result; incomplete scans and uncertain linkage remain explicit limitations.

For job-result lookups, a server-owned formatter produces a concise conversational summary from actual message counts, status totals and a few relevant examples. Overlapping lookups are combined; scan limits and uncertainty are explained briefly instead of dumping internal diagnostics. Model-generated personal job prose is not emitted on this path. General explanations and other workspace answers retain the model answer path with retrieved facts. Supported navigation actions open existing owned pages; consequential actions use their actual UI confirmation.

## Rate limiting

The api uses in-memory exact sliding windows keyed by client IP (general, mail-status polling, auth, provider webhooks), plus per-user limits for TRACE messages and mailbox refresh. Behind Caddy, `TRUST_PROXY=1` makes the client IP correct. Counters reset on restart and are per process, which is correct for the single api container; multiple api replicas would need a Redis store. Details: [RATE_LIMITING.md](RATE_LIMITING.md).

## Disabled optimization

An optional same-host Redis write buffer exists behind `ORDER_REDIS_URL`, but it is disabled in the live deployment. Current derived writes go directly to MongoDB in page batches. Redis in the stack serves only the BullMQ queue; it is not a queryable cache. Evaluate shared limiting or buffering only after measuring a need; do not enable it merely to support ordinary batching.

## References

- [Deployment](../DEPLOY.md) and [rate limiting](RATE_LIMITING.md)
- [API contracts](API.md) and [security notes](SECURITY.md)
- [Application matching and failure handling](APPLICATIONS.md)
- [Gmail messages and thread IDs](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages)
- [Microsoft Graph messages and conversation IDs](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0)
- [Greenhouse application model](https://harvestdocs.greenhouse.io/reference/get_v3-applications)
