import asyncio
import logging

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.submission import Submission, SubmissionStatus
from app.services.grading_service import grade_submission

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 2


async def run_grading_worker(stop_event: asyncio.Event) -> None:
    """Poll the database for queued submissions and grade them one at a time.

    On startup, recover any submissions left in 'running' from a previous crash
    by resetting them to 'queued'.
    """
    _recover_stuck_submissions()
    logger.info("Grading worker started")

    while not stop_event.is_set():
        submission_id = _claim_next_submission()
        if submission_id is not None:
            try:
                await grade_submission(submission_id)
            except Exception:
                logger.exception("Grading worker failed for submission %d", submission_id)
        else:
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=POLL_INTERVAL_SECONDS)
            except asyncio.TimeoutError:
                pass

    logger.info("Grading worker stopped")


def _recover_stuck_submissions() -> None:
    """Reset any 'running' submissions back to 'queued' so they are retried."""
    db = SessionLocal()
    try:
        stuck = (
            db.query(Submission)
            .filter(Submission.status == SubmissionStatus.running)
            .all()
        )
        for sub in stuck:
            sub.status = SubmissionStatus.queued
            sub.error_summary = "Recovered after server restart"
        db.commit()
        if stuck:
            logger.info("Recovered %d stuck submission(s)", len(stuck))
    except Exception:
        db.rollback()
        logger.exception("Failed to recover stuck submissions")
    finally:
        db.close()


def _claim_next_submission() -> int | None:
    """Atomically claim the oldest queued submission and return its ID."""
    db = SessionLocal()
    try:
        submission = (
            db.query(Submission)
            .filter(Submission.status == SubmissionStatus.queued)
            .order_by(Submission.submitted_at.asc())
            .with_for_update()
            .first()
        )
        if submission is None:
            return None
        submission.status = SubmissionStatus.running
        db.commit()
        return submission.id
    except Exception:
        db.rollback()
        logger.exception("Failed to claim next submission")
        return None
    finally:
        db.close()