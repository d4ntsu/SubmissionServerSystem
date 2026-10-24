"""Best-effort publication of normalized submission lifecycle events."""

import logging
from collections.abc import Awaitable, Callable
from typing import Any

import anyio

logger = logging.getLogger(__name__)

SUBMISSION_EVENT_TYPES = {
    "submission.received",
    "submission.status",
    "submission.completed",
    "submission.error",
}
SUBMISSION_STATUSES = {"queued", "running", "completed", "error"}
SUBMISSION_RECIPIENTS = ("role:student", "role:teacher")

EventSender = Callable[[dict[str, Any]], Awaitable[bool]]
_event_sender: EventSender | None = None


def configure_submission_event_transport(sender: EventSender) -> None:
    """Use the application's existing FastAPI-to-Java TCP bridge for events."""
    global _event_sender
    _event_sender = sender


async def publish_submission_event(
    event_type: str,
    submission_id: int,
    status: str | None = None,
) -> None:
    """Queue a safe lifecycle notification for the owner and exam teacher."""
    if event_type not in SUBMISSION_EVENT_TYPES:
        logger.warning("Ignored unsupported submission realtime event %s", event_type)
        return
    if isinstance(submission_id, bool) or not isinstance(submission_id, int) or submission_id <= 0:
        logger.warning("Ignored submission realtime event with an invalid submission ID")
        return
    if event_type == "submission.status" and (
        not isinstance(status, str) or status not in SUBMISSION_STATUSES
    ):
        logger.warning("Ignored submission status event with an invalid status")
        return

    sender = _event_sender
    if sender is None:
        logger.warning("Submission realtime transport is not configured")
        return

    payload: dict[str, Any] = {"submission_id": submission_id}
    if event_type == "submission.status":
        payload["status"] = status

    for recipient in SUBMISSION_RECIPIENTS:
        event = {"type": event_type, "recipient": recipient, "payload": payload}
        try:
            queued = await sender(event)
            if not queued:
                logger.warning(
                    "Realtime bridge did not queue %s for submission %s",
                    event_type,
                    submission_id,
                )
        except Exception as exc:
            logger.warning(
                "Could not queue %s for submission %s (%s); persisted state is unchanged",
                event_type,
                submission_id,
                type(exc).__name__,
            )


def publish_submission_event_from_sync(
    event_type: str,
    submission_id: int,
    status: str | None = None,
) -> None:
    """Call the async publisher from FastAPI's synchronous request thread."""
    try:
        anyio.from_thread.run(
            publish_submission_event,
            event_type,
            submission_id,
            status,
        )
    except Exception as exc:
        logger.warning(
            "Could not schedule %s for submission %s (%s); persisted state is unchanged",
            event_type,
            submission_id,
            type(exc).__name__,
        )
