const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
const STABLE_CONNECTION_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 30000;

/**
 * Browser-side client for FastAPI's authenticated /ws/realtime endpoint.
 * The caller supplies its existing access-token provider; this class stores no credentials.
 */
export class RealtimeClient {
  constructor({
    apiBaseUrl,
    getAccessToken,
    onStatus = () => {},
    WebSocketImpl = globalThis.WebSocket,
    setTimeoutFn = globalThis.setTimeout.bind(globalThis),
    clearTimeoutFn = globalThis.clearTimeout.bind(globalThis),
    setIntervalFn = globalThis.setInterval.bind(globalThis),
    clearIntervalFn = globalThis.clearInterval.bind(globalThis),
    initialRetryDelayMs = INITIAL_RETRY_DELAY_MS,
    maxRetryDelayMs = MAX_RETRY_DELAY_MS,
    stableConnectionMs = STABLE_CONNECTION_MS,
    heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
  }) {
    if (typeof apiBaseUrl !== "string" || !apiBaseUrl.trim()) {
      throw new TypeError("apiBaseUrl must be a non-empty URL");
    }
    if (typeof getAccessToken !== "function") {
      throw new TypeError("getAccessToken must be a function from the existing auth system");
    }
    if (typeof onStatus !== "function") {
      throw new TypeError("onStatus must be a function");
    }
    if (
      !Number.isFinite(initialRetryDelayMs)
      || initialRetryDelayMs <= 0
      || !Number.isFinite(maxRetryDelayMs)
      || maxRetryDelayMs < initialRetryDelayMs
      || !Number.isFinite(stableConnectionMs)
      || stableConnectionMs < 0
      || !Number.isFinite(heartbeatIntervalMs)
      || heartbeatIntervalMs <= 0
    ) {
      throw new RangeError("Realtime retry and heartbeat intervals are invalid");
    }

    this.apiBaseUrl = apiBaseUrl;
    this.getAccessToken = getAccessToken;
    this.onStatus = onStatus;
    this.WebSocketImpl = WebSocketImpl;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.initialRetryDelayMs = initialRetryDelayMs;
    this.maxRetryDelayMs = maxRetryDelayMs;
    this.stableConnectionMs = stableConnectionMs;
    this.heartbeatIntervalMs = heartbeatIntervalMs;

    this.listeners = new Map();
    this.socket = null;
    this.attempt = null;
    this.pendingOpenResolver = null;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.shouldConnect = false;
    this.generation = 0;
    this.retryDelayMs = initialRetryDelayMs;
  }

  get connected() {
    return this.socket?.readyState === 1;
  }

  /** Open one connection, or share the active connection/reconnect attempt. */
  connect() {
    if (this.shouldConnect) {
      if (this.connected || this.socket?.readyState === 0) return this.attempt ?? Promise.resolve();
      if (this.attempt || this.reconnectTimer !== null) return this.attempt ?? Promise.resolve();
    }

    this.shouldConnect = true;
    this.generation += 1;
    this.retryDelayMs = this.initialRetryDelayMs;
    this._clearReconnectTimer();

    if (typeof this.WebSocketImpl !== "function") {
      this.shouldConnect = false;
      this._reportStatus("error", { reason: "websocket_unavailable" });
      return Promise.resolve();
    }
    return this._startAttempt(this.generation);
  }

