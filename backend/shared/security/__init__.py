"""
Shared security utilities.

Exports:
  - From auth.py: JWT helpers for staff authentication
  - From table_token.py: HMAC table token for diner authentication (C-08)
"""
from shared.security.table_token import (  # noqa: F401
    AuthenticationError,
    TableContext,
    current_table_context,
    issue_table_token,
    verify_table_token,
)
