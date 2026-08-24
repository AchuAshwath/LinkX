"""Common utilities and helper functions for LinkX Agentic Supervisor Tools."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from typing import Any

from sqlmodel import Session

from app.core.db import engine


async def get_active_page(*, context: Any) -> Any:
    """Get the primary active page from browser context and close any extra pages/tabs."""
    page = context.pages[0] if context.pages else await context.new_page()
    for p in context.pages[1:]:
        try:
            await p.close()
        except Exception:
            pass
    return page


@contextmanager
def resolve_session(
    *, session: Session | None = None
) -> Generator[Session, None, None]:
    """Yield existing session if provided, or open a temporary engine session."""
    if session is not None:
        yield session
    else:
        with Session(engine) as s:
            yield s
