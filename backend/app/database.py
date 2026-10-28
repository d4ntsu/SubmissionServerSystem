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
    if "exams" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("exams")}
    if "access_password_hash" not in columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE exams ADD COLUMN access_password_hash VARCHAR(255)"))


def ensure_refresh_session_schema() -> None:
    """Upgrade refresh-session tables created by earlier development versions."""
    inspector = inspect(engine)
    if "refresh_sessions" not in inspector.get_table_names():
        return

    columns = {
        column["name"] for column in inspector.get_columns("refresh_sessions")
    }
    with engine.begin() as connection:
        if "family_id" not in columns:
            connection.exec_driver_sql(
                "ALTER TABLE refresh_sessions ADD COLUMN family_id VARCHAR(36)"
            )
        if "replaced_by_hash" not in columns:
            connection.exec_driver_sql(
                "ALTER TABLE refresh_sessions ADD COLUMN replaced_by_hash VARCHAR(64)"
            )

        previous_hash_column = (
            "previous_token_hash" if "previous_token_hash" in columns else "NULL"
        )
        rotated_at_column = "rotated_at" if "rotated_at" in columns else "NULL"
        rows = connection.execute(
            text(
                "SELECT id, token_hash, "
                f"{previous_hash_column} AS previous_token_hash, "
                f"{rotated_at_column} AS rotated_at, revoked_at "
                "FROM refresh_sessions"
            )
        ).mappings().all()
        token_to_id = {row["token_hash"]: row["id"] for row in rows}
        parent_by_id = {
            row["id"]: token_to_id.get(row["previous_token_hash"])
            for row in rows
            if row["previous_token_hash"]
        }
        child_by_hash = {
            row["previous_token_hash"]: row["token_hash"]
            for row in rows
            if row["previous_token_hash"]
        }

        for row in rows:
            root_id = row["id"]
            visited: set[int] = set()
            while root_id in parent_by_id and root_id not in visited:
                visited.add(root_id)
                root_id = parent_by_id[root_id]

            connection.execute(
                text(
                    "UPDATE refresh_sessions SET family_id = :family_id, "
                    "replaced_by_hash = COALESCE(replaced_by_hash, :replaced_by_hash), "
                    "revoked_at = COALESCE(revoked_at, rotated_at) "
                    "WHERE id = :id"
                ),
                {
                    "family_id": str(root_id),
                    "replaced_by_hash": child_by_hash.get(row["token_hash"]),
                    "id": row["id"],
                },
            )

        connection.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS "
            "ix_refresh_sessions_token_hash_unique ON refresh_sessions (token_hash)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_refresh_sessions_family_id "
            "ON refresh_sessions (family_id)"
        )
