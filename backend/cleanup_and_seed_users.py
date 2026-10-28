"""One-off cleanup + seed: wipe test data and create mock teacher/student accounts."""

import datetime
import os
import random
import sqlite3

DB_PATH = os.path.join("data", "exam_system.db")

# ---------------------------------------------------------------------------
# 1. Hash helper (matches app.core.security: passlib bcrypt, or bcrypt fallback)
# ---------------------------------------------------------------------------
try:
    from passlib.context import CryptContext

    _pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
    _USING = "passlib"

    def _hash(pw: str) -> str:
        return _pwd_ctx.hash(pw)

    def _verify(pw: str, h: str) -> bool:
        return _pwd_ctx.verify(pw, h)

except Exception:
    import bcrypt as _bcrypt

    _USING = "bcrypt"

    def _hash(pw: str) -> str:
        return _bcrypt.hashpw(pw.encode(), _bcrypt.gensalt()).decode()

    def _verify(pw: str, h: str) -> bool:
        return _bcrypt.checkpw(pw.encode(), h.encode())

# ---------------------------------------------------------------------------
# 2. Back up the database (consistent snapshot, includes WAL state)
# ---------------------------------------------------------------------------
stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
backup_path = os.path.join("data", f"backup_exam_system_before_cleanup_{stamp}.db")
con = sqlite3.connect(DB_PATH)
con.execute("PRAGMA foreign_keys = ON")
try:
    con.executescript(f"VACUUM INTO '{backup_path}';")
    print(f"[1/4] Backup written to {backup_path}")
except sqlite3.OperationalError as e:
    print(f"[1/4] Backup skipped: {e}")

# ---------------------------------------------------------------------------
# 3. Wipe all existing rows in FK-safe order
# ---------------------------------------------------------------------------
tables = [
    "submission_test_results",
    "submissions",
    "exam_participants",
    "announcements",
    "test_cases",
    "questions",
    "exams",
    "users",
]
for t in tables:
    con.execute(f"DELETE FROM {t}")
# Reset AUTOINCREMENT counters if the table exists (SQLite creates it lazily)
try:
    con.execute("DELETE FROM sqlite_sequence")
except sqlite3.OperationalError:
    pass
con.commit()
print("[2/4] Wiped all existing rows (users, exams, questions, test cases, submissions, announcements, participants)")

# ---------------------------------------------------------------------------
# 4. Seed accounts
# ---------------------------------------------------------------------------

def random_birthday_password() -> str:
    """dd/mm/yy as 6 digits, e.g. 230205 -> day 23, month 02, year 05."""
    day = random.randint(1, 28)
    month = random.randint(1, 12)
    yy = random.randint(0, 99)
    return f"{day:02d}{month:02d}{yy:02d}"


def random_student_username() -> str:
    """230104 + 4 random digits, e.g. 2301041234."""
    return "230104" + f"{random.randint(0, 9999):04d}"


seeds = []  # (username, plaintext_password, full_name, role)

# Teacher account
teacher_pw = "123456"
seeds.append(("teacher1", teacher_pw, "Teacher", "teacher"))

# Mock students
seen = set()
for _ in range(5):
    u = random_student_username()
    while u in seen:
        u = random_student_username()
    seen.add(u)
    seeds.append((u, random_birthday_password(), f"Student {u}", "student"))

for username, pw, full_name, role in seeds:
    con.execute(
        "INSERT INTO users (username, hashed_password, full_name, role, is_online) VALUES (?, ?, ?, ?, 0)",
        (username, _hash(pw), full_name, role),
    )
con.commit()
print("[3/4] Seeded 1 teacher + 5 students")

# ---------------------------------------------------------------------------
# 5. Verify
# ---------------------------------------------------------------------------
print("[4/4] Verification:")
print(f"  users total           : {con.execute('SELECT COUNT(*) FROM users').fetchone()[0]}")
print(f"  exams total           : {con.execute('SELECT COUNT(*) FROM exams').fetchone()[0]}")
print(f"  submissions total     : {con.execute('SELECT COUNT(*) FROM submissions').fetchone()[0]}")
print()
print("  Credentials (username / password):")
for username, pw, full_name, role in seeds:
    row = con.execute(
        "SELECT hashed_password FROM users WHERE username = ?", (username,)
    ).fetchone()
    ok = _verify(pw, row[0])
    print(f"    [{role:7s}] {username:12s} / {pw:6s}   hash_check={'OK' if ok else 'FAILED'}")

# Quick look at the duplicate DB at repo root (read-only, informational)
root_db = os.path.join(os.pardir, "data", "exam_system.db")
if os.path.exists(root_db):
    try:
        rcon = sqlite3.connect(f"file:{root_db}?mode=ro", uri=True)
        try:
            n = rcon.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            print(f"\n  NOTE: root data/exam_system.db also exists with {n} users (left untouched)")
        except sqlite3.OperationalError:
            print("\n  NOTE: root data/exam_system.db exists but has no users table (left untouched)")
        finally:
            rcon.close()
    except sqlite3.Error as e:
        print(f"\n  NOTE: could not inspect root data/exam_system.db: {e} (left untouched)")

con.close()