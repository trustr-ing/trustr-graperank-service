# trustr-graperank-service

Stateless TSM service module that runs GrapeRank Web-of-Trust ranking. Receives requests from [trustr-service-orchestrator](../trustr-service-orchestrator/) and streams unsigned events back via SSE.

## How it fits

```
trustr-service-orchestrator
       │                          ▲
       │  POST /tsm/request       │  SSE stream (text/event-stream)
       │  { event, serviceId }    │  unsigned kind 7000 + kind 37573
       ▼                          │
  trustr-graperank-service ───────┘
       │
       │  SimplePool (fetch-only, no publish)
       ▼
  Nostr relays (read event data for ranking)
```

The orchestrator handles all **signing, publishing, and relay management**. This service only computes results and returns unsigned events.

## Configuration

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `PORT` | no | HTTP listen port (default: `3001`) |
| `HOST` | no | Bind address (default: `127.0.0.1`). Set to VPC private IP when on a separate droplet |
| `SERVICE_ID` | no | Service identifier (default: `graperank_wot`) — must match `TSM_SERVICE_N_SERVICE_ID` in orchestrator |
| `PAGE_SIZE` | no | Max results per kind 37573 output page (default: `1000`) |
| `VERBOSE_FEEDBACK` | no | Emit verbose kind 7000 info events during interpretation/calculation (default: `false`) |
| `READ_RELAYS` | no | Fallback comma-separated read relays used when orchestrator payload does not include `defaultReadRelays` |
| `ALLOWED_REQUEST_TYPES` | no | Allowed `config:type` values accepted by parser and published in announcement (default: `pubkey,p,P`) |
| `DEFAULT_REQUEST_TYPE` | no | Default `config:type` published in service announcement (default: `p`) |

## Development

```bash
npm install
npm run dev        # tsx src/index.ts
npm run typecheck  # tsc --noEmit
npm run build      # esbuild → dist/index.js
npm start          # node dist/index.js
```

## Deployment

```bash
npm install && npm run build

sudo mkdir -p /opt/trustr-graperank-service
sudo cp -r dist node_modules package.json /opt/trustr-graperank-service/
sudo cp .env.example /opt/trustr-graperank-service/.env
sudo nano /opt/trustr-graperank-service/.env
sudo chmod 600 /opt/trustr-graperank-service/.env
sudo chown -R trustr:trustr /opt/trustr-graperank-service

# Systemd — start this service BEFORE the orchestrator
sudo cp graperank-service.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now graperank-service
```

### Cross-droplet deployment (DigitalOcean VPC)

1. Set `HOST=<vpc-private-ip>` in `.env` on this service's droplet
2. Update `TSM_SERVICE_1_ENDPOINT=http://<vpc-private-ip>:3001` in the orchestrator's `.env`
3. Restrict the port: `sudo ufw allow from <orchestrator-vpc-ip> to any port 3001`

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/tsm/announce` | Return unsigned kind 37570 announcement (JSON) |
| `POST` | `/tsm/request` | Accept `{ event, serviceId }`, respond with `text/event-stream` of unsigned events |
| `GET` | `/health` | Health check — returns `{ status: 'ok', serviceId }` |

## Related

- [trustr-service-orchestrator](../trustr-service-orchestrator/) — central key management, signing, and relay routing
- [trustr-semantic-ranking-service](../trustr-semantic-ranking-service/) — sibling service module
- [@graperank/tsm-graperank-library](https://www.npmjs.com/package/@graperank/tsm-graperank-library) — GrapeRank algorithm
- [TSM Specification](../trusted-services-nips/TSM/tsm-trust-service-machines.md)
