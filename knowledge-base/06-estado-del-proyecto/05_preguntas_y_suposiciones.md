> Creado: 2026-04-04 | Actualizado: 2026-04-05 | Estado: vigente

# Suposiciones y Preguntas Abiertas

Registro consolidado de suposiciones detectadas (validadas y pendientes) y preguntas abiertas que requieren respuesta de stakeholders.

---

## Suposiciones Validadas

Suposiciones confirmadas con evidencia. Ya no requieren accion.

### 1. Branch slugs son unicos globalmente entre tenants — CONFIRMADO

**Evidencia**: pwaMenu usa `VITE_BRANCH_SLUG` sin contexto de tenant. El endpoint publico `/api/public/menu/{slug}` busca por slug sin discriminar tenant.

**Implicacion**: La restriccion de unicidad global debe estar enforced a nivel de base de datos (UNIQUE constraint). Permite que endpoints publicos funcionen sin contexto de tenant.

### 2. Codigos de mesa NO son unicos entre sucursales — CONFIRMADO

**Evidencia**: CLAUDE.md indica explicitamente: "Table codes are NOT unique across branches — branch_slug is required."

**Implicacion**: Todo endpoint que reciba un codigo de mesa DEBE incluir `branch_slug` o `branch_id`.

### 3. Carrito compartido es local por dispositivo — CONFIRMADO INTENCIONAL

**Evidencia**: pwaMenu CLAUDE.md: "Shared Cart is Local-Only: WebSocket updates round status but cart stays per-device."

**Implicacion**: La UX debe comunicar que cada comensal tiene su propio carrito. La consolidacion ocurre al enviar la ronda (group confirmation).

### 4. Escala objetivo: 600 usuarios concurrentes — CONFIRMADO

**Evidencia**: Target dentro de capacidad del WS Gateway (benchmarked para 400+ en ~160ms).

**Implicacion**: Una sola instancia deberia ser suficiente. Se recomienda load testing real y plan de contingencia (horizontal scaling via Redis Streams).

### 5. IA (Ollama/pgvector) es experimental — CONFIRMADO

**Evidencia**: Product owner confirmo que no esta en produccion ni es prioritario.

**Implicacion**: No invertir esfuerzo en estabilizar. Ollama puede omitirse en deploys de produccion.

### 6. Ordenar durante PAYING — BUG CORREGIDO

**Estado**: **BUG CONFIRMADO y CORREGIDO** (2026-04-04). Si pidieron la cuenta, NO pueden seguir pidiendo. Corregido en backend (`round_service.py` + `constants.py` con `ORDERABLE = [OPEN]`) y frontend (pwaMenu UI bloqueada con mensaje explicativo).

---

## Suposiciones Pendientes de Validacion

### 7. Las asignaciones de mozos son diarias, no en tiempo real

**Evidencia**: `WaiterSectorAssignment` tiene campo de fecha. La verificacion comprueba fecha de HOY.

**Riesgo**: Medio. Si un mozo se enferma a mitad de turno, no esta claro si se puede reasignar y que pasa con las mesas activas del mozo anterior.

**Pregunta**: Se puede cambiar la asignacion de sector a mitad de turno? Que pasa con las mesas activas del mozo anterior?

### 8. La sesion expira tras 8 horas de inactividad

**Evidencia**: pwaMenu cachea datos con TTL de 8 horas. Tokens de mesa duran 3 horas.

**Riesgo**: Medio. No esta claro que pasa con checks no pagados cuando la sesion expira.

**Pregunta**: Existe un mecanismo explicito de expiracion de sesion en el backend? Que pasa con los checks pendientes?

### 9. Precios solo en Pesos Argentinos (ARS)

**Evidencia**: Mercado Pago usa ARS. `formatCurrency` formatea como moneda argentina. Precios en centavos sin campo de moneda.

**Riesgo**: Bajo actualmente. Alto si se planea expansion internacional.

**Pregunta**: El sistema esta disenado exclusivamente para Argentina? Se planea soporte multi-moneda?

### 10. Cada usuario pertenece a exactamente un tenant

