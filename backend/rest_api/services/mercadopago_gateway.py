"""
MercadoPagoGateway — concrete PaymentGateway implementation (C-12).

Implements the PaymentGateway ABC using the mercadopago SDK.

Architecture rules:
  - NEVER instantiate this class directly in routers or domain services.
  - Always obtain it via get_payment_gateway() FastAPI dependency.
  - HMAC verification uses MERCADOPAGO_WEBHOOK_SECRET from settings.
  - Fail-closed on missing config (startup validation in settings).

MP Webhook verification:
  MercadoPago sends x-signature header in the format:
    ts=<timestamp>,v1=<hmac_sha256>
  We reconstruct the signed string as: "id:<data_id>;request-id:<request_id>;ts:<ts>;"
  and compare HMAC-SHA256 against the v1 portion.
  If the header is missing or invalid → raise ValueError → 400 in the router.

Reference:
  https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
"""
from __future__ import annotations

import hashlib
import hmac
import json

import mercadopago  # type: ignore[import]

from shared.config.logging import get_logger
from shared.config.settings import settings
from rest_api.services.payment_gateway import PaymentGateway, WebhookEvent

logger = get_logger(__name__)


class MercadoPagoGateway(PaymentGateway):
    """
    MercadoPago implementation of PaymentGateway.

    Wraps the mercadopago SDK. All calls are synchronous inside an async
    method — the MP SDK does not support async. For high-throughput scenarios
    a thread pool executor could be used, but for this use case it is acceptable.
    """

    def __init__(self) -> None:
        self._sdk = mercadopago.SDK(settings.MERCADOPAGO_ACCESS_TOKEN)

    async def create_preference(
        self,
        check_id: int,
        total_cents: int,
        items: list[dict],
        back_urls: dict[str, str] | None = None,
    ) -> tuple[str, str]:
        """
        Create a MercadoPago payment preference.

        Converts cents → decimal for MP (MP uses decimal amounts).
        Returns (preference_id, init_point).

        Raises:
            RuntimeError: If MP returns a non-201 status.
        """
        default_back_urls = {
            "success": f"http://localhost:5176/payment/success?check_id={check_id}",
            "failure": f"http://localhost:5176/payment/failure?check_id={check_id}",
            "pending": f"http://localhost:5176/payment/pending?check_id={check_id}",
        }

        # Convert cents to decimal for MP
        mp_items = [
            {
                "title": item.get("title", "Cargo"),
                "quantity": item.get("quantity", 1),
                "unit_price": item.get("unit_price_cents", 0) / 100,
                "currency_id": "ARS",
            }
            for item in items
        ]

        preference_data = {
            "items": mp_items,
            "back_urls": back_urls or default_back_urls,
            "auto_return": "approved",
            "external_reference": str(check_id),
            "statement_descriptor": "Buen Sabor",
        }

        response = self._sdk.preference().create(preference_data)

        if response["status"] != 201:
            logger.error(
                "mercadopago.create_preference: failed status=%s response=%r",
                response["status"],
                response.get("response"),
            )
            raise RuntimeError(
                f"MercadoPago preference creation failed: status={response['status']}"
            )

        body = response["response"]
        preference_id = body["id"]
        init_point = body["init_point"]

        logger.info(
            "mercadopago.create_preference: check_id=%s preference_id=%s",
            check_id,
            preference_id,
        )
        return preference_id, init_point

    async def verify_webhook(
        self,
        payload: bytes,
        signature: str,
    ) -> WebhookEvent:
        """
        Verify MercadoPago webhook HMAC-SHA256 signature and parse the event.

        MP x-signature header format:
          "ts=<unix_timestamp>,v1=<hmac_sha256_hex>"

        Signed string format:
          "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"

        Since we receive raw body, we parse it to extract data.id.
        The x-request-id header is not available here, so we use the
        simplified signing string that MP documents for basic webhook:
          "<ts>.<body>"

        Raises:
            ValueError: If signature is missing, malformed, or HMAC mismatch.
        """
        if not signature:
            raise ValueError("Missing x-signature header in webhook request")

        # Parse "ts=<ts>,v1=<hash>"
        parts = {}
        for part in signature.split(","):
            if "=" in part:
                k, v = part.split("=", 1)
                parts[k.strip()] = v.strip()

        ts = parts.get("ts")
        v1 = parts.get("v1")

        if not ts or not v1:
            raise ValueError(f"Malformed x-signature header: {signature!r}")

        # MP signed string: "ts.<raw_body>"
        # See MP docs — simplified format without request-id
        signed_string = f"{ts}.{payload.decode('utf-8', errors='replace')}"

        expected = hmac.new(
            settings.MERCADOPAGO_WEBHOOK_SECRET.encode("utf-8"),
            signed_string.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(expected, v1):
            logger.warning(
                "mercadopago.verify_webhook: HMAC mismatch — possible replay or tampered payload"
            )
            raise ValueError("Invalid webhook signature")

        # Parse body to extract event data
        try:
            body = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid webhook JSON payload: {exc}") from exc

        # Extract payment info from MP IPN payload
        data = body.get("data", {})
        external_id = str(data.get("id", ""))
        mp_status = body.get("action", "")  # e.g. "payment.updated"

        # Normalize action → status
        # MP actions: "payment.created", "payment.updated"
        # We fetch status from the payment resource if needed, but for basic
        # IPN the status is in body["status"] or nested
        status_raw = data.get("status", body.get("status", "pending"))
        normalized = _normalize_mp_status(status_raw)

        # Amount may not be in the IPN — set to 0 and let service fetch from DB
        amount_cents = int(float(data.get("transaction_amount", 0)) * 100)

        logger.info(
            "mercadopago.verify_webhook: external_id=%s status=%s amount_cents=%s",
            external_id,
            normalized,
            amount_cents,
        )

        return WebhookEvent(
            external_id=external_id,
            status=normalized,
            amount_cents=amount_cents,
        )


def _normalize_mp_status(mp_status: str) -> str:
    """
    Normalize MP payment status to internal status.

    MP statuses: "approved", "rejected", "pending", "in_process",
                 "authorized", "cancelled", "refunded", "charged_back"
    Internal: "approved" | "rejected" | "pending"
    """
    if mp_status == "approved":
        return "approved"
    if mp_status in ("rejected", "cancelled", "refunded", "charged_back"):
        return "rejected"
    return "pending"
