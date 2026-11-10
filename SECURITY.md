# EVO — Security baseline

This repository adds application-layer security controls. It is a baseline, not a certification or a guarantee that the service cannot be compromised.

## Controls included

- Central HTTP security headers, restrictive Content Security Policy, clickjacking protection, MIME sniffing protection, referrer and browser-permission policies, and HSTS in production.
- `X-Powered-By` disabled; no permissive CORS policy is installed.
- Same-origin validation for browser state-changing requests. Set `PUBLIC_ORIGIN=https://your-real-hostname` when running behind a reverse proxy with a different internal Host header.
- Bounded in-memory API and authentication rate limits. These limits are per application process; use a shared edge/WAF or distributed limiter for multi-node deployments.
- Suspicious URL-path probes are rejected and security events are written to `DATA_DIR/security-events.jsonl` with masked IP addresses and bounded event detail. Repeated identical events are throttled.
- API JSON body limit reduced to 2 MiB. Workspace binary upload routes retain their separate configured upload limit.
- Telegram webhook secret comparison uses constant-time comparison.
- Security helper tests cover origin checks, suspicious paths, and IP masking.

## Required production deployment controls

1. Run every user project in a separate, rootless container or equivalent OS sandbox. Enforce CPU, memory, PID, disk, and file-descriptor limits with cgroups v2; application-level counters are not isolation.
2. Do not run the hosting control plane as root. Keep the runner on a dedicated low-privilege account and separate control-plane credentials from project environments.
3. Put the service behind a maintained reverse proxy/WAF with TLS, request-size limits, connection/time limits, and DDoS protection. Set `TRUST_PROXY=1` only when the immediate proxy is trusted and configured to overwrite forwarding headers.
4. Set a unique random `SESSION_SECRET`, strong owner credentials, `TELEGRAM_WEBHOOK_SECRET`, and `PUBLIC_ORIGIN` in the deployment environment. Never commit `.env`, `data/`, session keys, payment evidence, or backups.
5. Keep the host OS, Node.js LTS, dependencies, reverse proxy, and container runtime patched. Review dependency advisories before each production release.
6. Store backups encrypted off-host; restrict restore permissions; test restoration regularly.
7. Restrict outbound network access from tenant workloads. Do not expose the Docker socket, host filesystem, cloud metadata service, or control-plane network to projects.
8. Use a shared rate limiter and centralized audit storage when running multiple application instances. The included in-memory limiter is process-local and resets on restart.
9. Configure alert delivery and monitor disk capacity for audit logs. Security notifications are best-effort and must not be the only monitoring channel.
10. Run the security tests and a separate authorized penetration test against a staging deployment before accepting real customer data or payments.

## Tests

```bash
npm run test:security
```

## Known limitations

- No application can guarantee 100% protection or prevent copying public HTML, CSS, JavaScript, or other content delivered to a visitor's browser.
- IP-based controls can affect users behind shared carrier NAT. Tune limits for expected traffic and put stronger controls at the edge.
- In-memory rate limits are not shared across workers or nodes.
- HSTS should only be enabled when the public hostname is served exclusively over HTTPS. The production flag enables it; deploy HTTPS first.
- These controls do not replace tenant isolation, OS patching, infrastructure monitoring, or a professional security review.