**Evidencia**: JWT contiene un unico `tenant_id`. No hay tabla usuario-tenant N:M.

**Riesgo**: Medio. Limita el modelo a restaurantes independientes. Cadenas de franquicias necesitarian una cuenta por marca.

**Pregunta**: Se necesita soporte para usuarios multi-tenant?

### 11. Soft delete universal para entidades de negocio

**Evidencia**: CLAUDE.md: "All entities use soft delete. Hard delete only for ephemeral records."

**Riesgo**: Bajo. La definicion de "efimero" podria no estar clara para todos los tipos de registro.

**Pregunta**: Existe un job periodico de limpieza de registros efimeros? Que entidades exactamente usan hard delete?

### 12. Sistema orientado al mercado argentino

**Evidencia**: Mercado Pago, ARS, espanol rioplatense en UI admin, regulacion EU 1169/2011 para alergenos.

**Riesgo**: Bajo actualmente. Si expansion: requiere multi-moneda, multi-gateway, i18n Dashboard, regulaciones locales.

**Pregunta**: Hay planes de internacionalizacion? Que mercados son prioritarios?

---

## Resumen de Validacion

| # | Suposicion | Estado | Riesgo |
|---|-----------|--------|--------|
| 1 | Branch slug unico global | **CONFIRMADO** | N/A |
| 2 | Table code no unico por branch | **CONFIRMADO** | N/A |
| 3 | Carrito local por device | **CONFIRMADO** | N/A |
| 4 | Escala: 600 concurrentes | **CONFIRMADO** | N/A |
| 5 | IA experimental | **CONFIRMADO** | N/A |
| 6 | Ordenar durante PAYING | **BUG CORREGIDO** | N/A |
| 7 | Asignacion diaria de mozos | Pendiente | Medio |
| 8 | Session expira a 8h | Pendiente | Medio |
| 9 | Precios solo en ARS | Pendiente | Bajo |
| 10 | Usuario = 1 tenant | Pendiente | Medio |
| 11 | Soft delete universal | Pendiente | Bajo |
| 12 | Mercado argentino | Pendiente | Bajo |

**Estado**: 6 de 12 suposiciones confirmadas/resueltas. 6 pendientes de validacion.

---

## Preguntas Abiertas

### Contexto de Negocio

#### P1. Cual es el tamanio del mercado objetivo?

**Contexto**: Arquitectura multi-tenant permite multiples restaurantes. Sin documentacion de escala esperada.

**Opciones**: (a) Un solo restaurante con sucursales, (b) Decenas de restaurantes (SaaS regional), (c) Cientos+ (plataforma a escala).

**Impacto**: Sin definicion, las decisiones de escalabilidad e infraestructura son especulativas.

#### P2. ~~Carga concurrente esperada~~ — RESPONDIDA: 600 usuarios concurrentes

#### P3. Se planea expansion internacional?

**Opciones**: (a) Solo Argentina, (b) LATAM (multi-moneda, gateway regional), (c) Global (i18n completo, regulaciones por pais).

#### P4. Cual es el modelo de revenue?

**Opciones**: (a) Suscripcion mensual por sucursal, (b) Fee por transaccion, (c) Freemium, (d) Producto interno.

**Impacto**: Features de billing, metering y reportes dependen de este modelo.

#### P5. Cual es la relacion con la marca "Buen Sabor"?

**Opciones**: (a) Tenant de ejemplo/demo, (b) Nombre del producto, (c) "Integrador" es plataforma, "Buen Sabor" primer cliente.

### Decisiones de Producto

#### P6. ~~Ordenar durante PAYING~~ — RESPONDIDA: NO. Bug corregido.

#### P7. Que pasa con checks no pagados cuando la sesion expira?

**Opciones**: (a) Check se cancela, (b) Check queda pendiente hasta cierre manual, (c) Alerta antes de expiracion.

#### P8. Pueden cambiar asignaciones de mozos a mitad de turno?

**Opciones**: (a) Fija todo el dia, (b) Manager reasigna en cualquier momento, (c) Reasigna con transferencia de mesas.

