# FolioView Web

Next.js frontend for Market, encrypted holdings/resources, tasks, Agent connections, Inbox and
Settings. `/` and `/market` are equivalent; `/resources`, `/tasks`, `/agents`, `/inbox` and
`/settings` retain their route on direct load and refresh. Unknown routes return 404.

Resources, Tasks, Agents, Inbox and Settings share one owner unlock within the supported signed-in
browser session. Sign-out, account changes and explicit lock clear private views. SharedWorker
lifetime is browser-controlled; unsupported browsers or a lost/upgraded Worker require another
unlock. Persistent Agent identity is separate from this temporary owner session.

## Documentation

| Guide                                          | Contents                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [Workspace](docs/workspace.md)                 | Navigation, source types, CSV import, task editing and Inbox                                 |
| [Keys and recovery](docs/key-management.md)    | Device review, Passkey replacement, renewal, original-operation recovery and archive removal |
| [Private transport](docs/transport.md)         | Fixed BFF routes, verified identity, limits and request/session fencing                      |
| [Agent integration](docs/agent-integration.md) | Persistent consent/publication, reports and retained foreground compatibility                |

CSV holdings and private task/report content are encrypted in the existing owner Worker. User
watchlists and manually entered creator text remain in User's ordinary plaintext domain.
Google login authenticates ownership; it does not reconstruct library keys. Keep the independent
recovery file and recovery code separately. The published frontend remains part of the trust boundary.

Persistent producers/runtime and Web consumers are implemented behind default-off feature gates.
Real Muse pairing, actual native plans, protected-host restart and cross-day encrypted results
require separate owner-led acceptance. A code deployment or Agent statement is not that evidence.

## Development and verification

Follow the root [setup guide](../../README.md#local-development), copy [.env.example](.env.example)
to `.env.local`, then run from the repository root:

```bash
npm run dev:web
npm run typecheck:web
npm run test:web
npm run build:web
npm run check
```

Local-only direct Portfolio/Hub origins are restricted to loopback `next dev`. Deployed clients
use fixed same-origin owner forwarding and server-only configuration; see the transport guide.
Behavior tests exercise Worker/IndexedDB/session boundaries and independent Python protocol
peers. Physical Passkey, real cloud identities and Muse acceptance remain separate evidence.

## Automatic image release

The [Cloud Build pipeline](../../infra/gcp/cloudbuild.web.yaml) uses the guarded existing-service
release path. Shared browser contract changes are included in the Web trigger. Verify exact
source, image digest, ready revision and traffic; passing PR checks alone is not deployment proof.
See the [delivery guide](../../infra/gcp/README.md) and [Web infrastructure](../../infra/gcp/terraform/envs/prod/web/README.md).
