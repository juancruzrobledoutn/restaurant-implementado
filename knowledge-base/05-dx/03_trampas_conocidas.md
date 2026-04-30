> Creado: 2026-04-04 | Actualizado: 2026-04-05 | Estado: vigente

# Trampas Conocidas

Todos los gotchas, errores comunes y comportamientos inesperados documentados para desarrolladores. Para convenciones y estandares del proyecto, ver `05-dx/04_convenciones_y_estandares.md`.

---

## Configuracion

### 1. VITE_API_URL inconsistente (CORREGIDO en v2)

- **Dashboard**: `VITE_API_URL=http://localhost:8000` (SIN `/api`)
- **pwaMenu**: `VITE_API_URL=http://localhost:8000` (SIN `/api`, se agrega internamente)
- **pwaWaiter**: `VITE_API_URL=http://localhost:8000` (SIN `/api`, se agrega internamente)

> Si ves un `.env` viejo con `/api` al final, quitalo. Fue corregido y ahora todos los frontends agregan el prefijo internamente.

### 2. Redis puerto 6380, NO 6379

Docker mapea el puerto interno 6379 al externo **6380** para evitar conflictos con instancias locales de Redis.

| Contexto | URL |
|----------|-----|
| Desde tu maquina local | `redis://localhost:6380` |
| Dentro de Docker Compose | `redis://redis:6379` |

> **Trampa:** Si tu `.env` dice `REDIS_URL=redis://localhost:6379`, no va a conectar.

### 3. pwaMenu necesita VITE_BRANCH_SLUG correcto

El slug configurado en `pwaMenu/.env` debe coincidir **exactamente** con el `slug` del branch en la base de datos. Si no coincide, el menu devuelve 404.

```bash
# Verificar slugs existentes
SELECT slug FROM branches WHERE is_active = true;
```

---

## Windows

### 4. uvicorn no esta en PATH

En Windows, el ejecutable `uvicorn` frecuentemente no se agrega al PATH del sistema.

```bash
# MAL (puede fallar)
uvicorn rest_api.main:app --reload

# BIEN
python -m uvicorn rest_api.main:app --reload
```

### 5. WS Gateway necesita PYTHONPATH

El WebSocket Gateway vive en la raiz del proyecto pero importa modulos de `backend/`. Sin PYTHONPATH configurado, falla con `ModuleNotFoundError`.

```powershell
# PowerShell
$env:PYTHONPATH = "$PWD\backend"
python -m uvicorn ws_gateway.main:app --reload --port 8001
```

```bash
# Bash / Git Bash
PYTHONPATH=$PWD/backend python -m uvicorn ws_gateway.main:app --reload --port 8001
```

### 6. watchfiles puede fallar con StatReload

En Windows, el mecanismo de hot-reload de uvicorn (basado en `watchfiles`) puede no detectar cambios en archivos nuevos, especialmente nuevas rutas o modulos. **Solucion:** reiniciar uvicorn manualmente cuando agregas archivos nuevos.

---

## Datos y tipos

### 7. Precios: trampa de visualizacion

```
$125.50 en la UI = 12550 en la BD
```

> **Trampa:** Si ves `price: 12550` en un response y lo mostras directo, el usuario ve "$12,550" en vez de "$125.50". Siempre dividir por 100 para mostrar, multiplicar por 100 para enviar.

### 8. Session status: UPPERCASE en backend ≠ lowercase en frontend

| Backend | Frontend |
|---------|----------|
| `"OPEN"` | `"active"` |
| `"PAYING"` | `"paying"` |
| `"CLOSED"` | `"closed"` |

> **Trampa:** No es solo un cambio de case — los valores son diferentes. `OPEN` ≠ `open`, es `active`.

### 9. Branch slugs son globalmente unicos

Los slugs de branch son unicos a nivel de **toda la BD**, no por tenant. Dos restaurantes distintos NO pueden tener un branch con el mismo slug (ej: ambos con `"centro"`).

---

## Zustand (CRITICO — causa bugs silenciosos)

### 10. NUNCA destructurar el store

```typescript
// MAL — causa loop infinito de re-renders
const { items, addItem } = useStore()

// BIEN — selectores individuales
const items = useStore(selectItems)
const addItem = useStore((s) => s.addItem)
```

