# 10. Credenciales y Datos del Staging

## Contexto

Referencia rapida para el equipo: como entrar a cada frontend del staging, que datos hay seedeados, y como regenerar / extender el dataset.

---

## La DB ya tiene datos

Cuando el container `backend` arranca por primera vez (o cualquier subsiguiente), su `CMD` ejecuta:

```sh
alembic upgrade head           # crea o actualiza tablas
python -m rest_api.seeds.runner  # crea tenant, branch, users, sector, mesas, menu
```

Ambos comandos son **idempotentes** — corren cada vez que el container reinicia sin pisar datos existentes (chequean por unique key antes de insertar).

**Lo que el seed base crea:**

| Recurso | Detalle |
|---------|---------|
| Tenant | `Demo Restaurant` (id=1) |
| Branch | `Sucursal Central`, slug=`demo` (id=1, tenant_id=1) |
| Sector | 1 sector base de la branch |
| Mesas | `T01` (4p), `T02` (4p), `T03` (6p) |
| Productos / categorias | menu basico (categoria + subcategoria + productos) |
| Promocion | 1 promocion demo activa |
| Asignacion de waiter | el waiter seedeado queda asignado al sector |

---

## Login — Dashboard y pwaWaiter

Endpoint backend: `POST /api/auth/login`

Body:
```json
{ "email": "...", "password": "..." }
```

Devuelve `access_token` (15 min) + `refresh_token` (7 d). Los frontends manejan storage del token.

**Usuarios seedeados** (todos en `tenant_id=1`, `branch_id=1`):

| Rol | Email | Password | Notas |
|-----|-------|----------|-------|
| **ADMIN** | `admin@demo.com` | `admin123` | Acceso total — Dashboard |
| **MANAGER** | `manager@demo.com` | `manager123` | Staff, mesas, promociones, allergens (en sus branches) |
| **WAITER** | `waiter@demo.com` | `waiter123` | pwaWaiter — gestion de mesas y rondas |
| **KITCHEN** | `kitchen@demo.com` | `kitchen123` | Vista de cocina |

Hash con bcrypt 12 rounds, generado al runtime — los hashes son siempre validos. NO sirve mirar la columna `hashed_password` para descifrar — se valida por comparacion.

---

## pwaMenu — sin login, con Table Token

pwaMenu NO tiene email/password. El comensal entra a la mesa con un **Table Token** firmado HMAC con TTL de 3 horas.

### Flow normal

1. Waiter entra a pwaWaiter con sus credenciales (`waiter@demo.com / waiter123`).
2. Selecciona una mesa (T01 / T02 / T03) y la "activa" / "abre sesion".
3. El backend genera el Table Token y devuelve la URL completa al pwaMenu — algo como:
   ```
   https://<pwamenu-vercel-url>/?token=<jwt-table-token>
   ```
4. Waiter muestra la URL al comensal (en produccion, codigo QR; en staging, podes copiar la URL y abrirla en otra ventana o celular para simular).
5. pwaMenu carga con el contexto de esa mesa especifica.

### Flow de testing rapido

Si necesitas saltarte el waiter y generar un Table Token directamente para testing, opciones a chequear segun como este armado el backend:

- Endpoint admin: revisar si existe `POST /api/admin/tables/{id}/token` o similar (consultar `02-arquitectura/03_api_y_endpoints.md`).
- Curl con autenticacion JWT del admin para generar tokens manualmente.
- En el futuro, si el equipo testea seguido, agregar un endpoint de dev `/api/dev/quick-token/{table_code}` con TTL extendido (NO usar en prod).

---

## Regenerar / extender datos

### Regenerar todo desde cero

⚠️ **Destructivo** — borra todos los datos del staging.

En el VPS via SSH:

```bash
# Identificar el volumen de la DB del staging
docker volume ls | grep integrador_pgdata_staging

# Detener el container del backend antes de tocar el volumen
docker stop integrador_db_staging integrador_backend_staging integrador_ws_gateway_staging

# Eliminar el volumen (tira todos los datos)
docker volume rm integrador_pgdata_staging

# Reiniciar via EasyPanel (Deploy de nuevo)
# El backend al subir corre alembic + seed runner sobre DB vacia
```

Resultado: misma data seed, pero TODO lo que el equipo cargo manualmente se pierde.

### Agregar dataset rico para demos (`--full`)

El seed runner soporta un flag `--full` que agrega:

- Allergens extra y links a productos
- Sesion T01 OPEN con 2 comensales y rondas (SERVED + IN_KITCHEN)
- Sesion T02 PAYING con pago parcial
- 2 service calls (uno ACKED, uno CREATED)
- 3 sesiones historicas CLOSED para que el dashboard de Sales tenga ventas que mostrar

**⚠️ El comentario del runner dice "DEV ONLY — never run against staging or production"**. Para staging interno con tu equipo lo podes correr a discrecion (no es prod), pero tene presente que mete datos de fixtures que no se borran solos.

Para correrlo en staging via SSH:

```bash
# Entrar al container del backend
docker exec -it integrador_backend_staging sh

# Dentro del container (WORKDIR ya es /app)
python -m rest_api.seeds.runner --full
```

### Cargar tu propia data

Para datos especificos de tu test (ej: 50 productos custom, sesiones particulares), las opciones son:

1. **Via Dashboard (UI)** — login admin/manager, crear desde la UI. Ideal para testing manual del equipo.
2. **Via SQL directo** — `docker exec -it integrador_db_staging psql -U integrador -d integrador_staging` y SQL a mano. Solo si sabes lo que hacer (multi-tenant, foreign keys, tenant_id en cada tabla).
3. **Crear un seed extra** — agregar `backend/rest_api/seeds/<tu_seed>.py` y llamarlo desde `runner.py`. Versiona con el repo, idempotente.

---

## Referencias

- `backend/rest_api/seeds/runner.py` — entry point del seed
- `backend/rest_api/seeds/tenants.py` — define tenant + branch (slug `demo`)
- `backend/rest_api/seeds/users.py` — define los 4 users con roles
- `backend/rest_api/seeds/demo_data.py` — sector, mesas (T01-T03), menu base
- `backend/rest_api/seeds/staff_management.py` — promocion + asignacion waiter
- `backend/rest_api/seeds/demo_full.py` — dataset rico opcional con `--full`
- Auth backend: `03-seguridad/01_modelo_de_seguridad.md`
- Endpoints API: `02-arquitectura/03_api_y_endpoints.md`
