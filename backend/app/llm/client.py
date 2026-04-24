"""Thin async HTTP client for the qwen-eval /render endpoint.

The endpoint lives on the user's 5070Ti and is exposed on the server via an
SSH reverse tunnel (127.0.0.1:8001). Returns None on any failure — timeout,
connection refused, HTTP 5xx, invalid JSON — so callers can fall back to
deterministic output without exception handling.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

log = logging.getLogger(__name__)


class LLMClient:
    def __init__(self, render_url: str, *, timeout_s: float = 8.0) -> None:
        self._url = render_url
        self._timeout = httpx.Timeout(timeout_s, connect=3.0)

    async def render(self, *, intent: str, registry: dict[str, Any]) -> dict[str, Any] | None:
        body = {"intent": intent, "registry": registry}
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as http:
                resp = await http.post(self._url, json=body)
        except httpx.HTTPError as e:
            log.warning("llm.render transport failed (%s): %s", type(e).__name__, e)
            return None

        log.info(
            "llm.render intent=%r status=%s ct=%s body=%s",
            intent[:80], resp.status_code,
            resp.headers.get("content-type"),
            resp.text[:400],
        )

        if resp.status_code >= 400:
            # Still try to surface any prose in the body.
            try:
                return resp.json()
            except ValueError:
                text = resp.text.strip()
                return {"text": text} if text else None

        try:
            return resp.json()
        except ValueError:
            text = resp.text.strip()
            return {"text": text} if text else None
