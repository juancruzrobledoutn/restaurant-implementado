## ADDED Requirements

### Requirement: PushSubscription model
The system SHALL store web-push subscriptions in table `push_subscription` with fields: `id` (BigInteger PK), `user_id` (FK to app_user, CASCADE on delete), `endpoint` (String 2048, UNIQUE, not null), `p256dh_key` (String 255, not null), `auth_key` (String 255, not null), `is_active` (Boolean, default True), plus `AuditMixin` fields. Index on `user_id`. Unique constraint on `endpoint` (globally unique per VAPID spec).

#### Scenario: Create a new subscription
- **WHEN** `PushSubscription(user_id=5, endpoint="https://fcm.googleapis.com/...", p256dh_key="B...", auth_key="A...")` is created
- **THEN** the row SHALL be persisted in `push_subscription` with `is_active=True`

#### Scenario: Endpoint global uniqueness
- **WHEN** a subscription with `endpoint=X` already exists
- **AND** another subscription with the same endpoint is inserted
- **THEN** the database SHALL raise a unique constraint violation

---

### Requirement: PushNotificationService
The system SHALL provide a `PushNotificationService` with methods: `subscribe(user_id, endpoint, p256dh_key, auth_key)` (upsert by endpoint), `unsubscribe(user_id, endpoint)`, `send_to_user(user_id, title, body, url=None, icon=None)` (sends to all active subscriptions of the user via `pywebpush.webpush`). The service MUST load VAPID keys from environment variables (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT_EMAIL`). If VAPID env vars are missing, `send_to_user` MUST log a WARNING and return gracefully (fail-open — business flow continues).

#### Scenario: subscribe is idempotent per endpoint
- **WHEN** `subscribe(user_id=5, endpoint="X", p256dh_key="B1", auth_key="A1")` is called
- **AND** a subscription with `endpoint="X"` already exists for `user_id=3`
- **THEN** the service SHALL UPDATE the row to `user_id=5, p256dh_key="B1", auth_key="A1", is_active=True` (upsert)

#### Scenario: send_to_user fans out to all subscriptions
- **WHEN** `send_to_user(user_id=5, title="Pedido listo", body="Mesa INT-01")` is called
- **AND** user 5 has 2 active subscriptions
- **THEN** the service SHALL call `pywebpush.webpush(...)` twice (one per subscription)

#### Scenario: Inactive subscriptions are skipped
- **WHEN** user 5 has 1 active subscription and 1 with `is_active=False`
- **AND** `send_to_user(user_id=5, ...)` is called
- **THEN** the service SHALL invoke `webpush` only for the active one

#### Scenario: VAPID keys missing fails open
- **WHEN** `VAPID_PRIVATE_KEY` is not set
- **AND** `send_to_user` is called
- **THEN** the service SHALL log `WARNING` via `get_logger()` with message "VAPID keys missing — push skipped" and return without raising

#### Scenario: 410 Gone response deactivates subscription
- **WHEN** `pywebpush.webpush(...)` raises `WebPushException` with `response.status_code == 410`
- **THEN** the service SHALL set `is_active=False` on that subscription via `safe_commit(db)` and continue with the next subscription (do not re-raise)

---

### Requirement: Waiter subscribe endpoint
The system SHALL expose `POST /api/waiter/notifications/subscribe` (JWT with WAITER role) that accepts `{endpoint, p256dh_key, auth_key}` and creates/updates the subscription for the authenticated user.

#### Scenario: Subscribe successful
- **WHEN** a WAITER sends `POST /api/waiter/notifications/subscribe` with valid body
- **THEN** the system SHALL call `PushNotificationService.subscribe(user_id=current_user.id, ...)` and return 201 with `{id, endpoint}`

#### Scenario: Re-subscribe same endpoint returns 200 not 409
- **WHEN** a WAITER subscribes an endpoint that already exists for the same user
- **THEN** the system SHALL return 200 with the updated subscription (upsert semantics)

#### Scenario: Non-WAITER rejected
- **WHEN** an ADMIN sends `POST /api/waiter/notifications/subscribe`
- **THEN** the system SHALL return 403 Forbidden

#### Scenario: Invalid VAPID keys rejected
- **WHEN** a WAITER sends `POST /api/waiter/notifications/subscribe` with `endpoint=""`
- **THEN** the system SHALL return 422 Validation Error

---

### Requirement: Waiter unsubscribe endpoint
The system SHALL expose `DELETE /api/waiter/notifications/subscribe?endpoint={url}` (JWT with WAITER role) that deletes the subscription for the authenticated user.

#### Scenario: Unsubscribe removes the row
- **WHEN** a WAITER sends `DELETE /api/waiter/notifications/subscribe?endpoint=X`
- **THEN** the system SHALL delete the subscription (hard delete — ephemeral) and return 204

#### Scenario: Unsubscribe non-existing endpoint is idempotent
- **WHEN** a WAITER sends `DELETE /api/waiter/notifications/subscribe?endpoint=X` for an endpoint that does not exist or belongs to another user
- **THEN** the system SHALL return 204 (idempotent — does not leak existence)
