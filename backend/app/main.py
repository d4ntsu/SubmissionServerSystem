from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import logging

from app.core.config import settings
from app.database import Base, engine
from app.models import *  # noqa: F401,F403 - register all models for metadata
from app.api import auth, exams, questions, test_cases, submissions, results

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="LAN Programming Exam System", version="0.1.0")

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

_worker_stop_event: asyncio.Event | None = None
_worker_task: asyncio.Task | None = None


@app.on_event("startup")
async def start_grading_worker():
    global _worker_stop_event, _worker_task
    from app.workers.grading_worker import run_grading_worker

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
    logger.info("Grading worker stopped")


@app.get("/health")
def health_check():
    return {"status": "ok"}