import assert from "node:assert/strict";
import test from "node:test";

import { RealtimeClient } from "./realtime-client.mjs";

test("reconnect delay doubles and stays within the configured maximum", async () => {
  const sockets = [];
  const timers = [];

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      sockets.push(this);
    }

    close() {
      this.readyState = 3;
    }

    send() {}
  }

  const client = new RealtimeClient({
    apiBaseUrl: "http://localhost:8000",
    getAccessToken: async () => "test-token",
    WebSocketImpl: FakeWebSocket,
    setTimeoutFn: (callback, delay) => {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: (timer) => { timer.cancelled = true; },
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    initialRetryDelayMs: 1,
    maxRetryDelayMs: 4,
    stableConnectionMs: 1000,
  });

  const flushMicrotasks = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };

  try {
    let attempt = client.connect();
    await flushMicrotasks();
    sockets.at(-1).onclose({ code: 1006 });
    await attempt;

    const expectedDelays = [1, 2, 4, 4];
    for (const expectedDelay of expectedDelays) {
      const timer = timers.shift();
      assert.ok(timer);
      assert.equal(timer.delay, expectedDelay);
      assert.equal(timer.cancelled, false);

      timer.callback();
      await flushMicrotasks();
      attempt = client.attempt;
      sockets.at(-1).onclose({ code: 1006 });
      await attempt;
    }
  } finally {
    client.disconnect();
  }
});
