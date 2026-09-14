# EasyFile MCP Server

A typed [Model Context Protocol](https://modelcontextprotocol.io/) server for the complete EasyFile suite: CRM, quotes, invoices, purchase orders, sales orders, receipts, job cards, payroll and inventory.

It exposes 30+ validated MCP tools, three resources, guided prompts, atomic local persistence, audit history and a transactional integration outbox. It supports local `stdio` clients and remote Streamable HTTP clients.

## What is included

- CRM customer search and upsert
- Quote, invoice, sales-order and purchase-order lifecycle tools
- Quote → invoice or sales-order conversion with lineage
- Receipt allocation with automatic invoice balance/status updates
- Job-card costing and job → invoice conversion
- Inventory items, stock movements, low-stock search and order application
- Employee records and explicit-rate payroll calculations
- Integration catalog for Shopify, Business Central, Dynamics 365 Sales, Sage, Xero and signed webhooks
- Audit and reliable outbox events on every entity mutation
- Docker image, Compose deployment, CI and protocol tests

See [Architecture](docs/ARCHITECTURE.md) and [Security](SECURITY.md).

## Quick start

Requirements: Node.js 20.11 or later.

```bash
npm ci
npm run build
npm run start:stdio
```

The database defaults to `.easyfile/easyfile.json`. Override it with `EASYFILE_DATA_DIR` or `--data-dir=/path`.

### MCP client configuration

Build the server, then add a local client entry similar to:

```json
{
  "mcpServers": {
    "easyfile": {
      "command": "node",
      "args": ["/absolute/path/to/easyfile-mcp/dist/index.js", "--transport=stdio"],
      "env": {
        "EASYFILE_DATA_DIR": "/absolute/path/to/easyfile-data"
      }
    }
  }
}
```

Use absolute paths so desktop clients do not depend on a shell working directory.

## Remote HTTP

```bash
cp .env.example .env
# Set EASYFILE_API_KEY to a long random value.
npm run build
npm run start:http
```

Endpoints:

- `POST /mcp` — Streamable HTTP MCP endpoint
- `GET /health` — process health

Authenticate MCP requests with `Authorization: Bearer <EASYFILE_API_KEY>`. The default bind address is loopback. Put public deployments behind HTTPS, authentication, rate limiting and request-size controls.

`EASYFILE_ALLOWED_ORIGINS` controls browser origins. `EASYFILE_ALLOWED_HOSTS` validates HTTP Host headers and should be set to the public MCP hostname when binding to `0.0.0.0`.

### Docker Compose

```bash
export EASYFILE_API_KEY="replace-with-a-long-random-secret"
docker compose up --build -d
```

Compose publishes only to `127.0.0.1:3000` and persists data in `easyfile-data`.

## Core tool groups

| Tool group | Examples |
|---|---|
| Platform | `easyfile_modules_list`, `easyfile_summary`, `audit_events_list` |
| CRM | `crm_customer_upsert`, `crm_customer_get`, `crm_customers_list` |
| Commercial | `quote_create`, `invoice_create`, `sales-order_create`, `purchase-order_create` |
| Workflows | `quote_convert`, `receipt_create`, `job-card_convert_to_invoice`, `inventory_apply_order` |
| Job cards | `job-card_create`, `job-cards_list`, `job-card_status_update` |
| Inventory | `inventory_item_upsert`, `inventory_list`, `inventory_adjust` |
| Payroll | `payroll_employee_upsert`, `payroll_run_create`, `payroll_runs_list` |
| Integrations | `integrations_list`, `integration_outbox_list`, `integration_webhook_dispatch` |

Run the MCP Inspector to explore the full generated schemas:

```bash
npx @modelcontextprotocol/inspector node dist/index.js --transport=stdio
```

## Integration events

Every mutation creates an event such as `easyfile.documents.created`. Configure:

```dotenv
EASYFILE_WEBHOOK_URL=https://automation.example.com/easyfile/events
EASYFILE_WEBHOOK_SECRET=replace-with-a-secret
```

Call `integration_webhook_dispatch` to deliver pending events. The server sends:

```text
x-easyfile-signature: sha256=<HMAC-SHA256 of raw body>
x-easyfile-event: easyfile.documents.created
x-easyfile-delivery: <unique event UUID>
```

Consumers must verify the signature against the raw body, deduplicate on the delivery UUID, return 2xx only after durable acceptance, and tolerate retries.

## Development

```bash
npm run typecheck
npm test
npm run build
```

The supplied EasyFile HTML prototypes remain front-end references. This repository is the backend MCP contract; browser `localStorage` is not treated as a production system of record.

## Production evolution

Before a multi-tenant rollout, replace the JSON store with PostgreSQL, add OIDC/OAuth resource-server validation, tenant scoping, role-based tool authorization, idempotency keys, database migrations, object storage for generated documents and a background outbox worker. Preserve the MCP schemas so connected agents do not need to be retrained.

The repository's `CNAME` is metadata for `mcp.easyfile.co.za`; GitHub Pages cannot execute this Node.js MCP service. Point that hostname at a container or Node runtime (for example Azure Container Apps, Azure App Service, Cloud Run, Fly.io or a managed Kubernetes ingress) and proxy HTTPS traffic to `/mcp`.

## License

MIT © 2026 Easy File.
