# Application evidence

OwnTrace classifies bounded email excerpts and keeps evidence per message. A job recommendation is not proof that the user applied. An application receipt, interview invitation or explicit rejection is an application-related update only when the source supports that interpretation.

## Matching

- Scope an application-specific reference to its employer. Conflicting roles stay separate.
- Without that reference, require compatible employer, role and conversation evidence.
- A requisition is a job identifier, not necessarily an application identity. A company name alone never merges applications.
- Keep ambiguous updates visible and unlinked. Preserve chronological events; the latest supported saved status differs from historical status counts.

## Failure handling

Model output must satisfy its schema and quote source evidence. Common explicit rejection wording is supported without accepting unsupported status guesses. Clearly labelled numeric application/job identifiers are distinguished from phone numbers. Invalid placeholder results can be retried in a bounded enrichment pass; an invalid retry does not erase an earlier grounded finding. Entity values never include redaction markers.

## Coverage

Each scan checks at most the latest250 INBOX messages. Archived, deleted and older messages may be absent, even when another message from the same company is visible. Missing events and unknown linkage do not establish that no response was received or that two messages are different applications.

The Jobs view separates application updates from recommendations and provides search, filters, pagination and dated evidence. TRACE uses the same owned query results and server-computed status counts.

## Design references

- [Gmail message and thread identifiers](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages)
- [Microsoft Graph message/conversation identifiers](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0)
- [Greenhouse application identity](https://harvestdocs.greenhouse.io/reference/get_v3-applications)
