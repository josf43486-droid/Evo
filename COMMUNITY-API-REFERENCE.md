# EVO Community API

All routes require `Authorization: Bearer <session-token>` unless stated otherwise. JSON request bodies use UTF-8.

| Method | Route | Access | Purpose |
|---|---|---|---|
| GET | `/api/community/settings` | Signed-in | Read chat/support switches |
| POST | `/api/community/settings` | Admin | Set `chatEnabled`, `chatReadOnly`, `supportEnabled` |
| GET | `/api/community/messages?after=0` | Signed-in | Poll room messages after timestamp |
| POST | `/api/community/messages` | Signed-in | `{ "text": "message" }` |
| DELETE | `/api/community/messages/:id` | Author/Admin | Remove a room message |
| POST | `/api/support/tickets` | Signed-in | `{ "subject": "...", "text": "..." }` |
| GET | `/api/support/tickets` | Signed-in | Own tickets; admins see all |
| POST | `/api/support/tickets/:id/reply` | Ticket owner/Admin | `{ "text": "..." }` |
| POST | `/api/support/tickets/:id/status` | Admin | `{ "status": "open\|in_progress\|answered\|closed" }` |
| GET | `/api/domains` | Signed-in | Own domains; admins see all |
| POST | `/api/domains` | Signed-in | `{ "domain": "example.com", "projectId": "..." }` |
| POST | `/api/admin/domains/:id/verify` | Admin | Check apex TXT verification token |
| DELETE | `/api/domains/:id` | Owner/Admin | Remove domain request |
| GET | `/api/admin/community/users` | Admin | List user profiles |
| POST | `/api/admin/community/users/:uid/ban` | Admin | `{ "banned": true\|false }` |
| DELETE | `/api/admin/community/users/:uid` | Admin | Revoke login, retain linked records |

The room is implemented with periodic polling, not a persistent WebSocket. The domain endpoint registers and verifies ownership; it does not create a public route or TLS certificate. Configure reverse proxy and ACME separately before advertising a domain as online.
