# Security policy

Report vulnerabilities privately to the Easy Online Office maintainers. Do not open a public issue containing credentials, personal information, exploit details or customer data.

## Deployment requirements

- Set a long, random `EASYFILE_API_KEY` for every HTTP deployment.
- Terminate TLS at a trusted reverse proxy and never publish port 3000 directly.
- Set `EASYFILE_ALLOWED_ORIGINS` when browser clients are used.
- Set `EASYFILE_ALLOWED_HOSTS` whenever binding to a non-loopback interface to prevent DNS rebinding.
- Store secrets in the deployment platform's secret manager, not `.env` in source control.
- Back up and encrypt the data volume. Restrict it to the service identity.
- Put internet-facing deployments behind rate limiting, request-size limits and central audit logging.
- Rotate integration tokens and webhook secrets regularly.

The bundled JSON store is intended for a single-process pilot. Use a transactional, tenant-aware database before multi-user production deployment.