#### P9. ~~Producto no disponible~~ — PARCIALMENTE RESPONDIDA: Backend implementado. Falta frontend.

#### P10. ~~Estado de IA~~ — RESPONDIDA: Experimental, no prioritario.

#### P11. ~~Carrito sincronizado entre dispositivos~~ — RESPONDIDA: No, local por diseniio.

#### P12. Cual es la prioridad entre features pendientes?

**Contexto**: Con Kitchen Display y Estadisticas basicas completados, las prioridades restantes incluyen: Exclusiones de Producto, Producto no disponible (frontend), Loyalty Fases 3-4, Reservas, Delivery.

### Decisiones Tecnicas

#### P13. ~~Alembic~~ — RESPONDIDA: Configurado con 11 migraciones.

#### P14. Cual es el entorno de despliegue objetivo?

**Opciones**: (a) VPS con Docker Compose, (b) Kubernetes, (c) PaaS/Cloud Run/ECS, (d) No definido.

**Impacto**: CI/CD, monitoreo, logs y escalabilidad dependen de esto.

#### P15. Se necesita escalado horizontal en los proximos 6-12 meses?

**Contexto**: Configuracion de scaling existe (`docker-compose.prod.yml`), pero no se ha implementado en produccion.

#### P16. ~~Backups~~ — RESPONDIDA: Implementados con backup.sh + restore.sh.

#### P17. Requisitos de compliance mas alla de EU 1169/2011?

**Opciones**: (a) Solo alergenos, (b) Ley 25.326 datos personales, (c) AFIP facturacion electronica, (d) Habilitaciones bromatologicas.

**Nota**: Modulo AFIP Fiscal existe como scaffold (stub).

#### P18. JWT_SECRET en secrets manager?

**Opciones**: (a) `.env` no versionado, (b) Secrets manager (Vault, Doppler), (c) Docker Swarm/K8s secrets.

#### P19. Prometheus + Grafana self-hosted o servicio gestionado?

**Opciones**: (a) Self-hosted (gratis, mantenimiento), (b) Grafana Cloud free tier, (c) Datadog/New Relic.

### Decisiones de Arquitectura

#### P20. Unificar clientes WebSocket?

**Opciones**: (a) Paquete compartido, (b) Implementaciones separadas, (c) Parcial (solo conexion/heartbeat compartido).

**Nota**: Scaffold existe en `shared/websocket-client.ts`.

#### P21. Libreria de componentes compartida?

**Opciones**: (a) Paquete con Turborepo, (b) Duplicacion manejable, (c) Compartir solo estilos (Tailwind config).

#### P22. Generar tipos del API automaticamente?

**Opciones**: (a) Auto-generar tipos y clientes, (b) Tipos manuales, (c) Solo tipos sin clientes.

**Nota**: Script existe en `scripts/generate-types.sh`.

#### P23. Modelo de gobernanza se aplica realmente?

**Contexto**: CLAUDE.md define CRITICO/ALTO/MEDIO/BAJO por dominio.

#### P24. ~~Documentos de arquitectura en raiz~~ — EN PROCESO: Consolidacion en knowledge-base.

---

## Priorizacion de Preguntas

### Urgentes (bloquean decisiones tecnicas)

| Prioridad | Pregunta | Bloquea |
|-----------|----------|---------|
| 1 | P14 Entorno de despliegue | CI/CD deploy, monitoring |
| 2 | P1 Tamanio de mercado | Dimensionamiento de infra |
| 3 | P15 Escalado horizontal | Arquitectura WS Gateway |
| 4 | P12 Prioridad de features | Orden de desarrollo |

### Estrategicas (definen direccion)

| Prioridad | Pregunta | Define |
|-----------|----------|--------|
| 1 | P3 Expansion internacional | Moneda, pagos, i18n |
| 2 | P4 Modelo de revenue | Feature gating, billing |
| 3 | P5 Relacion "Buen Sabor" | Branding, multi-tenancy |

---

*Ultima actualizacion: Abril 2026*
