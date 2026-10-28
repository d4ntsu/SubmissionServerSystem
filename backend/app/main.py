from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import logging

from app.core.config import settings
from app.database import (
    Base,
    SessionLocal,
    engine,
    ensure_refresh_session_schema,
    ensure_user_presence_schema,
    run_lightweight_migrations,
)
from app.models import *  # noqa: F401,F403 - register all models for metadata
from app.api import auth, exams, questions, test_cases, submissions, results, realtime
from app.realtime.bridge import RealtimeBridge
from app.realtime.event_router import RealtimeEventRouter
from app.realtime.manager import realtime_manager
from app.realtime.submission_events import configure_submission_event_transport

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

Base.metadata.create_all(bind=engine)
ensure_refresh_session_schema()
ensure_user_presence_schema()
run_lightweight_migrations()

app = FastAPI(title="LAN Programming Exam System", version="0.1.0")
app.state.realtime_manager = realtime_manager


async def _dispatch_java_realtime_event(event: dict) -> None:
    db = SessionLocal()
    try:
        await app.state.realtime_manager.publish_bridge_event(event, db)
    finally:
        db.close()


java_event_router = RealtimeEventRouter()
java_event_router.subscribe(_dispatch_java_realtime_event)
app.state.realtime_event_router = java_event_router

realtime_bridge = RealtimeBridge(
    settings.socket_server_host,
    settings.socket_server_port,
    settings.socket_server_shared_secret,
    event_router=java_event_router,
)
app.state.realtime_bridge = realtime_bridge
configure_submission_event_transport(realtime_bridge.send)

origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(exams.router)
app.include_router(questions.router)
app.include_router(test_cases.router)
app.include_router(submissions.router)
app.include_router(results.router)
app.include_router(realtime.router)

_worker_stop_event: asyncio.Event | None = None
_worker_task: asyncio.Task | None = None


@app.on_event("startup")
async def start_realtime_bridge():
    connected = await realtime_bridge.connect()
    if not connected:
        logger.warning("Java realtime server is unavailable; bridge reconnect will continue in the background")


@app.on_event("shutdown")
async def stop_realtime_bridge():
    await realtime_bridge.disconnect()


@app.on_event("startup")
async def start_grading_worker():
    global _worker_stop_event, _worker_task
    from app.workers.grading_worker import run_grading_worker

    await asyncio.to_thread(app.state.realtime_manager.reset_stale_presence)
    _worker_stop_event = asyncio.Event()
    _worker_task = asyncio.create_task(run_grading_worker(_worker_stop_event))
    logger.info("Grading worker task created")


@app.on_event("shutdown")
async def stop_grading_worker():
    global _worker_stop_event, _worker_task
    if _worker_stop_event:
        _worker_stop_event.set()
    if _worker_task:
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
    await app.state.realtime_manager.shutdown()
    logger.info("Grading worker stopped")


@app.get("/health")
def health_check():
    return {"status": "ok"}
