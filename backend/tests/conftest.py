import inspect
import os

# Set BEFORE app.* is imported anywhere — db.py opens an engine at module-load.
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret")

import pytest


def pytest_collection_modifyitems(config, items):
    for item in items:
        if "asyncio" in item.keywords:
            continue
        # auto-mark coroutine tests so we don't need a decorator on every one
        fn = getattr(item, "function", None)
        if fn is not None and inspect.iscoroutinefunction(fn):
            item.add_marker(pytest.mark.asyncio)
