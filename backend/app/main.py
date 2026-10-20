from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, engine
from app.models import *  # noqa: F401,F403 - register all models for metadata
from app.routers import auth, exams, questions, test_cases

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


@app.get("/health")
def health_check():
    return {"status": "ok"}