> Creado: 2026-04-04 | Actualizado: 2026-04-05 | Estado: vigente

# Onboarding de Desarrollador

Guia paso a paso para tener el sistema funcionando desde cero.

---

## Prerequisitos

| Herramienta | Version minima | Proposito |
|-------------|---------------|-----------|
| Docker Desktop | 4.x | PostgreSQL, Redis, backend (opcion A) |
| Node.js | 22+ | Frontends (Dashboard, pwaMenu, pwaWaiter) |
| Python | 3.12+ | Backend manual (opcion B) |
| Git | 2.x | Control de versiones |

---

## Opcion A: Todo con Docker (~5 minutos)

```bash
git clone <repo>
cd jr2

# 1. Copiar .env files
cp backend/.env.example backend/.env
cp Dashboard/.env.example Dashboard/.env
cp pwaMenu/.env.example pwaMenu/.env
cp pwaWaiter/.env.example pwaWaiter/.env
cp devOps/.env.example devOps/.env

# 2. Levantar servicios backend
cd devOps && docker compose up -d --build
# Esperar: PostgreSQL health check (~30s), Redis (~5s)

# 3. Seed de datos
docker compose exec backend python cli.py db-seed

# 4. Levantar frontends (3 terminales)
cd ../Dashboard && npm install && npm run dev   # :5177
cd ../pwaMenu && npm install && npm run dev     # :5176
cd ../pwaWaiter && npm install && npm run dev   # :5178
```

---

## Opcion B: Backend manual (~10 minutos)

```bash
# 1. Solo DB + Redis en Docker
docker compose -f devOps/docker-compose.yml up -d db redis

# 2. Backend Python
cd backend && pip install -r requirements.txt
python -m uvicorn rest_api.main:app --reload --port 8000

# 3. WS Gateway (terminal separada, desde raiz del proyecto)
# Windows PowerShell:
$env:PYTHONPATH = "$PWD\backend"
python -m uvicorn ws_gateway.main:app --reload --port 8001

# 4. Frontends (igual que Opcion A)
```

> **Nota Windows:** Usar siempre `python -m uvicorn` en vez de `uvicorn` directo. El ejecutable puede no estar en PATH.

---

## Verificacion

Una vez levantado todo, verificar que cada servicio responda:

| URL | Resultado esperado |
|-----|-------------------|
| http://localhost:8000/api/health | `{"status": "healthy"}` |
| http://localhost:8001/ws/health | `{"status": "healthy"}` |
| http://localhost:5177 | Dashboard — pantalla de login |
| http://localhost:5176 | pwaMenu — simulador QR |
| http://localhost:5178 | pwaWaiter — seleccion de sucursal |

---

## Usuarios de prueba

| Email | Password | Rol | Que puede hacer |
|-------|----------|-----|-----------------|
| admin@demo.com | admin123 | ADMIN | Todo: CRUD completo, gestion de staff, configuracion |
| waiter@demo.com | waiter123 | WAITER | Gestion de mesas, tomar pedidos, cobrar |
| kitchen@demo.com | kitchen123 | KITCHEN | Ver pedidos en cocina, marcar como listos |
| ana@demo.com | ana123 | WAITER | Igual que waiter@demo.com (segundo mozo) |
| alberto.cortez@demo.com | waiter123 | WAITER | Igual que waiter@demo.com (tercer mozo) |

---

## Puertos clave

| Servicio | Puerto | Protocolo |
|----------|--------|-----------|
| REST API | 8000 | HTTP |
| WebSocket Gateway | 8001 | WS |
| Redis | 6380 (externo) / 6379 (interno Docker) | TCP |
| PostgreSQL | 5432 | TCP |
| pgAdmin | 5050 | HTTP |
| Dashboard | 5177 | HTTP |
| pwaMenu | 5176 | HTTP |
| pwaWaiter | 5178 | HTTP |

---

## Primer feature de practica

Para familiarizarte con todas las capas del sistema, intenta este ejercicio:

> **"Agrega un campo `description` al modelo Allergen y exponelo en el endpoint GET /api/admin/allergens"**

Esto toca todas las capas de la arquitectura:

1. **Modelo SQLAlchemy**: `backend/rest_api/models/` — agregar columna
2. **Migracion Alembic**: `cd backend && alembic revision --autogenerate -m "add allergen description"`
3. **Schema Pydantic**: `backend/shared/utils/admin_schemas.py` — agregar field al output
4. **Servicio de dominio**: `backend/rest_api/services/domain/` — verificar que el servicio lo pasa
5. **Router**: `backend/rest_api/routers/` — verificar que el endpoint devuelve el nuevo campo

---

## Tiempo estimado total

| Escenario | Tiempo |
|-----------|--------|
| Docker images ya descargadas | ~5 minutos |
| Primera vez (descarga de images) | ~10-15 minutos |
| Backend manual + frontends | ~10 minutos |

---

## Troubleshooting rapido

| Problema | Solucion |
|----------|----------|
| `ModuleNotFoundError: No module named 'shared'` | Setear PYTHONPATH al directorio `backend/` |
| Puerto 5432 ocupado | Otro PostgreSQL corriendo. Parar o cambiar puerto en docker-compose |
| `npm install` falla | Verificar Node.js 22+. Borrar `node_modules/` y reintentar |
| Backend no recarga cambios | Windows StatReload issue. Reiniciar uvicorn manualmente |
| pwaMenu muestra 404 | Verificar `VITE_API_URL` y `VITE_BRANCH_SLUG` en `.env` |
