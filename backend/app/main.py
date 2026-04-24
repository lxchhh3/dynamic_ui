import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import create_all

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    force=True,
)
logging.getLogger("app").setLevel(settings.log_level.upper())

from .routers import auth as auth_router  # noqa: E402
from .routers import chat as chat_router  # noqa: E402
from .routers import gates as gates_router  # noqa: E402


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await create_all()
    yield


app = FastAPI(title="custom_ui", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(gates_router.router)
app.include_router(chat_router.router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "service": "custom_ui"}
