import pytest


def pytest_collection_modifyitems(config, items):
    for item in items:
        if "asyncio" in item.keywords:
            continue
        # auto-mark coroutine tests so we don't need a decorator on every one
        if pytest.iscoroutinefunction(getattr(item, "function", None)):
            item.add_marker(pytest.mark.asyncio)