  /** Stop heartbeats, reconnect timers, and the active socket. */
  disconnect() {
    this.shouldConnect = false;
    this.generation += 1;
    this._clearReconnectTimer();
    this._stopHeartbeat();
    this.pendingOpenResolver?.();
    this.pendingOpenResolver = null;

    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close(1000, "Client disconnected");
      } catch {
        // A closed or broken browser socket needs no further cleanup.
      }
    }
    this._reportStatus("closed");
  }

  /** The FastAPI browser protocol currently permits client heartbeats only. */
  send(message) {
    if (
      !message
      || typeof message !== "object"
      || Array.isArray(message)
      || message.type !== "client.heartbeat"
    ) {
      this._reportStatus("error", { reason: "unsupported_client_message" });
      return false;
    }
    if (!this.connected) return false;

    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      this._reportStatus("error", { reason: "send_failed" });
      try {
        this.socket.close();
      } catch {
        // The close handler or reconnect supervisor will handle the failed socket.
      }
      return false;
    }
  }

  /** Register a callback for one server event type. Returns an unsubscribe function. */
  subscribe(eventType, handler) {
    if (typeof eventType !== "string" || !eventType.trim()) {
      throw new TypeError("eventType must be a non-empty string");
    }
    if (typeof handler !== "function") {
      throw new TypeError("handler must be a function");
    }

    let handlers = this.listeners.get(eventType);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(eventType, handlers);
    }
    handlers.add(handler);
    return () => this.unsubscribe(eventType, handler);
  }

  unsubscribe(eventType, handler) {
    const handlers = this.listeners.get(eventType);
    if (!handlers) return false;
    const removed = handlers.delete(handler);
    if (handlers.size === 0) this.listeners.delete(eventType);
    return removed;
  }

  _startAttempt(generation) {
    const attempt = this._openSocket(generation)
      .catch(() => {
        if (this.shouldConnect && generation === this.generation) {
          this._reportStatus("error", { reason: "connection_failed" });
          this._scheduleReconnect(generation);
        }
      })
      .finally(() => {
        if (this.attempt === attempt) this.attempt = null;
      });
    this.attempt = attempt;
    return attempt;
  }

  async _openSocket(generation) {
    if (!this.shouldConnect || generation !== this.generation) return;
    this._reportStatus("connecting");

    let token;
    try {
      token = await this.getAccessToken();
    } catch {
      if (this.shouldConnect && generation === this.generation) {
        this._reportStatus("error", { reason: "token_unavailable" });
        this._scheduleReconnect(generation);
      }
      return;
    }
    if (!this.shouldConnect || generation !== this.generation) return;
    if (typeof token !== "string" || !token.trim()) {
      this.shouldConnect = false;
      this._reportStatus("unauthenticated");
      return;
    }

    let socketUrl;
    try {
      socketUrl = createRealtimeUrl(this.apiBaseUrl, token);
    } catch {
      this.shouldConnect = false;
      this._reportStatus("error", { reason: "invalid_api_url" });
      return;
    }

    let socket;
    try {
      socket = new this.WebSocketImpl(socketUrl);
    } catch {
      this._reportStatus("error", { reason: "socket_creation_failed" });
      this._scheduleReconnect(generation);
      return;
    }
    this.socket = socket;

    await new Promise((resolve) => {
      let openResolved = false;
      let finished = false;
      let openedAt = null;
      const resolveOpen = () => {
        if (openResolved) return;
        openResolved = true;
        if (this.pendingOpenResolver === resolveOpen) this.pendingOpenResolver = null;
        resolve();
      };
      this.pendingOpenResolver = resolveOpen;

      const finish = (state, detail = {}) => {
        if (finished) return;
        finished = true;
        this._stopHeartbeat();
        if (this.socket === socket) this.socket = null;
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try {
          socket.close();
        } catch {
          // The connection is already closed or failed.
        }
        this._reportStatus(state, detail);
        if (this.shouldConnect && generation === this.generation) {
          this._scheduleReconnect(generation);
        }
        resolveOpen();
      };

      socket.onopen = () => {
        if (!this.shouldConnect || generation !== this.generation || this.socket !== socket) {
          finish("closed");
          return;
        }
        openedAt = Date.now();
        this._reportStatus("open");
        this._startHeartbeat(socket);
        resolveOpen();
      };
      socket.onmessage = (event) => {
        if (this.socket === socket && this.shouldConnect && generation === this.generation) {
          this._dispatchMessage(event?.data);
        }
      };
      socket.onerror = () => finish("error", { reason: "socket_error" });
      socket.onclose = (event) => {
        if (openedAt !== null && Date.now() - openedAt >= this.stableConnectionMs) {
          this.retryDelayMs = this.initialRetryDelayMs;
        }
        const rejected = event?.code === 1008;
        if (rejected) this.shouldConnect = false;
        finish(rejected ? "unauthenticated" : "close", { code: event?.code });
      };
    });
  }

  _dispatchMessage(rawMessage) {
    if (typeof rawMessage !== "string") {
      this._reportStatus("error", { reason: "invalid_server_message" });
      return;
    }

    let message;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      this._reportStatus("error", { reason: "malformed_server_json" });
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)
      || typeof message.type !== "string" || !message.type.trim()) {
      this._reportStatus("error", { reason: "invalid_server_message" });
      return;
    }

    for (const handler of [...(this.listeners.get(message.type) ?? [])]) {
      try {
        handler(message);
      } catch {
        this._reportStatus("error", { reason: "event_handler_failed", eventType: message.type });
      }
    }
  }

  _startHeartbeat(socket) {
    this._stopHeartbeat();
    this.heartbeatTimer = this.setIntervalFn(() => {
      if (this.socket === socket && socket.readyState === 1) {
        this.send({ type: "client.heartbeat" });
      }
    }, this.heartbeatIntervalMs);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      this.clearIntervalFn(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  _scheduleReconnect(generation) {
    if (!this.shouldConnect || generation !== this.generation || this.reconnectTimer !== null) return;

    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, this.maxRetryDelayMs);
    this._reportStatus("retrying", { delayMs: delay });
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      if (this.shouldConnect && generation === this.generation) {
        this._startAttempt(generation);
      }
    }, delay);
  }

  _clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      this.clearTimeoutFn(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  _reportStatus(state, detail = {}) {
    try {
      this.onStatus({ state, ...detail });
    } catch {
      // A status observer must not disrupt transport lifecycle handling.
    }
  }
}

export function createRealtimeUrl(apiBaseUrl, accessToken) {
  const url = new URL(apiBaseUrl);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new TypeError("API URL must use http, https, ws, or wss");
  }

  url.pathname = "/ws/realtime";
  url.search = "";
  url.hash = "";
  url.searchParams.set("token", accessToken);
  return url.toString();
}
