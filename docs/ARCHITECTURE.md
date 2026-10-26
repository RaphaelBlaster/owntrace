# Architecture

OwnTrace is a modular React/Express application with MongoDB. The live deployment uses one AWS server in Mumbai: Caddy handles HTTPS and reverse proxying, the Node process serves the application and runs background workers, and MongoDB persists data. There is no active Redis intermediary or separate inference server.

## Boundaries

| Component | Responsibility |
| --- | --- |
| `client/` | React/Vite pages, authenticated API requests and TRACE streaming UI |
| `server/src/routes/` | Authentication, validation and HTTP contracts |
| `server/src/services/` | Mail access, processing, queries and background work |
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

Google Pub/Sub and Microsoft Graph notifications enqueue work. Notifications arriving during active work are coalesced into a follow-up. The worker checks persisted jobs; this polling is not a full mailbox scan each second. OAuth grants, callback configuration and provider access must remain valid. Body-enabled Top K notifications use its bounded flow rather than launching a legacy metadata scan in parallel.

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

For job-result lookups, a server-owned formatter renders actual result counts, full saved status distributions, page examples and scan/enrichment coverage. Model-generated personal job prose is not emitted on this path. General explanations and other workspace answers retain the model answer path with retrieved facts. Supported navigation actions open existing owned pages; consequential actions use their actual UI confirmation.

## Rate limiting

The web API uses an in-memory exact sliding window. General requests, mailbox/status polling, authentication and provider callbacks have separate allowances. Background provider fetches are not browser API requests. Repeated status refreshes can exhaust their own allowance but do not consume the general API allowance. Counters are keyed by IP for these API policies and reset when the process restarts; TRACE also has its own user-based message limit.

This is suitable for the current single process, with shared-IP limitations. Multiple processes would need a shared store for coordinated enforcement. Redis is not currently used for rate limiting.

## Disabled optimization

An optional same-host Redis write buffer exists behind `ORDER_REDIS_URL`, but it is disabled in the live deployment. Current derived writes go directly to MongoDB in page batches. Redis is neither a queryable cache nor part of the current architecture. Evaluate shared limiting or buffering only after measuring a need; do not enable it merely to support ordinary batching.

## References

- [API contracts](API.md) and [security notes](SECURITY.md)
- [Application matching and failure handling](APPLICATIONS.md)
- [Gmail messages and thread IDs](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages)
- [Microsoft Graph messages and conversation IDs](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0)
- [Greenhouse application model](https://harvestdocs.greenhouse.io/reference/get_v3-applications)
