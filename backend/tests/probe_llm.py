"""Probe the live LLM /render endpoint and show the raw response.

Usage (from backend/ with venv active):

    # On the VPS (tunnel terminates at 172.19.0.1:8001):
    python -m tests.probe_llm http://172.19.0.1:8001/render

    # Or pass a custom URL:
    python -m tests.probe_llm https://secretseasoning.top/api/render

Runs a few prompts covering both modes (action-style and conversational) and
prints the exact response body + parsed JSON shape so we can align the adapter.
"""
from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

import httpx

from app.llm.registry import FULL_REGISTRY

PROMPTS = [
    "open gate 7",                     # expected: structured, GateCard
    "list gates",                      # expected: structured, GateGrid
    "hi there, how are you?",          # expected: prose
    "what is this site?",              # expected: prose
    "who can access gate 3",           # expected: structured, AccessList
]


async def probe(url: str) -> None:
    timeout = httpx.Timeout(15.0, connect=5.0)
    async with httpx.AsyncClient(timeout=timeout) as http:
        for prompt in PROMPTS:
            print("=" * 70)
            print(f"PROMPT: {prompt!r}")
            body = {"intent": prompt, "registry": FULL_REGISTRY}
            try:
                resp = await http.post(url, json=body)
            except httpx.HTTPError as e:
                print(f"  HTTP ERROR: {type(e).__name__}: {e}")
                continue
            print(f"  status={resp.status_code} content-type={resp.headers.get('content-type')}")
            raw = resp.text
            print(f"  RAW BODY (first 800 chars):\n{raw[:800]}")
            try:
                parsed: Any = json.loads(raw)
                if isinstance(parsed, dict):
                    print(f"  PARSED KEYS: {list(parsed.keys())}")
                    print(f"  component={parsed.get('component')!r}")
                    print(f"  valid={parsed.get('valid')!r}")
                    if "props" in parsed and isinstance(parsed["props"], dict):
                        print(f"  props keys: {list(parsed['props'].keys())}")
                else:
                    print(f"  PARSED (non-dict): {type(parsed).__name__}")
            except json.JSONDecodeError:
                print("  NOT JSON — plain text body")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    asyncio.run(probe(sys.argv[1]))
