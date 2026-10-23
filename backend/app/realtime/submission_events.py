"""Best-effort publication of normalized submission lifecycle events."""

import logging

import anyio

from app.database import SessionLocal
from app.realtime.manager import publish_bridge_event

logger = logging.getLogger(__name__)

SUBMISSION_EVENT_TYPES = {
    "submission.received",
    "submission.running",
    "submission.completed",
    "submission.failed",
}
SUBMISSION_RECIPIENTS = ("role:student", "role:teacher")


async def publish_submission_event(event_type: str, submission_id: int) -> None:
    """Route a safe event to the submission owner and its exam's teacher."""
    if event_type not in SUBMISSION_EVENT_TYPES:
        logger.warning("Ignored unsupported submission realtime event %s", event_type)
        return

    db = None
    try:
        db = SessionLocal()
        for recipient in SUBMISSION_RECIPIENTS:
            await publish_bridge_event(
                {
                    "type": event_type,
                    "recipient": recipient,
                    "payload": {"submission_id": submission_id},
                },
                db,
            )
    except Exception:
        logger.exception(
            "Could not publish %s for submission %s; persisted state is unchanged",
            event_type,
            submission_id,
        )
    finally:
        if db is not None:
            db.close()


def publish_submission_event_from_sync(event_type: str, submission_id: int) -> None:
    """Call the async publisher from FastAPI's synchronous request thread."""
    try:
        anyio.from_thread.run(publish_submission_event, event_type, submission_id)
    except Exception:
        logger.exception(
            "Could not schedule %s for submission %s; persisted state is unchanged",
            event_type,
            submission_id,
        )
