## ⚠️ Contexto de estas métricas

Estas métricas corresponden al sistema jr2 **EXISTENTE** antes de la reconstrucción desde cero.
Al desarrollar desde BaseJR, el proyecto empieza **VACÍO**.
Las métricas son referencia de la escala **OBJETIVO**, no del estado actual.

---

> Creado: 2026-04-04 | Actualizado: 2026-04-05 | Estado: vigente

# Metricas del Proyecto

Metricas cuantitativas completas del proyecto Integrador, incluyendo conteos de codigo, distribucion por componente, ratios de calidad y metricas de infraestructura.

---

## Metricas generales

| Metrica | Valor |
|---------|-------|
| Total archivos de codigo | 649 |
| Total lineas de codigo | 130,561 |
| Lenguajes principales | Python (237 archivos), TypeScript (152), TSX (142) |
| Componentes del monorepo | 5 (backend, ws_gateway, Dashboard, pwaMenu, pwaWaiter) |

### Distribucion por lenguaje

| Lenguaje | Archivos | Porcentaje (archivos) |
|----------|----------|-----------------------|
| Python | 237 | 36.5% |
| TypeScript (.ts) | 152 | 23.4% |
| TypeScript JSX (.tsx) | 142 | 21.9% |
| Markdown | 75 | 11.6% |
| YAML/JSON/Config | 43 | 6.6% |

---

## Backend (rest_api + shared)

| Metrica | Valor |
|---------|-------|
| Archivos Python | 237 |
| Lineas de codigo | 48,833 |
| Endpoints REST | 161 |
| Modelos SQLAlchemy | 55 |
| Servicios de dominio | 14+ |
| Archivos de test | 20 |
| Dependencias (pip) | 18 |

### Distribucion de endpoints por metodo HTTP

| Metodo | Cantidad | Porcentaje |
|--------|----------|------------|
| GET | 78 | 48.4% |
| POST | 47 | 29.2% |
| DELETE | 18 | 11.2% |
| PATCH | 16 | 9.9% |
| PUT | 2 | 1.2% |
| **Total** | **161** | **100%** |

### Servicios de dominio

| Servicio | Responsabilidad |
|----------|-----------------|
| CategoryService | CRUD de categorias por tenant |
| SubcategoryService | CRUD de subcategorias |
| BranchService | Gestion de sucursales |
| SectorService | Sectores dentro de sucursales |
| TableService | Mesas y sesiones |
| ProductService | Productos con precios por sucursal |
| AllergenService | Alergenos y asociaciones |
| StaffService | Personal y asignaciones |
| PromotionService | Promociones y descuentos |
| RoundService | Rondas de pedidos y lifecycle |
| BillingService | Cuentas, cargos y pagos |
| DinerService | Comensales y carritos |
| ServiceCallService | Llamadas de servicio |
| TicketService | Tickets de cocina |

---

## WebSocket Gateway (ws_gateway)

| Metrica | Valor |
|---------|-------|
| Lineas de codigo | 12,635 |
| Tipos de eventos | 24 |
| Endpoints WS | 4 |
| Componentes modulares | 15+ |
| Workers de broadcast | 10 (paralelos) |
| Capacidad objetivo | 400+ usuarios concurrentes |

### Componentes arquitecturales

| Componente | Descripcion |
|------------|-------------|
| ConnectionManager | Orquestador de conexiones |
| RedisSubscriber | Consumidor de Redis Streams |
| BroadcastRouter | Enrutamiento de mensajes por rol |
| EventRouter | Clasificacion y distribucion de eventos |
| JWTAuthStrategy | Autenticacion JWT para staff |
| TableTokenAuthStrategy | Autenticacion de comensales |
| RateLimiter | Limite de mensajes por conexion |
| CircuitBreaker | Proteccion contra fallos en cascada |
| ConnectionLifecycle | Manejo del ciclo de vida de conexiones |
| ConnectionBroadcaster | Envio eficiente a multiples clientes |

---

## Dashboard

| Metrica | Valor |
|---------|-------|
| Lineas de codigo | 34,840 |
| Componentes React | 32 |
| Paginas/vistas | 34 |
| Stores Zustand | 22 |
| Hooks custom | 16 |
| Archivos de test | 4 |
| Dependencias (npm) | 8 |

### Distribucion de stores Zustand

Los 22 stores cubren: autenticacion, branches, categorias, subcategorias, productos, alergenos, mesas, sectores, staff, promociones, recetas, ingredientes, pedidos, cocina, facturacion, clientes, UI, notificaciones, WebSocket, filtros, busqueda y configuracion.

---

## pwaMenu

| Metrica | Valor |
|---------|-------|
| Lineas de codigo | 22,266 |
| Componentes React | 52 |
| Paginas/vistas | 3 |
| Stores Zustand | 11 |
| Hooks custom | 25 |
| Archivos de test | 5 |
| Dependencias (npm) | 9 |
| Idiomas i18n | 3 (es, en, pt) |

### Detalle i18n

| Idioma | Codigo | Cobertura |
|--------|--------|-----------|
| Espanol | es | 100% (base) |
| Ingles | en | 100% |
| Portugues | pt | 100% |

**Politica:** Zero hardcoded strings — todo texto visible al usuario usa `t()`.

---

## pwaWaiter

