# Evidence-grounded application timelines and TRACE

## Research and verified current gaps
- Current MailInsight rows are per email: 74 jobs messages do not mean 74 applications. No company/role/application-reference fields or reconciliation exist.
- TRACE calls a separate scope classifier and returns clarification before Mercury can retrieve. Its tools omit the new mail insights.
- Gmail threadId / Graph conversationId identify email conversations, not application identities. Greenhouse models an application as a candidate's journey on a particular job.
- Sources: https://harvestdocs.greenhouse.io/reference/get_v3-applications ; https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages ; https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0 ; https://docs.inceptionlabs.ai/cookbooks/natural-language-sql-agent

## Selected design
Keep per-message evidence records. Mercury extracts nullable employer/role/reference fields with exact source evidence and distinguishes application updates from opportunities. Preserve provider thread IDs as scoped HMAC hashes. Derive application groups using employer + explicit application reference; otherwise require matching employer + role + thread, rejecting conflicting references. Company alone never identifies an application. Ambiguous events remain unlinked within the company's evidence rather than being silently merged. Current status is the latest supported email-reported status; preserve all prior events and timestamps. Do not equate receive time with actual hiring-event time.

Add company name/logo/role/status cards and explicit pagination. Logo domain must be independently grounded or curated; ATS sender domains must not become employer logos. Unknown employers use a neutral fallback.

TRACE removes the Jev conversational gate, retaining the independent email-noise filter. Mercury selects read-only, user-scoped retrieval tools. A planning/coverage contract requires executed fresh retrieval for personal claims; empty successful results, incomplete scans and unavailable retrieval remain distinct. Existing authentication, consent, ownership and read-only tool validation remain server-enforced.

## Implementation contract
- Model/helper additions: companyName, companyDomain, companyEvidence, roleName, roleEvidence, applicationReference, referenceType(application/requisition/null), referenceEvidence, eventKind(application/opportunity/other), enrichmentVersion. Validate every extracted entity against bounded redacted source evidence. No logo URL from the model.
- Query `queryMailInsights(userId,{category,status,search,page,limit,kind})` returns `{insights,pagination,scan,counts}`. Default jobs kind applications excludes job alerts. Group cards: `{id,category,company:{name,domain,logoUrl},role,title,status,summary,occurredAt,actionRequired,importance,evidence,senderDomain,kind,match,messageCount,events:[{id,status,occurredAt,summary,evidence}]}`. Counts distinguish messages/resolved applications/unresolved/opportunities.
- GET `/api/top-k/groups` wraps this query. Existing TopK summary keeps first-page groups per category with pagination; default6/page. TRACE uses the same query, not an independent interpretation.
- Bounded enrichment re-enumerates latest250 metadata, matches existing HMAC message IDs, re-reads eligible job bodies only where new entity fields are missing, upserts existing records with version, and preserves completed250 checkpoint/counts/credentials. No database reset or invented historical reconstruction.

## Verification
Same-company/different-role isolation; same reference receipts/interview/rejection timeline; conflicting refs remain separate; ATS not employer; opportunity not application; unordered arrival; missing evidence stays unknown; pagination complete/no duplicate pages; zero vs unavailable vs incomplete; TRACE jobs queries retrieve data without Jev gate; cross-user denial; existing250 preserved. Independent review before deployment; back up and retain runtime/user/database state.
