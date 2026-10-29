from sqlalchemy import create_engine, inspect, text

from app import database


def test_lightweight_migration_adds_boilerplate_to_existing_questions(tmp_path, monkeypatch):
    legacy_engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    try:
        with legacy_engine.begin() as connection:
            connection.execute(text("CREATE TABLE exams (id INTEGER PRIMARY KEY)"))
            connection.execute(text("CREATE TABLE questions (id INTEGER PRIMARY KEY)"))
            connection.execute(text("INSERT INTO questions (id) VALUES (1)"))

        monkeypatch.setattr(database, "engine", legacy_engine)
        database.run_lightweight_migrations()

        columns = {column["name"] for column in inspect(legacy_engine).get_columns("questions")}
        with legacy_engine.connect() as connection:
            boilerplate = connection.execute(
                text("SELECT boilerplate FROM questions WHERE id = 1")
            ).scalar_one()

        assert "boilerplate" in columns
        assert boilerplate == ""
    finally:
        legacy_engine.dispose()
