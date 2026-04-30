> Creado: 2026-04-05 | Actualizado: 2026-04-05 | Estado: vigente

# Estrategia de Testing

Filosofia, herramientas, patrones y configuracion de tests en todo el sistema Integrador.

---

## Filosofia

### Que testear

| Prioridad | Que | Por que |
|-----------|-----|---------|
| **Alta** | Logica de negocio (servicios de dominio) | Es el core del sistema — errores aqui impactan usuarios |
| **Alta** | Stores Zustand (estado + acciones) | Manejan estado critico: auth, pedidos, mesas |
| **Alta** | Flujos de autenticacion y permisos | Seguridad — un bug puede exponer datos de otros tenants |
| **Media** | Integracion API (router + servicio + BD) | Verifica que las capas se conectan correctamente |
| **Media** | Componentes con logica condicional | Renderizado basado en estado, permisos, roles |
| **Baja** | Componentes presentacionales puros | Poco valor — solo renderizan props |

### Que NO testear

- **Detalles de implementacion**: no testear si un componente usa `useState` internamente.
- **Librerias de terceros**: no testear que Zustand persiste correctamente — eso es responsabilidad de Zustand.
- **Estilos CSS**: no testear clases de Tailwind.
- **Codigo generado**: no testear tipos TypeScript o schemas Pydantic triviales.

---

## Backend: pytest

### Configuracion

| Aspecto | Detalle |
|---------|---------|
| Framework | pytest |
| BD de test | `menu_ops_test` (PostgreSQL) |
| Servicios requeridos | PostgreSQL (`pgvector/pgvector:pg16`) + Redis (`redis:7-alpine`) |
| Configuracion | `backend/pytest.ini` |
| Variable de entorno | `ENVIRONMENT=test` |
| Secrets de test | JWT y table token secrets especificos para test |

### Estructura de tests

```
backend/tests/
├── conftest.py              # Fixtures compartidos (client, tokens, DB session)
├── test_auth.py             # Tests de autenticacion y JWT
├── test_billing.py          # Tests de facturacion y pagos
├── test_rounds.py           # Tests de rondas de pedidos
├── test_categories.py       # Tests CRUD de categorias
├── test_products.py         # Tests CRUD de productos
├── test_inventory.py        # Tests del modulo de inventario
├── test_cash_register.py    # Tests del modulo de cierre de caja
├── test_tips.py             # Tests del modulo de propinas
├── test_fiscal.py           # Tests del modulo fiscal AFIP
├── test_scheduling.py       # Tests del modulo de turnos
├── test_crm.py              # Tests del modulo CRM
├── test_floor_plan.py       # Tests del modulo de plan de piso
└── ...                      # 26 archivos de test (38 tests nuevos en 7 archivos de modulos)
```

### Fixtures principales (`conftest.py`)

```python
@pytest.fixture
def client(db_session):
    """Cliente HTTP de test con BD transaccional."""
    # Cada test corre en una transaccion que se rollbackea al final

@pytest.fixture
def admin_token(client):
    """Token JWT de admin para tests autenticados."""
    response = client.post("/api/auth/login", json={
        "email": "admin@demo.com",
        "password": "admin123"
    })
    return response.json()["access_token"]

@pytest.fixture
def waiter_token(client):
    """Token JWT de waiter para tests con permisos limitados."""
```

### Patrones de test backend

```python
# Test de endpoint con autenticacion
def test_create_category_requires_management(client, waiter_token):
    """Waiter no puede crear categorias."""
    response = client.post(
        "/api/admin/categories",
        json={"name": "Nueva"},
        headers={"Authorization": f"Bearer {waiter_token}"}
    )
    assert response.status_code == 403

# Test de aislamiento multi-tenant
def test_tenant_isolation(client, admin_token, other_tenant_token):
    """No se puede acceder a datos de otro tenant."""
    # Crear en tenant A, intentar leer desde tenant B
    ...
```

### Comandos

```bash
cd backend
python -m pytest tests/test_auth.py -v          # Un archivo
python -m pytest tests/ -v --tb=short            # Todos
python -m pytest tests/ --cov=rest_api           # Con coverage
python -m pytest tests/ -k "test_create"         # Por nombre de test
```

---

## Frontend: Vitest

### Versiones

| Frontend | Version Vitest | Nota |
|----------|---------------|------|
| Dashboard | 4.0 | Ultima version |
| pwaMenu | 4.0 | Ultima version |
| pwaWaiter | 3.2 | Version anterior — no mezclar APIs |

### Configuracion

Cada frontend tiene su propio `vitest.config.ts`. Usan `@testing-library/react` para renderizado y `@testing-library/jest-dom` para matchers de DOM.

### Comandos

| Frontend | Watch | Single run | Coverage |
|----------|-------|------------|----------|
| Dashboard | `npm test` | `npm test -- --run` | `npm run test:coverage` |
| pwaMenu | `npm test` | `npm run test:run` | `npm run test:coverage` |
| pwaWaiter | `npm test` | `npm run test:run` | `npm run test:coverage` |

```bash
# Test de un archivo especifico
cd Dashboard && npm test -- src/stores/branchStore.test.ts

# Test con patron de nombre
cd pwaMenu && npm test -- --run -t "should load menu"
```

### Metricas actuales

| Frontend | Tests | Tiempo |
|----------|-------|--------|
| Dashboard | 100+ | ~3.5s |
| pwaMenu | Tests existentes | — |
| pwaWaiter | Tests existentes | — |

