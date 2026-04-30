> Creado: 2026-04-04 | Actualizado: 2026-04-05 | Estado: vigente

# Salud Tecnica del Sistema

Inventario consolidado de limitaciones, deuda tecnica y riesgos del proyecto Integrador. Se han eliminado los items resueltos y se mantienen solo los vigentes.

---

## Limitaciones Actuales

### Limitaciones Funcionales

#### 1. Sin autenticacion offline

El login requiere conexion a internet para validar credenciales contra el backend. No hay cache de tokens ni mecanismo de autenticacion local.

**Impacto**: En escenarios de conectividad intermitente, el personal no puede iniciar sesion hasta recuperar conexion.

#### 2. Pagina de Configuracion basica

Settings solo ofrece importacion/exportacion de datos via JSON. No hay configuracion de preferencias de usuario, parametros del restaurante ni personalizacion del sistema.

**Impacto**: Cualquier cambio de configuracion requiere intervencion tecnica directa.

#### 3. Pagina de Exclusiones de Producto es placeholder

La ruta existe pero la funcionalidad no esta implementada. No se pueden definir exclusiones (ingredientes que un producto no debe llevar) desde la interfaz.

**Impacto**: Personalizacion de productos por parte del cliente no esta disponible desde la UI.

#### 4. Sin undo/redo

Las operaciones de eliminacion son inmediatas. Si bien el sistema usa soft delete, no hay mecanismo en la UI para deshacer una accion.

**Impacto**: Un error del usuario requiere intervencion manual en la base de datos o recrear el recurso.

#### 5. Sin edicion colaborativa en tiempo real

No hay mecanismo de resolucion de conflictos (CRDT, OT) para edicion simultanea del mismo recurso por multiples usuarios.

**Impacto**: Si dos administradores editan el mismo producto simultaneamente, el ultimo en guardar sobrescribe sin advertencia.

#### 6. Sin UI de auditoria

Los campos de auditoria existen en la base de datos (`created_by`, `updated_by`, etc.) pero no hay interfaz para consultarlos.

**Impacto**: Ante incidentes, no hay forma de investigar desde la aplicacion.

#### 7. Lealtad de clientes solo en Fase 1-2

Seguimiento por dispositivo (Fase 1) y preferencias implicitas (Fase 2) implementados. Fases 3-4 (reconocimiento de recurrente, opt-in GDPR) pendientes.

**Impacto**: No se puede identificar a un cliente recurrente ni ofrecerle experiencias personalizadas.

#### 8. Sin notificaciones destacadas para comensales

El diner recibe eventos por WebSocket pero no hay notificaciones visuales prominentes ni sonoras cuando el pedido esta listo.

**Impacto**: La experiencia del comensal depende de que este activamente mirando la app.

### Limitaciones Tecnicas

#### 9. Sin TLS en desarrollo

El entorno de desarrollo usa HTTP y WS sin cifrado. La configuracion de TLS para produccion no esta documentada.

**Impacto**: En desarrollo, las credenciales viajan en texto plano. Produccion requiere configuracion manual.

#### 10. Sin agregacion de logs

Los logs van a stdout unicamente. No hay integracion con plataformas de observabilidad (ELK, Datadog, Loki).

**Impacto**: Diagnosticar problemas en produccion requiere acceso SSH y revision manual.

#### 11. Problemas especificos de Windows

- `StatReload` de uvicorn puede fallar (mitigado con `watchfiles`).
- `uvicorn` no esta en PATH; debe usarse `python -m uvicorn`.
- `PYTHONPATH` requiere sintaxis de PowerShell.

**Impacto**: Developers nuevos pierden tiempo configurando el entorno.

#### 12. Restricciones del React Compiler

`babel-plugin-react-compiler` impone reglas estrictas: no hooks condicionales, no efectos secundarios en render. Puede conflictuar con librerias de terceros.

**Impacto**: Debugging cambia respecto al modelo mental tradicional de React.

#### 13. Sin rate limiting por tipo de evento en WebSocket

Un flujo intenso de eventos `CART_ITEM_UPDATED` podria saturar el canal en detrimento de eventos criticos como `ROUND_SUBMITTED`.

**Impacto**: En alta carga, eventos criticos podrian experimentar latencia.

#### 14. Sin tests end-to-end completos

Existen specs basicos de Playwright (login, join-table, branch-select) pero no hay flujos completos (pedido → pago → cierre).

