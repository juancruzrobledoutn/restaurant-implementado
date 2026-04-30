# Escalamiento Horizontal - Integrador

## Arquitectura Actual (Instancia Unica)

```
Cliente
  ├── :8000 → Backend (FastAPI, 1 instancia, modo dev con --reload)
  ├── :8001 → WS Gateway (1 instancia, modo dev con --reload)
  ├── :5432 → PostgreSQL
  └── :6380 → Redis
```

Todos los servicios corren como contenedores Docker individuales orquestados con `docker-compose.yml`. Esta configuracion soporta desarrollo local y despliegues de baja concurrencia (~100-200 usuarios).

---

## Estrategia de Escalamiento

### Objetivo: 600 usuarios concurrentes

Basado en benchmarks del WS Gateway (400+ usuarios por instancia con worker pool de 10 workers), la estrategia es:

| Componente | Instancias | Justificacion |
|------------|-----------|---------------|
| Backend (REST API) | 2 x 4 workers | Requests HTTP stateless, escala linealmente |
| WS Gateway | 2 x 2 workers | Conexiones WebSocket long-lived, ~300 por instancia |
| PostgreSQL | 1 (con tuning) | Cuello de botella real es conexiones, no CPU |
| Redis | 1 + Sentinel | Pub/sub, blacklist, rate limiting - mas que suficiente |
| Nginx | 1 | Load balancer/reverse proxy |

### Arquitectura Escalada

```
Cliente → Nginx:80
              ├── /api/*  → Backend-1:8000  (round-robin)
              │           → Backend-2:8000
              ├── /ws/*   → WS-Gateway-1:8001  (ip_hash sticky)
              │           → WS-Gateway-2:8001
              └── /health → 200 OK

Redis ← Sentinel (monitoreo + failover automatico)
PostgreSQL (tuning de produccion)
```

---

## Despliegue

### Prerequisitos

1. Crear archivo `.env` en `devOps/` con TODOS los secretos (sin valores por defecto):

```bash
# Base de datos
POSTGRES_DB=menu_ops
POSTGRES_USER=integrador_prod
POSTGRES_PASSWORD=<password-seguro-32-chars>

# JWT y tokens
JWT_SECRET=<secreto-aleatorio-32-chars>
JWT_ISSUER=menu-ops
JWT_AUDIENCE=menu-ops-users
TABLE_TOKEN_SECRET=<secreto-aleatorio-32-chars>
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=15
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7
JWT_TABLE_TOKEN_EXPIRE_HOURS=3

# CORS
ALLOWED_ORIGINS=https://tu-dominio.com,https://admin.tu-dominio.com
```

2. Verificar que existen:
   - `devOps/nginx/nginx.conf`
   - `devOps/redis/sentinel.conf`

### Comandos

```bash
# Desde el directorio devOps/
cd devOps

# Levantar todos los servicios con overlay de produccion
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Ver logs de todos los servicios
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f

# Ver logs de un servicio especifico
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f nginx
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f backend backend-2

# Verificar estado
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

# Health check
curl http://localhost/health          # Nginx
curl http://localhost/api/health      # Backend (a traves de nginx)

# Bajar todo
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
```

---

## Nginx - Load Balancing

### REST API (round-robin con least_conn)

Las requests HTTP son stateless. Cada request puede ir a cualquier backend porque:
- La autenticacion es via JWT (verificable en cualquier instancia)
- La sesion se almacena en PostgreSQL (compartida)
- El cache y blacklist estan en Redis (compartido)

Se usa `least_conn` para distribuir carga al servidor con menos conexiones activas.

### WebSocket (ip_hash - sticky sessions)

Las conexiones WebSocket son **long-lived y stateful**. Una vez establecida, la conexion DEBE permanecer en el mismo servidor porque:

1. **Estado en memoria**: Cada instancia del WS Gateway mantiene un `ConnectionManager` con las conexiones activas en RAM
2. **Suscripciones Redis**: Cada instancia se suscribe a canales Redis especificos para sus conexiones
3. **Heartbeat**: El ciclo ping/pong (30s) esta vinculado a la conexion especifica

`ip_hash` garantiza que el mismo IP del cliente siempre se routea al mismo backend. Esto funciona correctamente excepto cuando hay muchos usuarios detras del mismo NAT (ver Limitaciones).

### Rate Limiting

| Zona | Limite | Burst | Aplica a |
|------|--------|-------|----------|
| `api_general` | 10 req/s por IP | 20 | Todos los endpoints `/api/*` |
| `api_auth` | 2 req/s por IP | 5 | Login y refresh (`/api/auth/login`, `/api/auth/refresh`) |
| `ws_connect` | 5 req/s por IP | 10 | Conexiones WebSocket `/ws/*` |

---

## Redis Sentinel

### Que hace

Redis Sentinel monitorea la instancia principal de Redis y ejecuta failover automatico si se cae. En este setup:

- **1 Sentinel** monitorea 1 Redis master (quorum = 1)
- Si Redis no responde en 5 segundos (`down-after-milliseconds`), Sentinel lo marca como caido
- Failover completa en maximo 10 segundos (`failover-timeout`)

### Limitacion actual

Con un unico Sentinel y un unico Redis, NO hay failover real a una replica. El Sentinel sirve como:
1. **Monitoreo**: Detecta caidas y puede notificar
2. **Preparacion**: Cuando se agregue un Redis replica, el failover sera automatico

### Para HA completa (recomendado para produccion real)

```yaml
# Agregar Redis replica y 2 sentinels adicionales
redis-replica:
  image: redis:7-alpine
  command: redis-server --replicaof redis 6379

redis-sentinel-2:
  image: redis:7-alpine
  command: redis-sentinel /etc/redis/sentinel.conf

redis-sentinel-3:
  image: redis:7-alpine
  command: redis-sentinel /etc/redis/sentinel.conf
```