---

## Store Tests: Zustand con persist y migraciones

Los stores con `persist` requieren tests especiales para validar migraciones de estado.

### Patron de migracion con type guards

```typescript
// En el store
export const STORE_VERSION = 2

const migrations = {
  1: (state: unknown): StoreState => {
    // Validar estructura con type guard
    if (!isV1State(state)) return DEFAULT_STATE
    return { ...state, newField: 'default' }
  }
}

// Type guard
function isV1State(state: unknown): state is V1State {
  return (
    typeof state === 'object' &&
    state !== null &&
    'existingField' in state
  )
}
```

### Test de migracion

```typescript
describe('store migrations', () => {
  it('debe migrar de v1 a v2 correctamente', () => {
    const v1State = { existingField: 'value' }
    const result = migrations[1](v1State)
    expect(result.existingField).toBe('value')
    expect(result.newField).toBe('default')
  })

  it('debe retornar defaults si el estado es invalido', () => {
    const result = migrations[1](null)
    expect(result).toEqual(DEFAULT_STATE)
  })
})
```

> **Regla:** Siempre incrementar `STORE_VERSION` cuando cambia la estructura de datos. Usar `unknown` para `persistedState` (nunca `any`). Retornar defaults seguros si la validacion falla.

---

## E2E: Playwright

### Ubicacion

```
e2e/
├── playwright.config.ts     # Configuracion (3 proyectos: Dashboard, pwaMenu, pwaWaiter)
├── tests/
│   ├── dashboard/           # Tests del Dashboard
│   ├── pwa-menu/            # Tests de pwaMenu
│   └── pwa-waiter/          # Tests de pwaWaiter
└── package.json
```

### Comandos

```bash
cd e2e
npm install
npx playwright test                          # Todos
npx playwright test tests/dashboard/         # Solo Dashboard
npx playwright test --headed                 # Con navegador visible
npx playwright test --debug                  # Modo debug
```

### Estado

Los tests E2E cuentan con 8 specs y cubren flujos básicos y complejos:

- **Básicos**: login, join-table, branch-select.
- **Navegación y UI**: `navigation.spec.ts`, `order-flow.spec.ts`, `table-management.spec.ts`.
- **Flujos complejos**: `crud-flow.spec.ts` (CRUD completo en Categories), `session-flow.spec.ts` (journey del comensal: unirse → carrito → checkout).

**Cobertura de stores**: Dashboard 25/25 (100%), pwaMenu 5/7 (71%), pwaWaiter 4/4 (100%).

Aun no estan completamente integrados en el pipeline de CI.

---

## CI: GitHub Actions

### Pipeline (`ci.yml`)

Se ejecuta en push/PR a `main` y `develop`. Corre **4 jobs en paralelo**:

| Job | Que hace | Servicios |
|-----|----------|-----------|
| **backend** | pytest + PostgreSQL + Redis | `pgvector/pgvector:pg16`, `redis:7-alpine` |
| **Dashboard** | lint + type-check + test + build | — |
| **pwaMenu** | lint + type-check + test + build | — |
| **pwaWaiter** | lint + type-check + test + build | — |

### Variables de entorno en CI

```yaml
ENVIRONMENT: test
JWT_SECRET: test-secret-for-ci
TABLE_TOKEN_SECRET: test-table-secret-for-ci
DATABASE_URL: postgresql://postgres:postgres@localhost:5432/menu_ops_test
REDIS_URL: redis://localhost:6379
```

### Docker Build (`docker-build.yml`)

Se ejecuta en push a `main` cuando cambian archivos en `backend/`, `ws_gateway/`, o `devOps/`. Valida que las imagenes Docker compilan correctamente sin pushear a un registry.

---

## Coverage

### Comandos

```bash
cd Dashboard && npm run test:coverage    # Dashboard
cd pwaMenu && npm run test:coverage      # pwaMenu
cd backend && python -m pytest tests/ --cov=rest_api --cov-report=html  # Backend
```

### Que cubrir

- **Servicios de dominio**: objetivo alto (logica de negocio critica)
- **Stores Zustand**: objetivo alto (estado de la aplicacion)
- **Routers/endpoints**: objetivo medio (integracion)
- **Componentes UI**: objetivo bajo (solo los que tienen logica condicional)

---

## Buenas practicas

### General

1. **Cada test debe ser independiente.** No depender del orden de ejecucion.
2. **Nombrar tests descriptivamente.** `test_waiter_cannot_delete_category` > `test_delete_403`.
3. **Un assert por concepto.** Varios asserts estan bien si verifican el mismo concepto.
4. **Arrange-Act-Assert.** Estructura clara en 3 secciones.

### Backend especifico

5. **Usar fixtures para setup repetitivo.** Tokens, datos de prueba, etc.
6. **Testear aislamiento multi-tenant.** Verificar que un tenant no accede a datos de otro.
7. **Testear permisos por rol.** ADMIN puede, WAITER no puede, KITCHEN no puede.
8. **Usar `safe_commit` en tests** para capturar errores de BD.

### Frontend especifico

9. **Testear stores sin componentes.** `useBranchStore.getState().fetchBranches()` directo.
10. **Mockear `fetch`, no servicios completos.** Mas cercano a la implementacion real.
11. **Resetear estado del store entre tests.** `useBranchStore.setState(initialState)` en `beforeEach`.
12. **Usar `waitFor` para operaciones async.** No usar `setTimeout` ni `sleep`.
