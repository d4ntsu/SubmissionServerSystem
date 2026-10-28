import os

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

db_path = settings.database_url.replace("sqlite:///", "")
os.makedirs(os.path.dirname(db_path), exist_ok=True)

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {},
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, connection_record):
    """Enable WAL mode on every connection (belt-and-suspenders with the URL param)."""
    if "sqlite" in settings.database_url:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def ensure_user_presence_schema() -> None:
    """Add presence metadata to databases created before last_seen_at existed."""
    with engine.begin() as connection:
        columns = {
            column["name"] for column in inspect(connection).get_columns("users")
        }
        if "last_seen_at" not in columns:
            connection.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN last_seen_at DATETIME"
            )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def run_lightweight_migrations() -> None:
    """Add columns introduced after the initial schema without requiring Alembic."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    with engine.begin() as connection:
        if "exams" in tables:
            columns = {column["name"] for column in inspector.get_columns("exams")}
            if "access_password_hash" not in columns:
                connection.execute(
                    text("ALTER TABLE exams ADD COLUMN access_password_hash VARCHAR(255)")
                )
        if "questions" in tables:
            columns = {column["name"] for column in inspector.get_columns("questions")}
            if "method_mode" not in columns:
                connection.execute(
                    text("ALTER TABLE questions ADD COLUMN method_mode VARCHAR(10) NOT NULL DEFAULT 'STATIC'")
                )
            if "boilerplate" not in columns:
                connection.execute(
                    text("ALTER TABLE questions ADD COLUMN boilerplate TEXT NOT NULL DEFAULT ''")
                )
