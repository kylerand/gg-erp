# accounting context

This context owns the QuickBooks Online integration and all outbound accounting synchronization.

## Responsibilities

- OAuth2 connection lifecycle with QuickBooks Online
- Invoice sync: push invoices to QB when work orders complete
- Customer sync: ensure GG customers exist in QB before invoice creation
- Entity mapping: track GG ID ↔ QB ID relationships for idempotent syncs
- Webhook ingestion: receive and store QB change notifications
- Token management: secure storage and automatic refresh of QB OAuth tokens
- Emits domain events for cross-context communication
- Writes only to its owned schema/tables (accounting + integrations schemas)

## Module Map

| File | Purpose |
|------|---------|
| `quickbooks.client.ts` | OAuth2 flows + QB REST API client |
| `quickbooks.tokenManager.ts` | Token storage (Secrets Manager / env) + auto-refresh |
| `invoiceSync.service.ts` | Invoice sync state machine (in-memory) |
| `invoiceSyncProcessor.service.ts` | Actual QB invoice push (DB + QB API) |
| `invoiceSync.routes.ts` | RPC-style route wrappers for invoice sync |
| `customerSync.service.ts` | Customer sync state machine + QB push |
| `customerSync.routes.ts` | RPC-style route wrappers for customer sync |
| `entityMapping.service.ts` | GG ID ↔ QB ID mapping CRUD |

## Lambda Handlers

| Handler | Trigger | Purpose |
|---------|---------|---------|
| `oauth-connect` | `GET /accounting/oauth/connect` | Redirect to QB OAuth |
| `oauth-callback` | `GET /accounting/oauth/callback` | Exchange code for tokens |
| `status` | `GET /accounting/status` | Check QB connection health |
| `trigger-sync` | `POST /accounting/sync` | Queue an invoice sync |
| `list-sync` | `GET /accounting/sync` | List invoice sync records |
| `retry-sync` | `POST /accounting/sync/:id/retry` | Retry a failed sync |
| `webhook` | `POST /accounting/webhook` | Receive QB webhook events |

## Domain Events Emitted

- `invoice_sync.started` / `.succeeded` / `.failed` / `.retried` / `.cancelled`
- `customer_sync.started` / `.succeeded` / `.failed` / `.skipped`
- `qb.webhook.received`
- `qb.connection.established` / `.lost`

## Non-goals in MVP

- No direct writes into other context schemas
- No silent error handling; failures are explicit and observable
- No real-time two-way sync (push-only for now; webhooks are stored for future pull)
