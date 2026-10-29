from sqlalchemy import create_engine, inspect, text

from app import database


def test_lightweight_migration_adds_question_fields_to_existing_questions(tmp_path, monkeypatch):
    legacy_engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    try:
        with legacy_engine.begin() as connection:
            connection.execute(text("CREATE TABLE exams (id INTEGER PRIMARY KEY)"))
            connection.execute(
                text("CREATE TABLE questions (id INTEGER PRIMARY KEY, mc_correct_answers TEXT)")
            )
            connection.execute(
                text(
                    "INSERT INTO questions (id, mc_correct_answers) VALUES "
                    "(1, 'A, C'), (2, 'B')"
                )
            )

        monkeypatch.setattr(database, "engine", legacy_engine)
        database.run_lightweight_migrations()

        columns = {column["name"] for column in inspect(legacy_engine).get_columns("questions")}
        with legacy_engine.connect() as connection:
            boilerplate = connection.execute(
                text("SELECT boilerplate FROM questions WHERE id = 1")
            ).scalar_one()
            mc_allow_multiple = connection.execute(
                text("SELECT mc_allow_multiple FROM questions WHERE id = 1")
            ).scalar_one()
            single_answer_mode = connection.execute(
                text("SELECT mc_allow_multiple FROM questions WHERE id = 2")
            ).scalar_one()
            show_result_to_student = connection.execute(
                text("SELECT show_result_to_student FROM questions WHERE id = 1")
            ).scalar_one()

        assert "boilerplate" in columns
        assert boilerplate == ""
        assert "mc_allow_multiple" in columns
        assert mc_allow_multiple == 1
        assert single_answer_mode == 0
        assert "show_result_to_student" in columns
        assert show_result_to_student == 1
    finally:
        legacy_engine.dispose()
