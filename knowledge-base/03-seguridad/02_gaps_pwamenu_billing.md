# Gaps de Seguridad — pwaMenu Billing (C-19)

**Documento**: knowledge-base/03-seguridad/02_gaps_pwamenu_billing.md  
**Change**: pwamenu-billing (C-19)  
**Fecha**: 2026-04-22  
**Estado**: Conocidos — fuera de scope del MVP. Pendiente de priorización.

---

## (a) Retiro de consent no implementado — DELETE /opt-in

**Gap**: El RGPD (art. 17) y la ley argentina 25.326 reconocen el derecho al olvido / retiro del consentimiento. La implementación actual de C-19 **no incluye** un endpoint `DELETE /api/customer/opt-in` ni un flujo de UI para que el usuario retire su consentimiento.

**Estado actual**:
- `POST /api/customer/opt-in` → crea el registro de consentimiento (C-19 implementado)
- `DELETE /api/customer/opt-in` → **NO EXISTE**. No hay endpoint, no hay servicio, no hay UI.

**Riesgo**: Si un diner solicita eliminar sus datos personales (nombre, email), el operador del restaurante no tiene herramienta en el sistema para hacerlo. El proceso actual requeriría intervención manual directa en la base de datos.

**Workaround actual**: El operador puede hacer soft-delete del registro `customer` manualmente vía admin (no implementado tampoco). Se documenta como deuda técnica crítica pre-launch.

**Próximos pasos**:
- Crear change `customer-consent-withdrawal` con:
  - `DELETE /api/customer/opt-in` → limpia `name`, `email`, `consent_ip_hash`, setea `opted_in = False`, `consent_version = NULL`
  - Soft-delete de datos PII, **no** del registro `customer` (se mantiene `device_id` + `tenant_id` para tracking anónimo)
  - Endpoint en `pwaMenu/src/services/customerApi.ts` → `revokeConsent()`
  - UI en ProfilePage con botón "Eliminar mis datos"
  - Test de regresión GDPR

---

## (b) Reversal / chargeback MP fuera de scope

**Gap**: El flujo implementado cubre el camino feliz: `preference → MP checkout → PAYMENT_APPROVED`. **No cubre**:
- Reversals iniciados por el titular de la tarjeta ante su banco (chargeback).
- Reembolsos iniciados por el comercio (refund via MP API).
- Disputas abiertas en el portal de MP.

**Estado actual**:
- El webhook de MercadoPago (`POST /api/billing/payment/webhook`) procesa `payment.approved` y `payment.rejected`. Los tipos `payment.refunded` y `payment.chargeback` **no tienen handler** — se reciben pero se ignoran (sin excepción explícita, simplemente no actualizan el estado del `Check`).
- Si un chargeback ocurre después de que el `Check` esté en estado `PAID`, la DB queda inconsistente (Check = PAID, pero el dinero fue devuelto al tarjetahabiente).

**Riesgo**: Pérdida financiera sin detección automática en el sistema. El operador debe monitorear su panel de MP manualmente para detectar chargebacks.

**Workaround actual**: Monitoreo manual en el dashboard de MercadoPago. Alertas manuales por email (MP las envía al comercio).

**Próximos pasos**:
- Change `billing-refunds-chargebacks`:
  - Handler en `BillingService.process_mp_webhook()` para tipos `payment.refunded` y `payment.chargeback`
  - Nuevo estado `Check.status = 'DISPUTED'`
  - Outbox event `CHECK_DISPUTED` para notificación al Dashboard del manager
  - Lógica de reversal de `Allocation` (FIFO inverso)

---

## (c) PCI boundary documentado como redirect-only — nunca toca datos de tarjeta

**Declaración formal**: La implementación de pwaMenu Billing (C-19) opera bajo el modelo **SAQ A** de PCI-DSS (redirect-only).

**Qué significa esto**:

| Elemento | ¿En scope PCI? | Implementación |
|---------|---------------|---------------|
| Números de tarjeta | NO — nunca pasan por nuestro sistema | `mercadoPago.ts` usa `window.location.assign(initPoint)` — redirect puro |
| CVV / CVC | NO | Nunca solicitado ni almacenado |
| Datos del titular | NO | Solo `name` / `email` para loyalty (opt-in) — NO relacionado con el pago |
| Token de tarjeta MP | NO | El SDK de MP corre en el dominio de MP, no en pwaMenu |
| `VITE_MP_PUBLIC_KEY` | Pública por diseño | Expuesta en bundle (intencional — MP public key no es secreta) |
| `MERCADOPAGO_WEBHOOK_SECRET` | Sí, backend | Solo en variables de entorno del servidor. NUNCA en frontend. |

**Verificación técnica**:
- `pwaMenu/src/services/mercadoPago.ts`: cero imports de `@mercadopago/sdk-react` o similar.
- Script post-build `pwaMenu/scripts/check-pci-bundle.sh` falla si detecta `card_number|cvv|cardholder|/v1/card_tokens` en el bundle.
- No hay campos `<input type="text" name="cardNumber">` ni similares en ningún componente de pwaMenu.
- El flujo es: pwaMenu → `POST /api/billing/payment/preference` → backend → MP Checkout API → `initPoint` URL → `window.location.assign(initPoint)` → diner sale del dominio de pwaMenu.

**Responsabilidad**: Toda la interacción con datos de tarjeta ocurre dentro del dominio `*.mercadopago.com` (o `*.mercadolibre.com`). pwaMenu solo recibe `payment_id`, `preference_id`, `status` como query params en el redirect de vuelta — **nunca datos de tarjeta**.

**Certificación requerida**: Antes del go-live con pagos reales, completar el SAQ A de PCI-DSS con el comercio (restaurante) como responsable del merchant account de MP.

---

## Resumen de gaps por criticidad

| Gap | Criticidad | Acción requerida | Deadline |
|-----|-----------|-----------------|---------|
| Retiro de consent (DELETE /opt-in) | ALTO — GDPR/LGPD | Implementar en change separado | Antes del go-live |
| Reversal/chargeback MP | MEDIO | Implementar en change separado | Post-launch (sprint 2) |
| PCI boundary SAQ A | BAJO — documentado | Firmar SAQ A con MP antes de producción | Antes del go-live |

---

*Este documento debe actualizarse cuando alguno de los gaps sea cerrado. Los tres ítems deben ser revisados por el responsable de seguridad antes del merge a producción del change pwamenu-billing.*
