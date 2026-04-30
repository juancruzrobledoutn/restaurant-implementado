"""
Shared slowapi rate limiter instance.

Defined here (not in main.py) to avoid circular imports when routers need
to apply @limiter.limit() decorators.

Usage in a router:
    from rest_api.core.limiter import limiter

    @router.post("/login")
    @limiter.limit("5/minute")
    async def login(request: Request, ...):
        ...

Registration in main.py:
    from rest_api.core.limiter import limiter
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

from shared.config.settings import settings

limiter = Limiter(key_func=get_remote_address, storage_uri=settings.REDIS_URL)