**Impacto**: Regresiones en flujos de usuario completos solo se detectan manualmente.

#### 15. Sin load testing

Las afirmaciones de rendimiento (160ms para 400 usuarios) no estan respaldadas por tests de carga automatizados.

**Impacto**: No hay certeza de que el sistema soporte la carga esperada en produccion.

---

## Deuda Tecnica

### Prioridad ALTA

#### 1. Gaps en cobertura de tests

El backend tiene ~20 archivos de test pero sin reporte de cobertura visible. Los componentes React no estan testeados. Los 7 modulos nuevos (Inventory, Cash Register, Tips, Fiscal, Scheduling, CRM, Floor Plan) no tienen tests.

**Estrategia**: Configurar coverage en CI, establecer umbral minimo (70%), agregar tests de componentes criticos, expandir E2E.

**Esfuerzo**: Alto (continuo).

#### 2. Paginas placeholder restantes en Dashboard

- **Exclusiones de Producto**: Gestion de exclusiones/personalizaciones.
- **Ordenes**: Vista consolidada de ordenes activas (parcialmente funcional).

**Estrategia**: Implementar como features independientes.

**Esfuerzo**: ~1-2 semanas por pagina.

### Prioridad MEDIA

#### 3. JWT_SECRET hardcodeado en docker-compose de desarrollo

El `docker-compose.yml` de desarrollo incluye un `JWT_SECRET` directamente. Si se usa en produccion, la seguridad queda comprometida.

**Estrategia**: Mover a `.env` no versionado, referenciar `${JWT_SECRET}` sin default.

**Esfuerzo**: Bajo (~30 minutos).

#### 4. Sin TypeScript strict mode en algunas areas

No todas las areas tienen `strict: true` activado, permitiendo `any` implicitos.

**Estrategia**: Activar `strict: true` progresivamente.

**Esfuerzo**: Medio.

#### 5. Mapeo legacy de codigos de error (pwaMenu)

pwaMenu mantiene una capa de compatibilidad para codigos de error del backend que podria no ser necesaria.

**Estrategia**: Verificar que todos los endpoints usen formato nuevo y eliminar la capa.

**Esfuerzo**: Bajo (~2-3 horas).

#### 6. ~~Multiples implementaciones de cliente WebSocket~~ — RESUELTO

Resuelto via refactor a `BaseWebSocketClient` con 3 subclases especializadas. Los 3 frontends migrados al cliente compartido en `shared/websocket-client.ts`.

### Prioridad BAJA

#### 7. Sin libreria de componentes compartida entre frontends

Button, Input, Modal, Toast, ConfirmDialog duplicados en los tres frontends con estilos similares pero no identicos.

**Estrategia**: Crear paquete compartido con Turborepo o Nx.

**Esfuerzo**: Alto (~2-3 semanas).

#### 8. AFIP Fiscal es stub

El modulo fiscal (migracion 008) tiene endpoints funcionales pero `_call_afip_wsfe()` devuelve CAE simulado. Necesita `pyafipws` + certificados AFIP para produccion.

**Estrategia**: Integrar con libreria `pyafipws` cuando se decida ir a produccion fiscal.

**Esfuerzo**: Alto (~2-3 semanas incluyendo certificacion).

---

## Evaluacion de Riesgos

### Riesgos CRITICOS

#### 1. Punto Unico de Falla: WebSocket Gateway

**Probabilidad**: Media. | **Impacto**: Critico.

El WS Gateway corre como instancia unica. Si cae, TODA la funcionalidad en tiempo real se detiene.

**Mitigaciones existentes**: Health checks, circuit breaker para Redis, Docker restart policy, configuracion de horizontal scaling documentada (`docker-compose.prod.yml` con 2 replicas + nginx LB).

**Mitigaciones necesarias**: Implementar el scaling horizontal en produccion, degradacion elegante en frontends (banner "modo offline" + polling fallback), alertas automaticas.

#### 2. Fuga de Datos entre Tenants

**Probabilidad**: Baja. | **Impacto**: Critico.

Separacion multi-tenant a nivel de aplicacion unicamente. Un endpoint sin filtro `tenant_id` expone datos.

**Mitigaciones existentes**: `PermissionContext`, `TenantRepository`, `BranchRepository` con filtrado automatico, Domain Services heredan filtrado.

**Mitigaciones necesarias**: Tests de aislamiento de tenant, Row-Level Security (RLS) en PostgreSQL, revision obligatoria de seguridad en PRs.

