import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import test, { afterEach } from "node:test";
import typescript from "typescript";

process.env.NEXT_PUBLIC_API_URL = "http://localhost:8000";

const apiPath = path.resolve("lib/api.ts");
const source = fs.readFileSync(apiPath, "utf8");
const javascript = typescript.transpileModule(source, {
  compilerOptions: {
    module: typescript.ModuleKind.CommonJS,
    target: typescript.ScriptTarget.ES2020,
  },
}).outputText;
const apiModule = new Module(apiPath);
apiModule.filename = apiPath;
apiModule.paths = Module._nodeModulePaths(path.dirname(apiPath));
apiModule._compile(javascript, apiPath);
const api = apiModule.exports;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  api.setAccessToken(null);
});

test("concurrent unauthorized requests share one refresh and retry with its access token", async () => {
  let refreshRequests = 0;
  let unauthorizedRequests = 0;
  let retriedRequests = 0;
  api.setAccessToken("expired-access-token");

  globalThis.fetch = async (url, init = {}) => {
    if (url.endsWith("/auth/refresh")) {
      refreshRequests += 1;
      assert.equal(init.credentials, "include");
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json({ access_token: "new-access-token" });
    }

    if (init.headers.get("Authorization") === "Bearer new-access-token") {
      retriedRequests += 1;
      assert.equal(init.credentials, "include");
      return Response.json([]);
    }
    unauthorizedRequests += 1;
    return new Response(null, { status: 401 });
  };

  const [first, second] = await Promise.all([
    api.fetchExams(),
    api.fetchExams(),
  ]);
  assert.deepEqual(first, []);
  assert.deepEqual(second, []);
  assert.equal(unauthorizedRequests, 2);
  assert.equal(refreshRequests, 1);
  assert.equal(retriedRequests, 2);
});

test("a retried 401 does not enter a refresh loop and clears the access session", async () => {
  let refreshRequests = 0;
  let examRequests = 0;
  let expiredEvents = 0;
  const unsubscribe = api.subscribeSessionExpired(() => {
    expiredEvents += 1;
  });
  api.setAccessToken("expired-access-token");
  globalThis.fetch = async (url) => {
    if (url.endsWith("/auth/refresh")) {
      refreshRequests += 1;
      return Response.json({ access_token: "new-access-token" });
    }
    examRequests += 1;
    return new Response(null, { status: 401 });
  };

  try {
    await assert.rejects(() => api.fetchExams(), (error) => error.status === 401);
    assert.equal(refreshRequests, 1);
    assert.equal(examRequests, 2);
    assert.equal(expiredEvents, 1);
  } finally {
    unsubscribe();
  }
});

test("an invalid refresh session emits expiration and does not retry the protected request", async () => {
  let refreshRequests = 0;
  let examRequests = 0;
  let expiredEvents = 0;
  const unsubscribe = api.subscribeSessionExpired(() => {
    expiredEvents += 1;
  });
  api.setAccessToken("expired-access-token");
  globalThis.fetch = async (url) => {
    if (url.endsWith("/auth/refresh")) {
      refreshRequests += 1;
      return new Response(null, { status: 401 });
    }
    examRequests += 1;
    return new Response(null, { status: 401 });
  };

  try {
    await assert.rejects(() => api.fetchExams(), (error) => error.status === 401);
    assert.equal(refreshRequests, 1);
    assert.equal(examRequests, 1);
    assert.equal(expiredEvents, 1);
  } finally {
    unsubscribe();
  }
});
