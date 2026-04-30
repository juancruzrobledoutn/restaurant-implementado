"""
Diner-facing service-call endpoint (C-11).

CLEAN-ARCH: Thin router — Table-Token auth only. Diners press "llamar al mozo"
in pwaMenu; this endpoint creates a ServiceCall row and writes the
SERVICE_CALL_CREATED outbox event in the same transaction.

Rate limit: 3/minute per session_id (design.md §D-06).
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from shared.security.table_token import TableContext, current_table_context
from shared.utils.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
)
from rest_api.core.limiter import limiter
from rest_api.schemas.service_call import ServiceCallOutput
from rest_api.services.domain import ServiceCallService

router = APIRouter(tags=["diner-service-call"])


def _session_key(request: Request) -> str:
    """
    SlowAPI key function — keyed by session_id from the TableContext.

    Falls back to the raw X-Table-Token header if session state is not yet
    populated (defensive — auth runs before the limiter decorator in
    practice, but we keep this fallback so misconfigurations fail-soft).
    """
    session_id = getattr(request.state, "service_call_session_id", None)
    if session_id is not None:
        return f"svc_call:{session_id}"
    token = request.headers.get("X-Table-Token", "anon")
    return f"svc_call:{token}"


@router.post(
    "/diner/service-call",
    response_model=ServiceCallOutput,
    status_code=201,
    summary="Diner requests the waiter (Table Token)",
)
@limiter.limit("3/minute", key_func=_session_key)
async def create_service_call(
    request: Request,
    ctx: TableContext = Depends(current_table_context),
    db: AsyncSession = Depends(get_db),
) -> ServiceCallOutput:
    # Expose the session id on request.state so the rate-limit keyer can
    # use it (the decorator evaluates its key_func after the route is called,
    # so this runs in the right order).
    request.state.service_call_session_id = ctx.session.id

    service = ServiceCallService(db)
    try:
        call = await service.create(
            session_id=ctx.session.id,
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ConflictError as exc:
        # D-05: duplicate-guard returns the existing call's id so the
        # client can re-use it instead of creating a dupe.
        detail: dict[str, object] = {"message": str(exc)}
        if exc.code == "service_call_already_open":
            # Parse id out of the message if present — safer than threading
            # the id through the exception's code/message. Future refactor:
            # add a dedicated exception with a structured payload.
            import re

            match = re.search(r"id=(\d+)", str(exc))
            if match:
                detail["existing_service_call_id"] = int(match.group(1))
                detail["code"] = "service_call_already_open"
        raise HTTPException(status_code=409, detail=detail)

    return ServiceCallOutput.model_validate(call)
