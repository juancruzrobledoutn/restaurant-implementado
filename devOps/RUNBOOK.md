# Integrador Production Deployment Runbook

Operational guide for deploying and maintaining Integrador in production.

**Stack**: FastAPI + PostgreSQL + Redis + Nginx (TLS) + Prometheus + Grafana + Loki + Docker Compose
**Capacity**: ~600 concurrent users (2x backend, 2x ws_gateway)

---

## Table of Contents

1. [Pre-deployment Checklist](#1-pre-deployment-checklist)
2. [First-time Deployment](#2-first-time-deployment)
3. [Routine Deployment (Updates)](#3-routine-deployment-updates)
4. [Rollback Procedures](#4-rollback-procedures)
5. [Monitoring Checks](#5-monitoring-checks)
6. [Incident Playbooks](#6-incident-playbooks)
7. [Security Checklist](#7-security-checklist)
8. [Monitoring Quick Reference](#8-monitoring-quick-reference)

---

## 1. Pre-deployment Checklist

Complete every item before proceeding to deployment.

### Infrastructure

- [ ] Server with Docker Engine 24+ and Docker Compose v2 installed
- [ ] Minimum 4 GB RAM, 2 vCPUs (recommended: 8 GB, 4 vCPUs)
- [ ] Ports 80 and 443 open in firewall
- [ ] Domain DNS A record pointing to server's public IP
- [ ] DNS propagation verified: `dig +short yourdomain.com` returns server IP

### Environment Configuration

- [ ] Copy `.env.example` to `.env` in `devOps/`:

```bash
cd devOps
cp .env.example .env
```

- [ ] Edit `.env` and set ALL values (no defaults are safe for production):

```bash
# Generate secrets (run on server)
openssl rand -hex 32   # Use output for JWT_SECRET
openssl rand -hex 32   # Use output for TABLE_TOKEN_SECRET
openssl rand -hex 16   # Use output for POSTGRES_PASSWORD
openssl rand -base64 24  # Use output for GRAFANA_ADMIN_PASSWORD
```

- [ ] Verify these critical values in `.env`:

| Variable | Requirement |
|----------|-------------|
| `POSTGRES_PASSWORD` | Strong, unique password |
| `JWT_SECRET` | At least 32 characters |
| `TABLE_TOKEN_SECRET` | At least 32 characters |
| `DOMAIN` | Your production domain (e.g., `app.myrestaurant.com`) |
| `CERTBOT_EMAIL` | Valid email for Let's Encrypt notifications |
| `ALLOWED_ORIGINS` | `https://yourdomain.com` (with `https://` prefix) |
| `COOKIE_SECURE` | `true` |
| `GRAFANA_ADMIN_PASSWORD` | Strong unique password for Grafana admin UI |
| `ALERTMANAGER_WEBHOOK_URL` | Slack/PagerDuty webhook (optional but recommended) |

- [ ] Verify Alembic migrations are current:

```bash
docker compose exec backend alembic current
docker compose exec backend alembic heads
# Both should output the same revision
```

- [ ] Smoke test health endpoints before routing traffic:

```bash
curl -s http://localhost:8000/api/health | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['status']=='ok', d"
curl -s http://localhost:8001/health | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['status']=='ok', d"
echo "Health checks passed"
```

### Backup

- [ ] If upgrading an existing deployment, take a backup first:

```bash
cd devOps
./backup/backup.sh
```

---

## 2. First-time Deployment

Run all commands from the project root unless otherwise specified.

### Step 1: Clone and configure

```bash
git clone <repository-url> integrador
cd integrador/devOps
cp .env.example .env
# Edit .env with production values (see Pre-deployment Checklist)
```

### Step 2: Obtain SSL certificates

```bash
export DOMAIN=yourdomain.com
export CERT_EMAIL=admin@yourdomain.com

# Optional: test with staging first (avoids rate limits)
# export STAGING=1

bash ssl/init-letsencrypt.sh
```

The script will:
1. Generate a temporary self-signed certificate
2. Start nginx
3. Request a real Let's Encrypt certificate
4. Reload nginx with the production certificate

### Step 3: Start all services

```bash
cd devOps
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Step 4: Apply database migrations

```bash
docker compose exec backend alembic upgrade head
```

### Step 5: Load seed data

```bash
docker compose exec backend python cli.py db-seed
```

This creates: default tenant, test users, allergens, sample menu, and tables.

### Step 6: Verify deployment

```bash
# Check all containers are running
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

# Test health endpoints
curl -s https://yourdomain.com/health | jq .
curl -s https://yourdomain.com/api/health | jq .

# Test HTTP -> HTTPS redirect
curl -sI http://yourdomain.com/ | head -3
# Expected: HTTP/1.1 301 Moved Permanently

# Test SSL certificate
echo | openssl s_client -connect yourdomain.com:443 -servername yourdomain.com 2>/dev/null | openssl x509 -noout -dates
```

### Step 7: Configure automated backups

```bash
# Add to server crontab
crontab -e

# Daily backup at 3:00 AM
0 3 * * * cd /path/to/integrador/devOps && ./backup/backup.sh >> /var/log/integrador-backup.log 2>&1
```

See `devOps/backup/backup-cron.example` for more options.

---

## 3. Routine Deployment (Updates)

Use this procedure for deploying new code changes.

### Step 1: Pull latest code

```bash
cd /path/to/integrador
git fetch origin
git log --oneline HEAD..origin/main   # Review incoming changes
git pull origin main
```

### Step 2: Take a backup (if database migrations are included)

```bash
cd devOps
./backup/backup.sh
```

### Step 3: Rebuild images

```bash
cd devOps
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
```

### Step 4: Apply migrations (if any)

```bash
# Check for pending migrations
docker compose exec backend alembic history --verbose | head -20
docker compose exec backend alembic current

# Apply migrations
docker compose exec backend alembic upgrade head
```

### Step 5: Rolling restart

```bash
cd devOps
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Docker Compose will restart only containers whose images changed.

### Step 6: Verify

```bash
# Check all services are healthy
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

# Tail logs for errors
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=50 backend backend-2 ws_gateway ws_gateway_2

# Test endpoints
curl -s https://yourdomain.com/api/health | jq .
```

---

## 4. Rollback Procedures

### 4.1 Docker image tag rollback (fastest — no rebuild required)

Use this when a new image was pushed but the previous tagged version still exists in the registry.

```bash
# Find the last known-good image tag (look at CI/CD history or docker image ls)
docker image ls integrador-backend --format "{{.Tag}}"

# Edit docker-compose.prod.yml to pin the previous image tag:
#   image: integrador-backend:<previous-tag>
# Then:
cd devOps
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Verify
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
curl -s https://yourdomain.com/api/health | jq .
```

### 4.2 Code rollback (git revert — no migration changes)

Use when there are no database migration changes in the bad commit.

```bash
cd /path/to/integrador
git log --oneline -10                  # Find the previous good commit
git revert HEAD --no-edit              # Revert creates a new commit (safe)
# OR
git checkout <previous-commit-hash>    # Checkout the previous state

cd devOps
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### 4.3 Code + migration rollback (Alembic downgrade)

Use when the bad deploy included database migration changes.

```bash
# 1. Identify current and target revision
cd devOps
docker compose exec backend alembic current
docker compose exec backend alembic history --verbose | head -20

# 2. Rollback migration (one step back)
docker compose exec backend alembic downgrade -1
# Or to a specific revision:
docker compose exec backend alembic downgrade <revision-id>

# 3. Rollback code
cd /path/to/integrador
git checkout <previous-commit-hash>

# 4. Rebuild and restart
cd devOps
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# 5. Verify migration state matches code
docker compose exec backend alembic current
```

### 4.4 Full rollback from backup

If the situation is critical, restore from the last backup:

```bash
cd devOps
./backup/restore.sh backups/<latest-backup-file>.tar.gz
```

The restore script is interactive and will prompt for confirmation. It restores both PostgreSQL and Redis data.

### 4.5 Monitoring stack rollback

The monitoring stack is additive — stopping it does not affect the application.

```bash
# Stop monitoring without affecting backend
cd devOps
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop \
  prometheus grafana loki promtail alertmanager redis-exporter postgres-exporter node-exporter

# Rollback monitoring config (git revert on devOps/monitoring/)
git revert HEAD --no-edit
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d \
  prometheus grafana loki promtail alertmanager redis-exporter postgres-exporter node-exporter
```

---

## 5. Monitoring Checks

### Health endpoints

| Endpoint | Expected | What it checks |
|----------|----------|----------------|
| `GET /health` | `200 {"status":"healthy","service":"nginx"}` | Nginx is running |
| `GET /api/health` | `200` | Backend is responding |
| `GET /api/health/detailed` | `200` with dependency status | Backend + PostgreSQL + Redis |
| `GET /ws/health` | `200` | WebSocket gateway is responding |

```bash
# Quick health check (all endpoints)
curl -s https://yourdomain.com/health | jq .
curl -s https://yourdomain.com/api/health | jq .
curl -s https://yourdomain.com/api/health/detailed | jq .
```

### Expected response times

| Endpoint | Normal | Degraded | Critical |
|----------|--------|----------|----------|
| `/health` | < 5ms | < 50ms | > 100ms |
| `/api/health` | < 50ms | < 200ms | > 500ms |
| `/api/health/detailed` | < 100ms | < 500ms | > 1s |
| REST API (typical) | < 200ms | < 1s | > 2s |
| WebSocket connect | < 100ms | < 500ms | > 1s |

### Container health

```bash
cd devOps

# Check status of all containers
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

# Check resource usage
docker stats --no-stream

# Check logs for errors
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=100 backend 2>&1 | grep -i error
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=100 ws_gateway 2>&1 | grep -i error
```

### Database connectivity

```bash
# PostgreSQL
docker compose exec db pg_isready -U postgres -d menu_ops
# Expected: /var/run/postgresql:5432 - accepting connections

# Redis
docker compose exec redis redis-cli ping
# Expected: PONG

# Redis memory usage
docker compose exec redis redis-cli info memory | grep used_memory_human
```

### SSL certificate expiry

```bash
echo | openssl s_client -connect yourdomain.com:443 -servername yourdomain.com 2>/dev/null \
  | openssl x509 -noout -dates
# Certificates renew automatically; check that expiry is > 30 days out
```

---

## 6. Incident Playbooks

### 6.0 General diagnosis approach

```bash
# Step 1: Check which containers are running
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

# Step 2: Check recent logs for errors
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=50 backend backend-2

# Step 3: Check Grafana dashboards
# http://server-ip:3000  (Grafana admin UI)
# Dashboard "Application Overview" → request rate, error rate, latency
# Dashboard "Infrastructure" → Redis/PG connections, WS connections

# Step 4: Check Alertmanager for active alerts
# Internal: docker compose exec alertmanager wget -qO- http://localhost:9093/#/alerts
```

### 6.1 Backend 503 — service unavailable

**Symptoms**: `curl https://yourdomain.com/api/health` returns 503 or times out.

```bash
# 1. Check container state
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps backend backend-2

# 2. Read recent backend logs
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=100 backend backend-2 2>&1 | grep -iE "error|fatal|exception"

# 3. Check if it's a DB/Redis issue
docker compose exec backend curl -s http://localhost:8000/api/health/detailed | python3 -m json.tool

# 4. If containers are stopped, restart them
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d backend backend-2

# 5. If containers are crash-looping, check startup logs
docker compose logs --tail=200 backend

# 6. If DB connection is failing → see 6.3 (PostgreSQL unreachable)
# 7. If Redis connection is failing → see 6.2 (Redis unreachable)
# 8. If nothing works → rollback to previous image (see section 4.1)
```

### 6.2 Redis unreachable

**Symptoms**: WS connections dropping, events not broadcasting, rate limiting broken.

```bash
# 1. Check Redis container
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps redis

# 2. Ping Redis
docker compose exec redis redis-cli ping
# Expected: PONG

# 3. Check Redis memory (evictions indicate OOM)
docker compose exec redis redis-cli info memory | grep -E "used_memory_human|maxmemory_human|evicted_keys"

# 4. Check Redis logs
docker compose logs --tail=100 redis

# 5. Restart Redis (will clear in-memory state — JWT blacklist, rate limiters, event cache)
# WARNING: Restoring Redis state from appendonly.aof takes time — expect ~30s downtime
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart redis

# 6. After Redis restarts, restart ws_gateway to re-establish subscriptions
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart ws_gateway ws_gateway_2

# 7. Verify
docker compose exec redis redis-cli ping
curl -s https://yourdomain.com/api/health/detailed | python3 -m json.tool
```

### 6.3 PostgreSQL unreachable

**Symptoms**: All API calls fail with 500, backend logs show connection errors.

```bash
# 1. Check PostgreSQL container
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps db

# 2. Check connectivity
docker compose exec db pg_isready -U postgres -d menu_ops

# 3. Check PostgreSQL logs
docker compose logs --tail=100 db | grep -iE "error|fatal|panic"

# 4. Check active connections (may be at max_connections=200)
docker compose exec db psql -U postgres -d menu_ops -c "SELECT count(*) FROM pg_stat_activity;"

# 5. Kill idle connections if saturated
docker compose exec db psql -U postgres -d menu_ops -c "
  SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE state = 'idle' AND state_change < NOW() - INTERVAL '5 minutes';"

# 6. If container is stopped, restart it
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d db

# 7. If data corruption is suspected → restore from backup (see 6.5)
```

### 6.4 TLS certificate expired

**Symptoms**: Browsers show "Certificate has expired", `curl -I https://yourdomain.com` fails.

```bash
# 1. Check certificate dates
echo | openssl s_client -connect yourdomain.com:443 -servername yourdomain.com 2>/dev/null \
  | openssl x509 -noout -dates

# 2. Check certbot container is running (should auto-renew every 12h)
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps certbot

# 3. Force renewal
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm \
  certbot renew --force-renewal

# 4. Reload nginx with new certificate
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec nginx nginx -s reload

# 5. Verify new dates
echo | openssl s_client -connect yourdomain.com:443 -servername yourdomain.com 2>/dev/null \
  | openssl x509 -noout -dates

# If Let's Encrypt rate-limited (too many renewals), use staging temporarily:
#   STAGING=1 bash devOps/ssl/init-letsencrypt.sh
# Or fall back to self-signed for internal access:
#   bash devOps/ssl/generate-selfsigned.sh
```

### 6.5 WebSocket connections dropping

**Symptoms**: Waiters/kitchen staff lose real-time updates, clients constantly reconnecting.

```bash
# 1. Check ws_gateway container health
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps ws_gateway ws_gateway_2

# 2. Check active connections metric (Grafana: Infrastructure dashboard)
# Or via CLI:
curl -s http://localhost:8001/health/detailed | python3 -m json.tool

# 3. Check ws_gateway logs for auth or broadcast errors
docker compose logs --tail=100 ws_gateway 2>&1 | grep -iE "error|disconnect|timeout"

# 4. Check Redis pub/sub (ws_gateway uses Redis for event distribution)
docker compose exec redis redis-cli client list | grep -c "name=ws"

# 5. Check DLQ size (large DLQ = processing backlog)
docker compose exec redis redis-cli xlen events:dlq

# 6. Check circuit breaker state via metrics endpoint
curl -s "http://localhost:8001/ws/metrics?token=${WS_METRICS_TOKEN}" | python3 -m json.tool

# 7. Restart ws_gateway if circuit breakers are stuck open
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart ws_gateway ws_gateway_2
# Clients will auto-reconnect via the ref pattern in the frontend
```

### 6.6 Database restore from backup

```bash
cd devOps

# List available backups
ls -la backups/

# Restore (interactive — will prompt for confirmation)
./backup/restore.sh backups/integrador_backup_YYYYMMDD_HHMMSS.tar.gz

# Verify after restore
docker compose exec backend alembic current
curl -s https://yourdomain.com/api/health/detailed | jq .
```

### 6.7 Redis flush (when safe)

Only flush Redis when there are no active user sessions. This will:
- Disconnect all WebSocket clients
- Invalidate all JWT blacklist entries
- Clear event catch-up history
- Clear rate limiting counters

```bash
# Check active WebSocket connections first
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=20 ws_gateway | grep -i "connections"

# Flush Redis (all databases)
docker compose exec redis redis-cli FLUSHALL

# Restart services that depend on Redis
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart backend backend-2 ws_gateway ws_gateway_2
```

### 6.8 Force restart all services

```bash
cd devOps
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

If containers are stuck:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml kill
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### 6.9 Disk space emergency

```bash
# Check disk usage
df -h

# Clean Docker resources (unused images, containers, networks)
docker system prune -f

# Clean old backups (keep last 3)
cd devOps/backups
ls -t *.tar.gz | tail -n +4 | xargs rm -f

# Check PostgreSQL size
docker compose exec db psql -U postgres -d menu_ops -c "SELECT pg_size_pretty(pg_database_size('menu_ops'));"
```

---

## 7. Security Checklist

Run this checklist after every deployment and periodically (monthly).

### Secrets

- [ ] `JWT_SECRET` is at least 32 characters and randomly generated
- [ ] `TABLE_TOKEN_SECRET` is at least 32 characters and randomly generated
- [ ] `POSTGRES_PASSWORD` is strong and unique
- [ ] No default/development secrets in `.env` (`dev-secret-change-me` etc.)
- [ ] `.env` file is NOT committed to git (check `.gitignore`)

### Network

- [ ] `ALLOWED_ORIGINS` is set to exact production domain(s) only
- [ ] `DEBUG=false` in `.env`
- [ ] `ENVIRONMENT=production` in `.env`
- [ ] `COOKIE_SECURE=true` in `.env`
- [ ] pgAdmin is disabled (uses `debug` profile, not started by default)
- [ ] PostgreSQL port (5432) is NOT exposed to public internet
- [ ] Redis port (6379/6380) is NOT exposed to public internet

### SSL/TLS

- [ ] SSL certificate is valid and not expired
- [ ] HTTP redirects to HTTPS (test: `curl -sI http://yourdomain.com/`)
- [ ] HSTS header is present (test: `curl -sI https://yourdomain.com/ | grep -i strict`)
- [ ] Only TLSv1.2 and TLSv1.3 are enabled
- [ ] Certificate auto-renewal is working (certbot container is running)

### Application

- [ ] Default test user passwords have been changed or accounts removed
- [ ] Rate limiting is active on auth endpoints
- [ ] WebSocket origin validation is configured
- [ ] Server tokens are hidden (`server_tokens off` in nginx)

### Verification commands

```bash
# Check secrets are not defaults
grep -c "CHANGE_ME\|dev-secret\|change-me" devOps/.env
# Expected: 0

# Check TLS configuration
nmap --script ssl-enum-ciphers -p 443 yourdomain.com

# Check security headers
curl -sI https://yourdomain.com/api/health | grep -iE "strict-transport|x-frame|x-content-type|referrer-policy"
# Expected: All four headers present

# Check HTTP redirect
curl -sI http://yourdomain.com/ | head -1
# Expected: HTTP/1.1 301 Moved Permanently

# Check debug mode is off
curl -s https://yourdomain.com/api/nonexistent-endpoint | jq .
# Should NOT include stack traces or debug information
```

---

## 8. Monitoring Quick Reference

### 8.1 URLs

| Service | URL | Notes |
|---------|-----|-------|
| Grafana | `http://server-ip:3000` | Admin login: `GRAFANA_ADMIN_PASSWORD` from .env |
| Prometheus | Internal only | Access via `docker compose exec prometheus wget -qO- http://localhost:9090` |
| Alertmanager | Internal only | Access via `docker compose exec alertmanager wget -qO- http://localhost:9093` |
| Loki | Internal only | Queried via Grafana Explore |
| Backend metrics | `http://server-ip:8000/metrics` | Prometheus text format |
| WS Gateway metrics | `http://server-ip:8001/metrics` | Prometheus text format |

### 8.2 Grafana dashboards

- **Application Overview** — requests/s by status, p50/p95/p99 latency, 5xx/4xx rates, WS connections and message rates
- **Infrastructure** — Redis memory/clients/cache hits, PostgreSQL connections/transactions, WS active connections

### 8.3 Common LogQL queries (Grafana Explore → Loki)

```logql
# All backend logs for the last 15 minutes
{service="backend"}

# All backend ERROR logs
{service="backend", level="ERROR"}

# Backend logs for a specific request (correlation)
{service="backend"} | json | request_id = "abc-123-def-456"

# All logs for a specific tenant
{job="integrador"} | json | tenant_id = "1"

# High-latency requests (logged by backend)
{service="backend"} | json | line_format "{{.message}}" | = "slow_query"

# WebSocket errors
{service="ws_gateway", level="ERROR"}

# Nginx 5xx errors
{service="nginx"} | = " 5" | pattern `<ip> - <user> [<time>] "<method> <path> <proto>" <status> <bytes>`
```

### 8.4 Common PromQL queries (Grafana Explore → Prometheus)

```promql
# Current request rate (total across all backends)
sum(rate(http_requests_total{job="backend"}[5m]))

# 5xx error rate as percentage
sum(rate(http_requests_total{job="backend", status=~"5.."}[5m]))
/ sum(rate(http_requests_total{job="backend"}[5m])) * 100

# p95 latency (should be < 2s)
histogram_quantile(0.95,
  sum by (le) (rate(http_request_duration_seconds_bucket{job="backend"}[5m]))
)

# Active WebSocket connections
sum(websocket_connections_active{job="ws_gateway"})

# Redis memory usage
redis_memory_used_bytes{job="redis"}

# PostgreSQL active connections
sum(pg_stat_activity_count{job="postgres", state="active"})

# Rate-limited requests (429) per minute
sum(rate(http_requests_total{job="backend", status="429"}[1m])) * 60

# Backend health (1 = up, 0 = down — for each instance)
up{job="backend"}
```

---

## Appendix: Service Architecture

```
Internet
  │
  ├─ :80  ──→ Nginx ──→ 301 redirect to :443
  │
  └─ :443 ──→ Nginx (SSL termination)
                ├─ /api/*  ──→ backend_1:8000 (least_conn)
                │              backend_2:8000
                ├─ /ws/*   ──→ ws_gateway_1:8001 (ip_hash)
                │              ws_gateway_2:8001
                └─ /health ──→ local 200

Internal:
  backend ──→ PostgreSQL :5432
  backend ──→ Redis :6379
  ws_gateway ──→ Redis :6379
  certbot ──→ Let's Encrypt ACME (port 80 challenge)
```

## Appendix: Key File Locations

| File | Purpose |
|------|---------|
| `devOps/.env` | Production secrets (never commit) |
| `devOps/.env.example` | Template for `.env` |
| `devOps/docker-compose.yml` | Base compose (dev) |
| `devOps/docker-compose.prod.yml` | Production overlay (scaling + SSL + monitoring) |
| `devOps/nginx/nginx.conf` | Nginx config (HTTP only, dev) |
| `devOps/nginx/nginx-ssl.conf` | Nginx config (HTTPS, production, Let's Encrypt) |
| `devOps/nginx/nginx-selfsigned.conf` | Nginx config (HTTPS, local dev, self-signed) |
| `devOps/ssl/init-letsencrypt.sh` | SSL certificate bootstrap (Let's Encrypt) |
| `devOps/ssl/generate-selfsigned.sh` | Self-signed certificate generator (local dev) |
| `devOps/certbot/conf/` | Let's Encrypt certificates (created at runtime) |
| `devOps/certbot/www/` | ACME challenge webroot (created at runtime) |
| `devOps/monitoring/loki/loki.yml` | Loki log aggregation config |
| `devOps/monitoring/promtail/promtail.yml` | Promtail Docker log scraping config |
| `devOps/monitoring/prometheus/prometheus.yml` | Prometheus scrape config |
| `devOps/monitoring/prometheus/alerts.yml` | Prometheus alert rules |
| `devOps/monitoring/alertmanager/alertmanager.yml` | Alertmanager routing + webhook config |
| `devOps/monitoring/grafana/provisioning/datasources/` | Grafana auto-provisioned datasources |
| `devOps/monitoring/grafana/provisioning/dashboards/` | Grafana auto-provisioned dashboards |
| `devOps/backup/backup.sh` | Backup script (PostgreSQL + Redis) |
| `devOps/backup/restore.sh` | Restore script (interactive) |
| `devOps/SCALING.md` | Horizontal scaling documentation |

---

## 9. Feature Deploy Checklists

Feature-specific steps required when deploying individual changes.

### C-28 — Dashboard Settings Page

**What changed**: New `/settings` page in Dashboard (branch config, user profile, tenant config). New backend endpoints for branch settings, tenant settings, and password change.

#### Backend

- [ ] Verify Alembic migration `settings_*` is present and applied:
  ```bash
  docker compose exec backend alembic current
  # Should include the C-28 settings migration revision
  ```
- [ ] Confirm endpoint responds before routing traffic:
  ```bash
  # With a valid ADMIN JWT
  curl -s -H "Authorization: Bearer $JWT" \
    http://localhost:8000/api/admin/branches/1/settings
  # Expect 200 with branch settings JSON
  curl -s -H "Authorization: Bearer $JWT" \
    http://localhost:8000/api/admin/tenants/me
  # Expect 200 with tenant name
  ```

#### Frontend

- [ ] Dashboard build includes the `/settings` route (verified via `dist/` bundle or dev server)
- [ ] Navigate to `/settings` as ADMIN — confirm 3 tabs visible (Sucursal, Perfil, Tenant)
- [ ] Navigate to `/settings` as MANAGER — confirm 2 tabs visible (Sucursal, Perfil)
- [ ] Navigate to `/settings` as WAITER/KITCHEN — confirm 1 tab visible (Perfil)
- [ ] Sidebar: Settings link is active (not disabled/grayed out) for all roles

#### Operational

- [ ] **Slug change warning**: Changing a branch slug invalidates the public menu URL (`/api/public/menu/{old-slug}` returns 404). Update any external links (QR codes on tables, social media, Google Maps) pointing to `/{old-slug}` before or immediately after the change.
- [ ] **Timezone change**: Changing a branch timezone affects opening hours display and any scheduled tasks using that branch's local time. Verify with the operator before changing in production.
- [ ] **Password policy**: `POST /api/auth/change-password` returns 400 (not 422) for business-logic errors (wrong current password, same password). Frontend handles this gracefully — no action needed.

#### Rollback

- [ ] If the migration must be rolled back: `docker compose exec backend alembic downgrade -1`
- [ ] The `/settings` route will 404 in the frontend until the old Dashboard build is restored (no data loss — no destructive migrations in C-28)
