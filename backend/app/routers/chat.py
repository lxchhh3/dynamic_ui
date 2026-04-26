import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from ..config import settings
from ..deps import CurrentUser, DbSession
from ..intents.executor import execute
from ..intents.parser import parse
from ..llm import LLMClient
from ..models import ChatLog

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])

_llm: LLMClient | None = (
    LLMClient(settings.llm_render_url) if settings.llm_render_url else None
)
if _llm is None:
    log.warning("LLM_RENDER_URL not set — chat will use deterministic fallback only")
else:
    log.info("LLM hybrid enabled → %s", settings.llm_render_url)


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=500)


def _summarize(blocks: list[dict]) -> tuple[str, str]:
    """Return (outcome, summary_text) for ChatLog."""
    outcome = "ok"
    for b in blocks:
        if b.get("type") == "Toast":
            outcome = b.get("props", {}).get("variant", "ok")
            break
    parts: list[str] = []
    for b in blocks:
        t = b.get("type")
        props = b.get("props", {})
        if t == "AssistantMessage":
            parts.append(f"msg:{(props.get('text') or '')[:120]}")
        elif t == "Toast":
            parts.append(f"toast[{props.get('variant')}]:{(props.get('text') or '')[:80]}")
        elif t == "GateCard":
            parts.append(f"gate{props.get('id')}={props.get('status')}")
        elif t == "GateGrid":
            parts.append(f"grid({len(props.get('gates') or [])})")
        elif t == "AccessList":
            parts.append(f"access[gate{props.get('gateId')}:{len(props.get('users') or [])}]")
        elif t == "RequestCard":
            parts.append(
                f"req#{props.get('id')}[gate{props.get('gateId')}:{props.get('status')}]"
            )
        elif t == "RequestList":
            parts.append(f"req-list({len(props.get('requests') or [])})")
        elif t == "Alert":
            parts.append(f"alert:{(props.get('text') or '')[:80]}")
    return outcome, " | ".join(parts)[:500]


@router.post("")
async def chat(body: ChatIn, user: CurrentUser, session: DbSession):
    intent = parse(body.message)

    async def stream() -> AsyncIterator[dict]:
        collected: list[dict] = []
        user_id = user.id
        try:
            async for block in execute(session, user, intent, llm=_llm):
                collected.append(block)
                yield {"event": "block", "data": json.dumps(block)}
        except Exception:
            log.exception("chat.execute failed")
            yield {"event": "block", "data": json.dumps(
                {"type": "Toast", "props": {"variant": "error", "text": "server error"}}
            )}
        # ChatLog is best-effort — never let it break the stream.
        try:
            outcome, summary = _summarize(collected)
            session.add(
                ChatLog(
                    user_id=user_id,
                    input_text=body.message[:500],
                    intent_kind=intent.kind.value,
                    outcome=outcome,
                    response_summary=summary,
                )
            )
            await session.commit()
        except Exception:
            log.exception("chat_log write failed")
            try:
                await session.rollback()
            except Exception:
                pass
        yield {"event": "done", "data": ""}

    return EventSourceResponse(stream(), ping=15)
