# Load Testing - Integrador

k6 load tests for validating the system handles 600+ concurrent users.

## Prerequisites

Install k6:

```bash
# macOS
brew install k6

# Windows (Chocolatey)
choco install k6

# Docker (no install needed)
docker run --rm -i grafana/k6 run - <k6-rest-api.js
```

## Configuration

```bash
cp .env.example .env
# Edit .env with your target environment URLs and credentials
```

Environment variables can also be passed inline:

```bash
k6 run -e BASE_URL=https://api.myrestaurant.com k6-rest-api.js
```

## Running Tests

### REST API Load Test

Tests public menu, auth, admin, kitchen, and waiter endpoints with weighted traffic distribution.

```bash
# Basic run (11 minutes, ramps to 200 VUs)
k6 run k6-rest-api.js

# Export results to JSON for analysis
k6 run --out json=results-rest.json k6-rest-api.js

# Quick smoke test (override stages to 10 VUs for 30s)
k6 run --vus 10 --duration 30s k6-rest-api.js
```

### WebSocket Load Test

Tests persistent WebSocket connections with heartbeat and event tracking.

```bash
# Full run (15 minutes, ramps to 400 connections)
k6 run k6-websocket.js

# Export results
k6 run --out json=results-ws.json k6-websocket.js
```

### Both Tests via Docker

```bash
# REST API
docker run --rm --network host \
  -v $(pwd):/scripts \
  -e BASE_URL=http://localhost:8000 \
  grafana/k6 run /scripts/k6-rest-api.js

# WebSocket
docker run --rm --network host \
  -v $(pwd):/scripts \
  -e WS_URL=ws://localhost:8001 \
  -e BASE_URL=http://localhost:8000 \
  grafana/k6 run /scripts/k6-websocket.js
```

## Target Metrics

### REST API

| Metric | Threshold | What it means |
|--------|-----------|---------------|
| `http_req_duration` p95 | < 500ms | 95% of requests complete in under 500ms |
| `errors` rate | < 1% | Less than 1% of requests fail |
| `menu_fetch_duration` p95 | < 300ms | Public menu is fast (should be cached in Redis) |
| `login_duration` p95 | < 800ms | Login is slower due to bcrypt, but still acceptable |

### WebSocket

| Metric | Threshold | What it means |
|--------|-----------|---------------|
| `ws_connection_success` | > 99% | Almost all connections establish successfully |
| `ws_message_latency` p95 | < 200ms | Messages delivered within 200ms |
| `ws_connection_time` p95 | < 2000ms | Connections established within 2 seconds |
| `ws_disconnections` | < 20 total | Very few unexpected disconnects |

## Interpreting Results

k6 prints a summary table at the end. Key columns:

- **avg**: Average value
- **p(90)** / **p(95)**: 90th/95th percentile (the numbers that matter most)
- **max**: Worst case (spikes)

Example output:

```
  http_req_duration...........: avg=120ms  p(95)=380ms  max=1.2s
  errors......................: 0.23%
  menu_fetch_duration.........: avg=45ms   p(95)=180ms
```

## When Thresholds Fail

### `http_req_duration` p95 > 500ms

- **Check database**: Slow queries? Run `EXPLAIN ANALYZE` on category/product queries
- **Check Redis**: Is menu caching working? Look at `menu_cache_hits` vs `menu_cache_misses`
- **Check workers**: Are 4 FastAPI workers enough? Monitor CPU usage
- **Fix**: Add database indexes, increase Redis cache TTL, add more workers

### `errors` rate > 1%

- **Check logs**: `docker compose logs backend` for 500 errors
- **Check rate limiting**: Login endpoint is rate-limited (5/min). Some 429s are expected
- **Check connections**: PostgreSQL `max_connections` might be too low for the load

### `ws_connection_success` < 99%

- **Check WS Gateway memory**: Each connection is in-memory. Monitor RAM usage
- **Check file descriptors**: OS limit on open connections (`ulimit -n`)
- **Fix**: Increase `ulimit`, add WS Gateway replicas (requires sticky sessions)

### `ws_disconnections` too high

- **Check close codes in logs**: 4001 = auth expired, 4029 = rate limited
- **Token expiry**: JWT tokens expire after 15 minutes. Long tests need token refresh
- **Fix**: Implement token refresh in the test or use longer-lived tokens for testing

## Traffic Distribution (REST API)

The test simulates realistic traffic patterns:

| Scenario | Weight | Description |
|----------|--------|-------------|
| Public menu | 60% | Customers browsing the menu (highest traffic, should be cached) |
| Auth login | 5% | Staff logging in (rate-limited, uses bcrypt) |
| Admin categories | 15% | Dashboard admin operations |
| Kitchen rounds | 10% | Kitchen checking order queue |
| Waiter tables | 10% | Waiters checking table status |

## Production Testing

For production environments:

1. Use dedicated test tenant/branch to avoid polluting real data
2. Run during off-peak hours
3. Monitor server metrics (CPU, RAM, DB connections) alongside k6 results
4. Start with lower VU counts and increase gradually

```bash
# Conservative production test
k6 run -e BASE_URL=https://api.prod.example.com \
       --stage '1m:20,3m:20,1m:0' \
       k6-rest-api.js
```
