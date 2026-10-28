"""Seed the database with default teacher and mock student accounts.

Usage:
    python -m app.cli seed           # create default accounts (skip if exist)
    python -m app.cli seed --force   # wipe everything and re-seed
    python -m app.cli list           # list all users in the database
"""

import argparse
import random
import sys


def _hash_password(plain: str) -> str:
    from app.core.security import hash_password as _hp
    return _hp(plain)


def _ensure_tables() -> None:
    """Create tables if they don't exist yet (safe to call repeatedly)."""
    from app.database import Base, engine
    import app.models  # noqa: F401 — register all models
    Base.metadata.create_all(bind=engine)


def _teacher_exists() -> bool:
    from app.database import SessionLocal
    from app.models.user import User
    db = SessionLocal()
    try:
        return db.query(User).filter(User.username == "teacher1").count() > 0
    finally:
        db.close()


def _seed_users(force: bool = False) -> None:
    from app.database import SessionLocal
    from app.models.user import User, UserRole

    _ensure_tables()
    db = SessionLocal()
    try:
        if force:
                    print("  Dropping existing data (FK-safe order) ...")
                    from app.models.submission import SubmissionTestResult, Submission
                    from app.models.test_case import TestCase
                    from app.models.question import Question
                    from app.models.exam import Exam, ExamParticipant
                    from app.models.announcement import Announcement
                    for model in (SubmissionTestResult, Submission, ExamParticipant, Announcement, TestCase, Question, Exam, User):
                        db.query(model).delete()
                    db.commit()

        if not force and _teacher_exists():
            print("  Default accounts already exist (use --force to re-seed).")
            return

        students = 5
        seeds: list[tuple[str, str, str, UserRole]] = []

        teacher_pw = "123456"
        seeds.append(("teacher1", teacher_pw, "Teacher", UserRole.teacher))

        seen_usernames = set()
        for _ in range(students):
            while True:
                uid = "230104" + f"{random.randint(0, 9999):04d}"
                if uid not in seen_usernames:
                    break
            seen_usernames.add(uid)
            day = random.randint(1, 28)
            month = random.randint(1, 12)
            yy = random.randint(0, 99)
            pw = f"{day:02d}{month:02d}{yy:02d}"
            seeds.append((uid, pw, f"Student {uid}", UserRole.student))

        for username, pw, full_name, role in seeds:
            user = User(
                username=username,
                hashed_password=_hash_password(pw),
                full_name=full_name,
                role=role,
                is_online=0,
            )
            db.add(user)
        db.commit()

        print(f"  Seeded {len(seeds)} account(s):")
        for username, pw, full_name, role in seeds:
            print(f"    [{role.value:7s}] {username:12s} / {pw:6s}")
    finally:
        db.close()


def _list_users() -> None:
    from app.database import SessionLocal
    from app.models.user import User

    _ensure_tables()
    db = SessionLocal()
    try:
        rows = db.query(User).order_by(User.id).all()
        if not rows:
            print("  No users found in the database.")
            return
        print(f"  {len(rows)} user(s):")
        for u in rows:
            print(f"    id={u.id:2d}  {u.username:14s}  role={u.role.value:8s}  {u.full_name}")
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="python -m app.cli",
        description="Manage the LAN Exam System database — seed accounts, list users.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    seed_parser = sub.add_parser("seed", help="Create default teacher + student accounts")
    seed_parser.add_argument(
        "--force", "-f",
        action="store_true",
        help="Delete all existing users first, then re-seed",
    )

    sub.add_parser("list", help="List all users in the database")

    args = parser.parse_args()

    if args.command == "seed":
        _seed_users(force=args.force)
    elif args.command == "list":
        _list_users()


if __name__ == "__main__":
    main()
