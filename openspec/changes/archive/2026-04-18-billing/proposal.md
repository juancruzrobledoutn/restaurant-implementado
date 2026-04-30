## Why

C-11 (kitchen) cerró el ciclo de producción — la cocina puede preparar y marcar rondas como listas. Sin embargo, no hay forma de cobrarle al comensal ni de cerrar la sesión de mesa. C-12 cierra este gap implementando el sistema completo de facturación: solicitud de cuenta, algoritmo FIFO de asignación de pagos, integración con Mercado Pago y pagos manuales del mozo.

## What Changes

- **Modelo de facturación**: cuatro entidades nuevas — `app_check`, `charge`, `allocation`, `payment` — que implementan el patrón contable: cada carga se genera por ronda/ítem, los pagos se aplican FIFO a los cargos pendientes.
- **Algoritmo FIFO**: un pago puede cubrir múltiples cargos parcialmente; un cargo puede ser cubierto por múltiples pagos. Cuando la suma de allocations cubre todos los charges, el check pasa a PAID y la sesión de mesa a CLOSED.
- **BillingService**: servicio de dominio que orquesta solicitud de cuenta, cálculo de cargos por método de división (partes iguales / por consumo / personalizado), registro de pagos y transición de estados.
- **PaymentGateway ABC**: abstracción de pasarela de pagos con implementación `MercadoPagoGateway`. Nunca se instancia inline en el router.
- **Endpoints de facturación** (`/api/billing/`): solicitar cuenta, consultar estado, crear preferencia MP, procesar webhook IPN, consultar estado de pago.
- **Endpoints de mozo** extendidos: `POST /api/waiter/sessions/{id}/check` (solicitar cuenta), `POST /api/waiter/payments/manual` (efectivo/tarjeta/transferencia).
- **Outbox events**: `CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_APPROVED`, `PAYMENT_REJECTED` — todos via Outbox (at-least-once) por ser eventos financieros críticos.
- **Migración 009**: tablas `app_check`, `charge`, `allocation`, `payment`.
- **Rate limiting**: 5/min solicitar cuenta, 20/min operaciones de pago, 5/min operaciones críticas.

## Capabilities

### New Capabilities

- `billing-core`: sistema completo de facturación — Check, Charge, Allocation (FIFO), Payment, BillingService, PaymentGateway ABC, MercadoPagoGateway, eventos Outbox financieros.

### Modified Capabilities

- `table-sessions`: la transición `OPEN → PAYING` ahora es disparada por `BillingService.request_check()`. La transición `PAYING → CLOSED` ocurre cuando el check pasa a PAID. Los endpoints de solicitud de cuenta deben verificar que la sesión esté en OPEN antes de crear el check.

## Impact

- **Backend**: nuevos archivos en `backend/rest_api/models/`, `backend/rest_api/services/`, `backend/rest_api/routers/`, `backend/rest_api/schemas/`; nueva migración Alembic 009.
- **Infraestructura**: `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_PUBLIC_KEY`, `MERCADOPAGO_WEBHOOK_SECRET` en `.env`.
- **WebSocket Gateway**: procesa eventos Outbox `CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_APPROVED`, `PAYMENT_REJECTED` y los routea a suscriptores de la branch.
- **Dependencias Python**: `mercadopago` SDK.
- **No hay cambios en frontends** en este change (C-16, C-18, C-19, C-21 consumen este backend en gates posteriores).