### Riesgos ALTOS

#### 3. Compromiso del JWT Secret

**Probabilidad**: Baja. | **Impacto**: Alto.

JWT_SECRET en variable de entorno pero hardcodeado en docker-compose de desarrollo.

**Mitigaciones existentes**: Token blacklist en Redis, tokens de acceso con expiracion corta (15min), refresh tokens en HttpOnly cookies.

**Mitigaciones necesarias**: Rotacion de secrets, secrets manager, eliminar hardcoded del docker-compose.

#### 4. Falla en Cascada de Redis

**Probabilidad**: Media. | **Impacto**: Alto.

Redis sirve: token blacklist (fail-closed), WS eventos, rate limiting, cache. Si cae, multiples subsistemas fallan.

**Mitigaciones existentes**: Circuit breaker en WS Gateway, patron fail-closed en blacklist. Configuracion de Redis Sentinel documentada en `docker-compose.prod.yml`.

**Mitigaciones necesarias**: Implementar Redis Sentinel en produccion, separar Redis por funcion, fallback para auth si Redis no responde.

#### 5. Perdida de Eventos durante Reconexion

**Probabilidad**: Media. | **Impacto**: Alto.

Eventos emitidos durante desconexion WS se pierden parcialmente (solo pwaWaiter tiene catch-up).

**Mitigaciones existentes**: Event catch-up implementado para pwaWaiter, cola de reintentos en pwaWaiter, reconexion con backoff exponencial, Redis sorted sets para buffer de eventos (5 min TTL).

**Mitigaciones necesarias**: Implementar catch-up en Dashboard y pwaMenu, notificaciones sonoras/vibracion para eventos criticos.

### Riesgos MEDIOS

#### 6. Techo de Escalabilidad

**Probabilidad**: Depende del crecimiento. | **Impacto**: Medio.

Arquitectura con limite natural de ~500-1000 conexiones WS por instancia. Target confirmado: 600 concurrentes.

**Mitigaciones existentes**: Worker pool (10 workers), sharded locks por branch, plan de scaling horizontal documentado.

**Mitigaciones necesarias**: Load testing real, metricas de conexiones activas con alertas.

#### 7. Dependencia de Mercado Pago

**Probabilidad**: Baja. | **Impacto**: Medio.

Unica integracion de pago digital. Existe ABC `PaymentGateway` pero billing router aun usa codigo inline de MP.

**Mitigaciones existentes**: Pago manual (efectivo/tarjeta/transferencia) como fallback. Abstraccion parcialmente implementada.

**Mitigaciones necesarias**: Completar refactor del billing router para usar la abstraccion, segunda implementacion (Stripe).

#### 8. Friccion de Desarrollo en Windows

**Probabilidad**: Alta. | **Impacto**: Medio.

Problemas recurrentes con uvicorn, PYTHONPATH, separadores de ruta.

**Mitigaciones existentes**: DevContainer, workarounds documentados, `watchfiles`.

**Mitigaciones necesarias**: Guia de setup para Windows/WSL2, scripts de inicializacion con deteccion de OS.

---

## Matriz de Severidad Consolidada

```
                    IMPACTO
              Bajo    Medio    Alto    Critico
         ┌─────────┬─────────┬─────────┬─────────┐
  Alta   │         │   Win   │         │         │
         │         │  fric.  │         │         │
         ├─────────┼─────────┼─────────┼─────────┤
P Media  │         │  Escal. │  Redis  │   WS    │
R        │         │         │  WS evt │  SPOF   │
O        ├─────────┼─────────┼─────────┼─────────┤
B Baja   │         │   MP    │  JWT    │  Tenant │
         │         │  dep.   │ secret  │  leak   │
         ├─────────┼─────────┼─────────┼─────────┤
         │         │         │         │         │
         └─────────┴─────────┴─────────┴─────────┘
```

---

## Indicadores de Progreso

Para trackear la reduccion de deuda tecnica:

- **Cobertura de tests**: Target 70% lineas en codigo nuevo.
- **CI pipeline status**: Verde/rojo en cada PR.
- **Migraciones pendientes**: Diferencia entre modelos y schema real (target: 0).
- **Paginas placeholder**: Cantidad de rutas sin implementacion (target: 0).
- **Modulos sin tests**: 7 modulos nuevos pendientes (target: 0).

---

*Ultima actualizacion: Abril 2026*
