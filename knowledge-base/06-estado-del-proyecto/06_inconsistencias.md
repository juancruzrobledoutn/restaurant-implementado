> Creado: 2026-04-04 | Actualizado: 2026-04-05 | Estado: vigente

# Inconsistencias Detectadas entre Documentacion y Codigo

Registro historico de todas las inconsistencias encontradas entre la documentacion del proyecto y el comportamiento real del codigo.

---

## Estado: Todas resueltas

Todas las inconsistencias detectadas durante la auditoria de abril 2026 han sido corregidas o documentadas. Este archivo se mantiene como referencia historica y para las lecciones aprendidas.

---

## Registro Historico

| # | Inconsistencia | Severidad | Estado | Fecha |
|---|----------------|-----------|--------|-------|
| 1 | "Customers can still order during PAYING" | CRITICA | CORREGIDO | 2026-04-04 |
| 2 | "No test framework is configured" en pwaMenu | ALTA | CORREGIDO | 2026-04-04 |
| 3 | SharedCart descrito como "multi-device sync" | MEDIA | CORREGIDO | 2026-04-04 |
| 4 | VITE_API_URL inconsistente entre frontends | BAJA | CORREGIDO | 2026-04-05 |
| 5 | SessionStatus.ACTIVE incluia PAYING | CRITICA | CORREGIDO | 2026-04-04 |
| 6 | FSM duplicado en kitchen router | ALTA | CORREGIDO | 2026-04-04 |
| 7 | RoundItem sin snapshot de nombre de producto | MEDIA | CORREGIDO | 2026-04-04 |

---

## Detalle de Correcciones

### 1. "Customers can still order during PAYING" — CORREGIDO

**Severidad**: CRITICA

CLAUDE.md indicaba que los clientes podian seguir ordenando durante PAYING. Esto era un **BUG**, no un feature. Permitir pedidos durante PAYING generaba inconsistencias en facturacion.

**Archivos corregidos**:
- `backend/rest_api/services/domain/round_service.py` — validacion que impide crear rondas si sesion esta en PAYING
- `backend/shared/config/constants.py` — `ORDERABLE = [OPEN]` para distinguir "sesion viva" de "puede pedir"
- `pwaMenu/src/stores/tableStore/store.ts` — bloqueo de acciones de carrito en PAYING
- `pwaMenu/src/components/cart/SharedCart.tsx` — UI bloqueada con mensaje explicativo
- `pwaMenu/src/components/menu/ProductDetailModal.tsx` — boton "Agregar" deshabilitado
- `pwaMenu/src/pages/Home.tsx` — banner informativo cuando sesion esta en PAYING
- `pwaMenu/src/components/layout/BottomNav.tsx` — badge visual en carrito bloqueado

### 2. "No test framework is configured" en pwaMenu — CORREGIDO

**Severidad**: ALTA

pwaMenu CLAUDE.md indicaba que no habia framework de testing. En realidad, Vitest estaba completamente configurado con 5+ test suites funcionales.

**Correccion**: `pwaMenu/CLAUDE.md` actualizado con comandos de test reales.

### 3. SharedCart descrito como "multi-device sync" — CORREGIDO

**Severidad**: MEDIA

CLAUDE.md indicaba "Multi-device cart sync via WebSocket". El carrito es **per-device**. WebSocket sincroniza rondas, no el carrito.

**Correccion**: CLAUDE.md actualizado para clarificar que el carrito es local por dispositivo.

### 4. VITE_API_URL inconsistente entre frontends — CORREGIDO

**Severidad**: BAJA

Dashboard usaba `VITE_API_URL=http://localhost:8000` (sin `/api`), mientras pwaMenu y pwaWaiter usaban `http://localhost:8000/api` (con `/api`).

**Correccion**: Todos los frontends unificados al mismo patron.

### 5. SessionStatus.ACTIVE incluia PAYING — CORREGIDO

**Severidad**: CRITICA

`ACTIVE = [OPEN, PAYING]` se usaba para dos propositos distintos: verificar acceso y permitir pedidos. Al incluir PAYING, se permitia crear rondas durante PAYING.

**Correccion**: `ORDERABLE = [OPEN]` para validacion de rondas, `ACTIVE = [OPEN, PAYING]` para consultas generales.

### 6. FSM duplicado en kitchen router — CORREGIDO

**Severidad**: ALTA

Kitchen router tenia su propia copia del mapa de transiciones de estado que podia divergir de `constants.py`.

**Correccion**: Reemplazado diccionario inline con `validate_round_transition()` centralizado.

### 7. RoundItem sin snapshot de nombre de producto — CORREGIDO

**Severidad**: MEDIA

`RoundItem` capturaba `unit_price_cents` como snapshot pero no el nombre del producto. Productos renombrados o eliminados perdian informacion en pedidos historicos.

**Correccion**: Campo `product_name` agregado (nullable para compatibilidad con datos existentes). Migracion Alembic generada.

---

## Lecciones Aprendidas

1. **La documentacion debe describir el comportamiento real, no el deseado.** Las inconsistencias #1 y #3 existieron porque la documentacion describia la aspiracion, no la realidad.

2. **FSM deben tener una unica fuente de verdad.** La inconsistencia #6 demuestra el riesgo de duplicar logica de transiciones de estado. Usar siempre funciones centralizadas.

3. **Snapshot Pattern debe ser explicito y completo.** La inconsistencia #7 muestra que capturar solo el precio pero no el nombre era un snapshot incompleto. Regla: si capturas un campo de una entidad externa, captura todos los campos que necesitas para reconstruir la informacion sin la entidad original.

4. **Las variables de entorno deben seguir convenciones uniformes.** La inconsistencia #4 generaba friccion innecesaria en onboarding.

5. **Los tests existentes deben estar documentados.** La inconsistencia #2 podia haber llevado a configurar un framework duplicado.

---

*Ultima actualizacion: Abril 2026*
