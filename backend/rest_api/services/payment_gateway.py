"""
PaymentGateway ABC — abstraction for payment processor integrations (C-12).

Architecture decision (D-03 from design.md):
  - `PaymentGateway` is the interface (ABC). Domain services depend on this
    abstract type, not on any concrete implementation.
  - `MercadoPagoGateway` is the concrete implementation (in mercadopago_gateway.py).
  - The gateway is injected via FastAPI DI — routers receive it as a dependency.
  - This enables testing BillingService with a mock gateway without hitting
    the MercadoPago API.

Usage in a router:
    from rest_api.services.payment_gateway import PaymentGateway
    from rest_api.core.dependencies import get_payment_gateway

    @router.post("/payment/preference")
    async def create_preference(
        body: MPPreferenceBody,
        gateway: PaymentGateway = Depends(get_payment_gateway),
        ...
    ):
        ...

Clean Architecture rule: BillingService depends on PaymentGateway (interface),
NOT on MercadoPagoGateway (implementation).
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class WebhookEvent:
    """
    Normalized webhook event from a payment gateway.

    Attributes:
        external_id: Payment ID in the payment gateway system (MP payment_id).
        status: Normalized status — "approved" | "rejected" | "pending".
        amount_cents: Amount in integer cents.
    """

    external_id: str
    status: str
    amount_cents: int


class PaymentGateway(ABC):
    """
    Abstract base class for payment gateway integrations.

    All methods are async. Concrete implementations (MercadoPagoGateway)
    must not be referenced directly in domain services or routers.

    BillingService receives an instance of PaymentGateway via dependency
    injection and calls these methods without knowing the concrete type.
    """

    @abstractmethod
    async def create_preference(
        self,
        check_id: int,
        total_cents: int,
        items: list[dict],
        back_urls: dict[str, str] | None = None,
    ) -> tuple[str, str]:
        """
        Create a payment preference in the gateway.

        Args:
            check_id: Internal check ID (used for back_url and tracking).
            total_cents: Total amount in integer cents.
            items: List of item dicts with title, unit_price (cents), quantity.
            back_urls: Optional override for success/failure/pending redirect URLs.

        Returns:
            Tuple of (preference_id, init_point) — both are strings.
            preference_id: Internal MP preference ID.
            init_point: URL to redirect user to checkout.
        """
        ...

    @abstractmethod
    async def verify_webhook(
        self,
        payload: bytes,
        signature: str,
    ) -> WebhookEvent:
        """
        Verify and parse an incoming webhook event.

        Args:
            payload: Raw request body bytes.
            signature: HMAC-SHA256 signature from the x-signature header.

        Returns:
            Parsed WebhookEvent with normalized status and amount.

        Raises:
            ValueError: If the signature is invalid (should result in 400 response).
        """
        ...