Y cambiar el quorum a 2 en `sentinel.conf`:
```
sentinel monitor integrador-redis redis 6379 2
```

---

## Monitoreo

### Health Checks

```bash
# Nginx (directo)
curl http://localhost/health

# Backend via nginx (verifica que el load balancing funciona)
curl http://localhost/api/health
curl http://localhost/api/health/detailed  # Incluye estado de DB y Redis

# Backend directo (para diagnostico)
curl http://localhost:8000/api/health   # Backend-1
curl http://localhost:8002/api/health   # Backend-2

# WS Gateway directo
curl http://localhost:8001/ws/health    # WS-Gateway-1
curl http://localhost:8003/ws/health    # WS-Gateway-2

# Redis Sentinel
docker exec integrador_redis_sentinel redis-cli -p 26379 sentinel master integrador-redis
```

### Logs

```bash
# Logs de nginx con tiempos de upstream (rt, uct, uht, urt)
docker logs integrador_nginx --tail 100 -f

# Logs combinados de backends
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f backend backend-2

# Logs combinados de WS gateways
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f ws_gateway ws_gateway_2
```

### Metricas clave a monitorear

| Metrica | Donde | Umbral de alarma |
|---------|-------|------------------|
| Request time (p95) | Nginx access log (`rt=`) | > 500ms |
| Upstream response time | Nginx access log (`urt=`) | > 300ms |
| Conexiones WebSocket activas | WS Gateway `/ws/health` | > 250 por instancia |
| Conexiones PostgreSQL | `pg_stat_activity` | > 150 (de 200 max) |
| Memoria Redis | `redis-cli info memory` | > 400MB (de 512MB max) |
| CPU por contenedor | `docker stats` | > 80% sostenido |

---

## Planificacion de Capacidad

### Escenarios

| Usuarios | Backend | WS Gateway | PostgreSQL | Accion |
|----------|---------|------------|------------|--------|
| 0-200 | 1 x 4 workers | 1 x 2 workers | Default | Setup base (docker-compose.yml) |
| 200-600 | 2 x 4 workers | 2 x 2 workers | Tuning | **Este overlay** |
| 600-1200 | 4 x 4 workers | 3 x 2 workers | Read replicas | Agregar replicas, PgBouncer |
| 1200+ | N replicas | N replicas | Cluster | Migrar a Kubernetes |

### Senales de que necesitas mas capacidad

1. **Response time p95 > 1s** en Nginx logs → Agregar backend replica
2. **WebSocket connections > 250/instancia** → Agregar WS Gateway replica
3. **PostgreSQL connections > 80%** → Agregar PgBouncer como connection pooler
4. **Redis memory > 80%** → Aumentar maxmemory o agregar replica

### Para escalar mas alla de 600 usuarios

```bash
# Agregar backend-3
# 1. Copiar la definicion de backend-2 en docker-compose.prod.yml
# 2. Cambiar container_name y port mapping (8004:8000)
# 3. Agregar al upstream en nginx.conf:
#    server integrador_backend_3:8000 max_fails=3 fail_timeout=30s;
# 4. Rebuild nginx: docker compose ... restart nginx
```

---

## Limitaciones Conocidas

### 1. ip_hash con NAT

Si muchos usuarios comparten la misma IP publica (oficina, universidad), todos se routean al mismo WS Gateway. Alternativa: usar cookie-based sticky sessions (requiere cambios en el cliente).

### 2. Sin zero-downtime deploys

Con Docker Compose, actualizar una imagen requiere `down` + `up`. Para rolling updates sin downtime, se necesita Docker Swarm o Kubernetes.

### 3. Single point of failure: Nginx

Si Nginx se cae, todo se cae. Solucion: agregar un segundo Nginx con keepalived/VRRP, o usar un load balancer cloud (ALB, Cloud Load Balancer).

### 4. Single point of failure: PostgreSQL

Una sola instancia de PostgreSQL. Para HA real: PostgreSQL Streaming Replication + Patroni, o un servicio managed (RDS, Cloud SQL).

### 5. Redis sin replica real

El Sentinel actual monitorea pero no puede hacer failover a una replica (no hay replica configurada). Ver seccion "Redis Sentinel" para como agregar una.

### 6. Logs locales

Los logs se pierden si el contenedor se recrea. En produccion, usar un driver de logging (fluentd, journald) o montar volumenes para los logs de Nginx.

### 7. Sin TLS

Esta configuracion sirve HTTP en puerto 80. Para produccion real, agregar certificado TLS en Nginx o usar un reverse proxy externo (Cloudflare, Traefik).

---

## Proximos Pasos: Migracion a Kubernetes

Cuando el sistema supere las capacidades de Docker Compose (~1200 usuarios), la migracion a Kubernetes ofrece:

| Capacidad | Docker Compose | Kubernetes |
|-----------|---------------|------------|
| Auto-scaling | Manual | HPA (automatico basado en CPU/memoria) |
| Rolling updates | Downtime | Zero-downtime |
| Self-healing | `restart: unless-stopped` | Pod restart + reschedule |
| Service discovery | Container names | DNS + Services |
| Secrets management | `.env` file | Sealed Secrets / Vault |
| SSL/TLS | Manual en Nginx | cert-manager (automatico) |
| Observabilidad | Logs manuales | Prometheus + Grafana stack |

### Ruta de migracion sugerida

1. **Docker Swarm** (paso intermedio, reutiliza compose files con `deploy:`)
2. **Kubernetes con Helm charts** (destino final)
3. Servicios managed para DB (RDS/Cloud SQL) y Redis (ElastiCache/Memorystore)
4. Ingress controller (Traefik o nginx-ingress) reemplaza el Nginx manual