| Metrica | Valor |
|---------|-------|
| Lineas de codigo | 11,987 |
| Componentes React | 15 |
| Paginas/vistas | 7 |
| Stores Zustand | 7 |
| Hooks custom | 4 |
| Archivos de test | 3 |
| Dependencias (npm) | 8 |

---

## Infraestructura

| Metrica | Valor |
|---------|-------|
| Servicios Docker | 5 |
| Workflows CI/CD | 2 |
| Archivos Markdown | 75 |
| Documentos Knowledge Base | 45 |
| Cadena de migraciones Alembic | 001 → 011 (11 migraciones) |

### Servicios Docker (docker-compose)

| Servicio | Imagen | Puerto expuesto |
|----------|--------|-----------------|
| db | PostgreSQL | 5432 |
| redis | Redis | 6380 |
| backend | Python/FastAPI | 8000 |
| ws_gateway | Python/Uvicorn | 8001 |
| pgadmin | pgAdmin 4 | 5050 |

### Workflows CI/CD

| Workflow | Archivo | Proposito |
|----------|---------|-----------|
| CI | ci.yml | Tests, lint, type-check en cada PR (4 jobs paralelos) |
| Docker Build | docker-build.yml | Validacion de build de imagenes Docker |

---

## Ratios y metricas derivadas

### Distribucion de codigo

| Componente | Lineas | Porcentaje del total |
|------------|--------|----------------------|
| Backend (rest_api + shared) | 48,833 | 37.4% |
| Dashboard | 34,840 | 26.7% |
| pwaMenu | 22,266 | 17.1% |
| ws_gateway | 12,635 | 9.7% |
| pwaWaiter | 11,987 | 9.2% |
| **Total** | **130,561** | **100%** |

### Ratio backend/frontend

```
Backend total:  48,833 + 12,635 = 61,468 lineas (47.1%)
Frontend total: 34,840 + 22,266 + 11,987 = 69,093 lineas (52.9%)
Ratio B/F: 0.89x (backend es ~47% del total de codigo)
```

### Cobertura de tests

| Componente | Archivos de test | Archivos de codigo | Ratio |
|------------|------------------|--------------------|-------|
| Backend | 20 | 237 | 1:11.9 |
| Dashboard | 4 | ~90 | 1:22.5 |
| pwaMenu | 5 | ~77 | 1:15.4 |
| pwaWaiter | 3 | ~26 | 1:8.7 |
| **Total** | **32** | **~430** | **1:13.4** |

### Densidad de endpoints

```
Endpoints por modelo: 161 / 55 = 2.93 endpoints por modelo (promedio)
Endpoints por archivo Python: 161 / 237 = 0.68 endpoints por archivo
```

### Complejidad de frontend

| Metrica | Dashboard | pwaMenu | pwaWaiter |
|---------|-----------|---------|-----------|
| Componentes | 32 | 52 | 15 |
| Stores | 22 | 11 | 7 |
| Hooks | 16 | 25 | 4 |
| Paginas | 34 | 3 | 7 |
| Lineas/componente | 1,089 | 428 | 799 |
| Stores/pagina | 0.65 | 3.67 | 1.0 |
| Hooks/componente | 0.50 | 0.48 | 0.27 |

### Observaciones de los ratios

- **Dashboard** es la app mas compleja en terminos de paginas (34) y stores (22), coherente con su rol de panel de administracion multi-entidad.
- **pwaMenu** tiene la mayor cantidad de componentes (52) y hooks (25), reflejando una UI rica con carrito compartido, i18n y multiples interacciones de comensal.
- **pwaWaiter** es la mas compacta, enfocada en eficiencia operativa para el mozo con menos pantallas pero funcionalidad critica.
- El ratio de **tests por componente** es bajo en todos los frontends, siendo un area de mejora prioritaria.
- El backend tiene la mejor cobertura relativa (1:11.9), pero aun por debajo del ideal para un sistema con endpoints financieros.

---

## Metricas de modelo de datos

| Metrica | Valor |
|---------|-------|
| Modelos SQLAlchemy | 55 |
| Relaciones M:N | 8+ (UserBranchRole, ProductAllergen, etc.) |
| Entidades con soft delete | ~45 (is_active flag) |
| Entidades efimeras (hard delete) | ~10 (CartItem, sessions expiradas) |
| Tablas con nombre SQL reservado | 1 (Check → app_check) |

### Jerarquia principal del modelo

```
Tenant (1)
  ├─ Branch (N)
  │   ├─ Category (N) → Subcategory (N) → Product (N)
  │   ├─ BranchSector (N) → Table (N) → TableSession → Diner (N)
  │   └─ Check → Charge → Allocation ← Payment
  ├─ Catalogos tenant-scoped (4): CookingMethod, FlavorProfile, TextureProfile, CuisineType
  └─ IngredientGroup → Ingredient → SubIngredient

User ←→ UserBranchRole (M:N)
Product ←→ BranchProduct (precios por sucursal)
Product ←→ ProductAllergen (M:N con presence_type + risk_level)
Customer ←→ Diner (1:N via customer_id)
```

---

## Metricas de eventos

| Metrica | Valor |
|---------|-------|
| Tipos de eventos WebSocket | 24 |
| Eventos via Outbox (criticos) | 6 |
| Eventos via Direct Redis | 18 |
| Canales WebSocket | 4 (waiter, kitchen, admin, diner) |
| Rate limit WS | 30 msg/seg por conexion |
| Heartbeat | cada 30 segundos |
| Timeout servidor | 60 segundos |
