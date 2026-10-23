<<<<<<< HEAD
"""Realtime transport and event-routing utilities."""

from app.realtime.bridge import RealtimeBridge
from app.realtime.event_router import RealtimeEventRouter

__all__ = ["RealtimeBridge", "RealtimeEventRouter"]
=======
"""Browser-facing realtime connection and event routing."""

from app.realtime.manager import RealtimeManager, publish_bridge_event, realtime_manager

__all__ = ["RealtimeManager", "publish_bridge_event", "realtime_manager"]
>>>>>>> 4e55763ec944afaefc1b31f258c04fe4df021a45