**Por que:** Destructurar retorna un objeto nuevo en cada render, lo que dispara re-renders infinitos porque Zustand compara por referencia.

### 11. useShallow obligatorio para arrays filtrados/computados

```typescript
// MAL — nuevo array reference en cada render → loop infinito
const activeItems = useStore(state => state.items.filter(i => i.active))

// BIEN — useShallow compara por contenido
import { useShallow } from 'zustand/react/shallow'
const activeItems = useStore(useShallow(state => state.items.filter(i => i.active)))
```

### 12. EMPTY_ARRAY constante para fallbacks

```typescript
// MAL — crea nuevo array vacio en cada render
export const selectBranchIds = (s: State) => s.user?.branch_ids ?? []

// BIEN — referencia estable
const EMPTY_ARRAY: number[] = []
export const selectBranchIds = (s: State) => s.user?.branch_ids ?? EMPTY_ARRAY
```

---

## Seguridad

### 13. logout() debe deshabilitar retry en 401

En `api.ts`, la funcion `authAPI.logout()` DEBE pasar `false` como tercer argumento a `fetchAPI` para deshabilitar el retry automatico en 401.

```
Sin proteccion:
expired token → 401 → onTokenExpired → logout() → 401 → onTokenExpired → logout() → ...
(loop infinito)
```

### 14. WebSocket token va en query param, no en header

La API de WebSocket del navegador **no soporta headers custom**. El token de autenticacion se pasa como query parameter:

```
ws://localhost:8001/ws/waiter?token=eyJhbGciOiJIUzI1NiIs...
ws://localhost:8001/ws/diner?table_token=hmac_token_here
```

---

## Alembic

### 15. No hay migracion "initial schema"

El schema base fue creado con `create_all()` antes de integrar Alembic. Las migraciones existentes (001-004) son incrementales sobre ese schema.

| Escenario | Procedimiento |
|-----------|--------------|
| BD existente (ya tiene tablas) | `alembic upgrade head` (aplica incrementales) |
| BD nueva (sin tablas) | `create_all()` primero, luego `alembic stamp head` |

> **Trampa:** Si corres `alembic upgrade head` en una BD nueva sin tablas, las migraciones van a fallar porque asumen que el schema base ya existe.

---

## WebSocket

### 16. Heartbeat cada 30 segundos

El cliente debe enviar `{"type": "ping"}` cada 30 segundos. El servidor tiene timeout de 60 segundos. Si no hay heartbeat, la conexion se cierra silenciosamente.

> **Trampa:** Si tu WebSocket se desconecta cada ~60s, probablemente no estas enviando pings.

### 17. Codigos de cierre custom

| Codigo | Significado |
|--------|-------------|
| 4001 | Autenticacion fallida |
| 4003 | Forbidden (sin permisos) |
| 4029 | Rate limited |

---

## Async en React

### 18. Hook mount guard obligatorio

```typescript
// Sin guard: puede causar "setState on unmounted component"
useEffect(() => {
  let isMounted = true
  fetchData().then(data => {
    if (!isMounted) return  // Guard: no actualizar si ya se desmonto
    setData(data)
  })
  return () => { isMounted = false }
}, [])
```

### 19. WebSocket listener con useRef

```typescript
// Sin ref: se acumulan listeners en cada re-render
const handleEventRef = useRef(handleEvent)
useEffect(() => { handleEventRef.current = handleEvent })
useEffect(() => {
  const unsubscribe = ws.on('*', (e) => handleEventRef.current(e))
  return unsubscribe
}, [])  // Empty deps — subscribe UNA sola vez
```

---

## SQLAlchemy

### 20. Boolean comparison con .is_(True)

```python
# MAL — Python interpreta "== True" de forma ambigua con SQLAlchemy
.where(Model.is_active == True)

# BIEN
.where(Model.is_active.is_(True))
```

### 21. Tabla "Check" usa nombre custom

`Check` es palabra reservada en SQL. El modelo usa `__tablename__ = "app_check"`.

```python
class Check(Base):
    __tablename__ = "app_check"  # No "check" — es reservada
```
