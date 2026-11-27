import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

process.env.OPENROUTER_API_KEY = "test-only-not-a-key";
process.env.SUPABASE_URL = "https://test-project.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-only-not-a-key";
process.env.AI_PAID_ENABLED = "true";
process.env.AI_PAID_USER_IDS = "user-1";
const { default: handler } = await import("../api/chat.js");
const originalFetch = globalThis.fetch;
let modelResponse, requests, refunds, reservations;
const encode = (data) => `data: ${JSON.stringify(data)}\n\n`;
const stream = (text, finish = "stop") =>
  new Response(
    encode({
      model: "test-model",
      choices: [{ delta: { content: text }, finish_reason: null }],
    }) +
      (finish
        ? encode({ choices: [{ delta: {}, finish_reason: finish }] })
        : ""),
    { headers: { "content-type": "text/event-stream" } },
  );
const json = (value) => Response.json(value);

beforeEach(() => {
  // Legacy opt-in quota coverage stays explicit; production defaults to no caps.
  process.env.AI_USAGE_LIMITS_ENABLED = "true";
  requests = [];
  refunds = 0;
  reservations = 0;
  modelResponse = () => stream("Дұрыс жауап");
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/auth/v1/user"))
      return json({
        id: "user-1",
        aud: "authenticated",
        app_metadata: {},
        user_metadata: {},
      });
    if (url.includes("/rpc/reserve_ai_attempt")) return json({ allowed: true });
    if (url.includes("/rpc/claim_ai_job")) return json({ parts: [] });
    if (url.includes("/rpc/reserve_ai_cost")) return json(true);
    if (url.includes("/rest/v1/ai_model_health")) return json([]);
    if (url.includes("/rest/v1/ai_jobs"))
      return new Response(null, { status: 204 });
    if (url.includes("/rpc/consume_ai_quota")) {
      reservations++;
      return json([
        { allowed: true, minute_remaining: 9, daily_remaining: 49 },
      ]);
    }
    if (url.includes("/rest/v1/ai_usage")) {
      if (init?.method === "PATCH") {
        refunds++;
        return json({ user_id: "user-1" });
      }
      return json({
        day_key: new Date().toISOString().slice(0, 10),
        day_count: 1,
        minute_key: Math.floor(Date.now() / 60000),
        minute_count: 1,
      });
    }
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      requests.push(JSON.parse(init.body));
      const request = requests.at(-1);
      if (
        request.messages[0]?.content?.includes(
          "compact, progressive school study outline",
        )
      ) {
        const input = JSON.parse(request.messages[1].content);
        return json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  summary: input.topic,
                  outline: Array.from({ length: input.days }, (_, i) => ({
                    day: i + 1,
                    title: "Күн " + (i + 1),
                    prerequisite: i,
                    minutes: input.hours * 60,
                  })),
                }),
              },
            },
          ],
        });
      }
      return modelResponse(request);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.AI_USAGE_LIMITS_ENABLED;
  delete process.env.AI_MINUTE_LIMIT;
  delete process.env.AI_DAILY_LIMIT;
});

class ResponseMock extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  writableEnded = false;
  headers = {};
  chunks = [];
  setHeader(name, value) {
    assert.equal(this.headersSent, false);
    this.headers[name.toLowerCase()] = value;
  }
  status(code) {
    this.statusCode = code;
    return this;
  }
  json(payload) {
    this.payload = payload;
    this.headersSent = true;
    this.writableEnded = true;
    return this;
  }
  flushHeaders() {
    this.headersSent = true;
  }
  write(chunk) {
    assert.equal(this.writableEnded, false);
    this.chunks.push(chunk);
  }
  end() {
    this.writableEnded = true;
  }
}
async function invoke(
  body,
  headers = { authorization: "Bearer test-session" },
) {
  const res = new ResponseMock();
  await handler({ method: "POST", headers, body }, res);
  return res;
}
const chat = {
  task: "chat",
  stream: true,
  web: false,
  messages: [{ role: "user", content: "sin(30) неше?" }],
};
const events = (res) =>
  res.chunks
    .join("")
    .split("\n\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5)));

test("handler authenticates, streams and completes without double-setting headers", async () => {
  const res = await invoke(chat);
  assert.equal(res.statusCode, 200);
  assert.equal(events(res).at(-1).type, "done");
  assert.equal(events(res).at(-1).text, "Дұрыс жауап");
  assert.equal(refunds, 0);
  assert.ok(requests[0].max_tokens >= 4000);
});
test("handler refunds quota after empty streams exhaust all fallbacks", async () => {
  modelResponse = () =>
    new Response("data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
  const res = await invoke(chat);
  assert.equal(requests.length, 3);
  assert.equal(events(res).at(-1).type, "error");
  assert.equal(refunds, 1);
});
test("handler keeps partial answers explicitly incomplete and does not mix models", async () => {
  modelResponse = () => stream("Жарты жауап", null);
  const res = await invoke(chat);
  assert.equal(requests.length, 1);
  assert.equal(events(res).at(-1).type, "error");
  assert.equal(events(res).at(-1).partialText, "Жарты жауап");
  assert.equal(refunds, 1);
});
test("handler falls back after an empty provider without sending headers twice", async () => {
  modelResponse = () =>
    requests.length === 1
      ? new Response("data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        })
      : stream("Резерв жауабы");
  const res = await invoke(chat);
  assert.equal(requests.length, 2);
  assert.equal(events(res).at(-1).type, "done");
  for (const request of requests) {
    assert.equal(request.messages[0].role, "system");
    assert.ok(
      request.messages[0].content.includes("Айдос пен Нурасыл"),
    );
    assert.ok(
      request.messages[0].content.includes("базалық модельді өзі оқытты деп айтпа"),
    );
  }
});
test("handler rejects unauthenticated and overlong input before charging quota", async () => {
  assert.equal((await invoke(chat, {})).statusCode, 401);
  assert.equal(
    (
      await invoke({
        ...chat,
        messages: [{ role: "user", content: "a".repeat(12001) }],
      })
    ).statusCode,
    400,
  );
  assert.equal(requests.length, 0);
});
test("invalid study output stops at the request budget instead of repairing every fallback", async () => {
  modelResponse = () =>
    json({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify({ cards: [] }) },
        },
      ],
    });
  const res = await invoke({ task: "flashcards", topic: "Physics" });
  assert.equal(res.statusCode, 502);
  assert.equal(requests.length, 3);
  assert.ok(
    requests.every((request) => request.response_format.type === "json_object"),
  );
  assert.ok(requests.every((request) => request.reasoning.enabled === false));
  assert.equal(refunds, 1);
});
test("non-streaming length stops cannot be returned as successful translations", async () => {
  modelResponse = () =>
    json({
      choices: [
        { finish_reason: "length", message: { content: "Half a translation" } },
      ],
    });
  const res = await invoke({
    task: "trans",
    input: "Long source text",
    targetLanguage: "English",
  });
  assert.equal(res.statusCode, 502);
  assert.equal(refunds, 1);
  assert.equal(res.payload.text, undefined);
  assert.ok(requests.length <= 3);
});
test("ordinary chat with web enabled skips external source lookup for greetings", async () => {
  const res = await invoke({
    ...chat,
    web: true,
    messages: [{ role: "user", content: "Сәлем!" }],
  });
  assert.equal(events(res).at(-1).type, "done");
  assert.equal(events(res)[0].webStatus, "skipped");
  assert.deepEqual(requests[0].plugins, []);
});
test("deep web chat uses only provider search, without duplicate encyclopedic requests", async () => {
  const res = await invoke({
    ...chat,
    deep: true,
    web: true,
    messages: [{ role: "user", content: "Latest science news" }],
  });
  assert.equal(events(res).at(-1).type, "done");
  assert.equal(requests[0].plugins[0].id, "web");
  assert.equal(events(res).at(-1).webStatus, "no_results");
});

const getSchema = (request) =>
  JSON.parse(
    request.messages
      .find((message) =>
        message.content.includes("Follow this schema exactly: "),
      )
      .content.split("Follow this schema exactly: ")[1],
  );
const completeJSON = (data) => stream(JSON.stringify(data));
const question = (i) => ({
  q: `Сұрақ ${i}?`,
  opts: ["Бір", "Екі", "Үш", "Төрт"],
  correct: 0,
  explanation: "Бір — дұрыс жауап.",
});

test("personal daily and minute caps are disabled by default for chat, tools and quizzes", async () => {
  delete process.env.AI_USAGE_LIMITS_ENABLED;
  process.env.AI_MINUTE_LIMIT = "1";
  process.env.AI_DAILY_LIMIT = "1";
  const testFetch = globalThis.fetch;
  let guardedAttempts = 0;
  globalThis.fetch = (url, init) => {
    assert.ok(!String(url).includes("/rpc/consume_ai_quota"));
    assert.ok(!String(url).includes("/rest/v1/ai_usage"));
    if (String(url).includes("/rpc/reserve_ai_attempt")) guardedAttempts++;
    return testFetch(url, init);
  };
  modelResponse = (request) =>
    request.response_format
      ? completeJSON({ questions: [question(1), question(2), question(3)] })
      : stream("Дайын");
  for (const body of [
    chat,
    { task: "fix", input: "Мәтін", stream: true },
    { task: "quiz", topic: "Логика", count: 3, stream: true },
  ]) {
    const response = await invoke(body);
    assert.equal(response.statusCode, 200);
    const done = events(response).at(-1);
    assert.equal(done.type, "done");
    assert.deepEqual(done.remaining, { day: null, minute: null });
  }
  assert.equal(reservations, 0);
  assert.equal(refunds, 0);
  assert.equal(requests.length, 3);
  assert.ok(guardedAttempts >= 6);
});

test("uncapped requests preserve provider waits without touching usage quota or refunds", async () => {
  delete process.env.AI_USAGE_LIMITS_ENABLED;
  modelResponse = () =>
    Response.json(
      { error: { code: 429, message: "Provider capacity exhausted" } },
      { status: 429, headers: { "retry-after": "43" } },
    );
  const response = await invoke(chat);
  const error = events(response).at(-1);
  assert.equal(error.type, "error");
  assert.equal(error.retryAfter, 43);
  assert.deepEqual(error.remaining, { day: null, minute: null });
  assert.equal(requests.length, 1);
  assert.equal(reservations, 0);
  assert.equal(refunds, 0);
});

test("uncapped mode still requires authentication and respects anti-spam admission", async () => {
  delete process.env.AI_USAGE_LIMITS_ENABLED;
  assert.equal((await invoke(chat, {})).statusCode, 401);
  const testFetch = globalThis.fetch;
  globalThis.fetch = (url, init) =>
    String(url).includes("/rpc/reserve_ai_attempt")
      ? Promise.resolve(json({ allowed: false, reason: "ATTEMPT_LIMIT" }))
      : testFetch(url, init);
  const response = await invoke(chat);
  assert.equal(response.statusCode, 429);
  assert.equal(response.payload.code, "ATTEMPT_LIMIT");
  assert.equal(requests.length, 0);
  assert.equal(reservations, 0);
});

test("public configuration reports uncapped mode unless usage caps are explicitly enabled", async () => {
  const { default: config } = await import("../api/config.js");
  const oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_PUBLISHABLE_KEY = "test-public-key";
  try {
    for (const enabled of [false, true]) {
      if (enabled) process.env.AI_USAGE_LIMITS_ENABLED = "true";
      else delete process.env.AI_USAGE_LIMITS_ENABLED;
      const response = new ResponseMock();
      config({ method: "GET" }, response);
      assert.equal(response.statusCode, 200);
      assert.equal(response.payload.aiUsageLimitsEnabled, enabled);
      assert.equal(response.payload.supabaseSecretKey, undefined);
    }
  } finally {
    if (oldKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
  }
});

test("30-day planner streams six small batches with progress and consumes one quota", async () => {
  modelResponse = (request) => {
    const count = getSchema(request).properties.days.minItems;
    const start = Number(
      request.messages.at(-1).content.match(/(\d+)–\d+ күндеріне/)[1],
    );
    return completeJSON({
      days: Array.from({ length: count }, (_, i) => ({
        day: i + 1,
        title: `Күн ${start + i}`,
        tasks: "Есеп шығар",
        subject: "math",
      })),
    });
  };
  const res = await invoke({
    task: "planner",
    topic: "Алгебра",
    days: 30,
    hours: 2,
    stream: true,
  });
  const received = events(res);
  assert.equal(received.at(-1).type, "done");
  assert.deepEqual(
    received.at(-1).data.days.map((day) => day.day),
    Array.from({ length: 30 }, (_, i) => i + 1),
  );
  assert.equal(received.at(-1).data.days[25].title, "Күн 26");
  assert.equal(requests.length, 7);
  assert.equal(reservations, 1);
  assert.equal(refunds, 0);
  assert.ok(
    received.some(
      (event) =>
        event.type === "progress" &&
        event.completed === 10 &&
        event.total === 30,
    ),
  );
});
test("15-question quiz avoids previous batches and returns exactly 15 usable questions", async () => {
  modelResponse = (request) => {
    const count = getSchema(request).properties.questions.minItems;
    const start = Number(
      request.messages.at(-1).content.match(/сұрақтың (\d+)–/)[1],
    );
    if (start > 1)
      assert.ok(request.messages.at(-1).content.includes("сұрақ 1?"));
    return completeJSON({
      questions: Array.from({ length: count }, (_, i) => question(start + i)),
    });
  };
  const res = await invoke({
    task: "quiz",
    topic: "Атом",
    count: 15,
    stream: true,
  });
  assert.equal(events(res).at(-1).type, "done");
  assert.equal(events(res).at(-1).data.questions.length, 15);
  assert.equal(requests.length, 3);
  assert.equal(reservations, 1);
});
test("non-multiple-of-five quiz counts validate a short final batch", async () => {
  modelResponse = (request) => {
    const count = getSchema(request).properties.questions.minItems;
    const start = Number(
      request.messages.at(-1).content.match(/сұрақтың (\d+)–/)[1],
    );
    return completeJSON({
      questions: Array.from({ length: count }, (_, i) => question(start + i)),
    });
  };
  const res = await invoke({ task: "quiz", topic: "Атом", count: 6 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.questions.length, 6);
  assert.equal(requests.length, 2);
});
test("flashcards succeed even if provider rejects response_format", async () => {
  modelResponse = (request) =>
    request.response_format
      ? new Response("{}", { status: 400 })
      : completeJSON({
          cards: Array.from({ length: 6 }, (_, i) => ({
            q: `Термин ${i}`,
            a: `Анықтама ${i}`,
          })),
        });
  const res = await invoke({
    task: "flashcards",
    topic: "Информатика",
    stream: true,
  });
  assert.equal(events(res).at(-1).data.cards.length, 6);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].response_format, undefined);
  assert.ok(
    requests[1].messages.some((message) =>
      message.content.includes('"required":["q","a"]'),
    ),
  );
});
test("all three text tools use the same bounded, streamed completion path", async () => {
  for (const task of ["sum", "trans", "fix"]) {
    const res = await invoke({
      task,
      input: "Мен мектепке барамын.",
      stream: true,
    });
    assert.equal(events(res).at(-1).text, "Дұрыс жауап");
    assert.equal(events(res).at(-1).type, "done");
  }
  assert.equal(requests.length, 3);
});
test("an invalid final study batch never returns a partial result as success", async () => {
  modelResponse = (request) => {
    const count = getSchema(request).properties.questions.minItems;
    const start = Number(
      request.messages
        .find((message) => message.role === "user")
        .content.match(/сұрақтың (\d+)–/)[1],
    );
    return completeJSON({
      questions:
        start === 1
          ? Array.from({ length: count }, (_, i) => question(i + 1))
          : [],
    });
  };
  const res = await invoke({
    task: "quiz",
    topic: "Атом",
    count: 10,
    stream: true,
  });
  assert.equal(events(res).at(-1).type, "error");
  assert.equal(refunds, 1);
  assert.equal(reservations, 1);
  assert.ok(
    events(res).some(
      (event) => event.type === "progress" && event.completed === 5,
    ),
  );
});
test("oversized tool input is rejected before quota or any provider request", async () => {
  const res = await invoke({ task: "trans", input: "Қ".repeat(12001) });
  assert.equal(res.statusCode, 400);
  assert.equal(requests.length, 0);
  assert.equal(reservations, 0);
});
test("quiz batches complete even when provider connections do not close after finish_reason", async () => {
  modelResponse = (request) => {
    const count = getSchema(request).properties.questions.minItems;
    const start = Number(
      request.messages.at(-1).content.match(/сұрақтың (\d+)–/)[1],
    );
    const text = JSON.stringify({
      questions: Array.from({ length: count }, (_, i) => question(start + i)),
    });
    const bytes = new TextEncoder().encode(
      encode({
        choices: [{ delta: { content: text }, finish_reason: "stop" }],
      }),
    );
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
        },
        cancel() {
          return new Promise(() => {});
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  const res = await invoke({
    task: "quiz",
    topic: "Химия",
    count: 15,
    stream: true,
  });
  assert.equal(events(res).at(-1).type, "done");
  assert.equal(events(res).at(-1).data.questions.length, 15);
  assert.equal(reservations, 1);
});

test("server rejects unauthorized paid mode, actual oversized bodies and invalid numeric ranges before provider calls", async () => {
  process.env.AI_PAID_ENABLED = "false";
  assert.equal((await invoke({ ...chat, deep: true })).statusCode, 403);
  process.env.AI_PAID_ENABLED = "true";
  assert.equal(
    (await invoke({ task: "quiz", topic: "x".repeat(4 * 1024 * 1024 + 1) }))
      .statusCode,
    413,
  );
  assert.equal(
    (await invoke({ task: "planner", topic: "x", days: 0, hours: 2 }))
      .statusCode,
    400,
  );
  assert.equal(requests.length, 0);
});
test("server classifies auth outages as unavailable and never charges a user", async () => {
  const testFetch = globalThis.fetch;
  globalThis.fetch = (url, init) =>
    String(url).includes("/auth/v1/user")
      ? Promise.resolve(
          Response.json({ message: "Service unavailable" }, { status: 503 }),
        )
      : testFetch(url, init);
  const response = await invoke(chat);
  assert.equal(response.statusCode, 503);
  assert.equal(reservations, 0);
  assert.equal(requests.length, 0);
});
test("failed replies restore teaching minute and daily quota while separate anti-spam counters remain spent", async () => {
  let patch;
  let attempts = 0;
  const testFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    if (String(url).includes("/rpc/reserve_ai_attempt")) attempts++;
    if (String(url).includes("/rest/v1/ai_usage") && init?.method === "PATCH")
      patch = JSON.parse(init.body);
    return testFetch(url, init);
  };
  modelResponse = () =>
    new Response("data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
  await invoke(chat);
  assert.equal(patch.minute_count, 0);
  assert.equal(patch.day_count, 0);
  assert.equal(attempts, 4); // One incoming request, three actual provider calls.
});
test("completed operations replay without charging quota or calling a model", async () => {
  let attempts = 0;
  const testFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    if (String(url).includes("/rpc/reserve_ai_attempt")) attempts++;
    return String(url).includes("/rpc/claim_ai_job")
      ? Promise.resolve(
          json({
            cached: {
              data: { questions: [question(1), question(2), question(3)] },
            },
          }),
        )
      : testFetch(url, init);
  };
  const response = await invoke({ task: "quiz", topic: "Replay", count: 3 });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.data.questions.length, 3);
  assert.equal(reservations, 0);
  assert.equal(requests.length, 0);
  assert.equal(attempts, 0);
});

test("failed study quota and job lease settle before the terminal browser event", async () => {
  const order = [],
    res = new ResponseMock(),
    testFetch = globalThis.fetch;
  const end = res.end.bind(res);
  res.end = () => {
    order.push("end");
    end();
  };
  globalThis.fetch = (url, init) => {
    if (String(url).includes("/rest/v1/ai_usage") && init?.method === "PATCH") {
      assert.equal(res.writableEnded, false);
      order.push("refund");
    }
    if (
      String(url).includes("/rest/v1/ai_jobs") &&
      init?.method === "PATCH" &&
      JSON.parse(init.body).status === "partial"
    ) {
      assert.equal(res.writableEnded, false);
      order.push("release");
    }
    return testFetch(url, init);
  };
  modelResponse = () =>
    Response.json(
      {
        error: {
          code: 429,
          message: "Rate limit exceeded: free-models-per-min.",
        },
      },
      { status: 429, headers: { "Retry-After": "43" } },
    );
  await handler(
    {
      method: "POST",
      headers: { authorization: "Bearer test-session" },
      body: { task: "quiz", topic: "Check", count: 5, stream: true },
    },
    res,
  );
  assert.equal(requests.length, 1);
  assert.deepEqual(order, ["refund", "release", "end"]);
  const error = events(res).at(-1);
  assert.equal(error.retryAfter, 43);
  assert.deepEqual(error.remaining, { day: 50, minute: 10 });
});

test("shared provider cooldown is persisted and stops later jobs without another provider call", async () => {
  const rows = new Map(),
    testFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    if (String(url).includes("/rest/v1/ai_model_health")) {
      if (init?.method === "POST") {
        const row = JSON.parse(init.body);
        rows.set(row.model, row);
        return Promise.resolve(json([]));
      }
      return Promise.resolve(json([...rows.values()]));
    }
    return testFetch(url, init);
  };
  modelResponse = () =>
    Response.json(
      {
        error: {
          code: 429,
          message: "Rate limit exceeded: free-models-per-day.",
        },
      },
      { status: 429, headers: { "retry-after": "120" } },
    );
  const first = await invoke({
    task: "quiz",
    topic: "First",
    count: 3,
    stream: true,
  });
  assert.equal(events(first).at(-1).retryAfter, 120);
  assert.ok(rows.has("openrouter:free"));
  const second = await invoke({ ...chat });
  assert.equal(events(second).at(-1).code, "busy");
  assert.equal(requests.length, 1);
  assert.equal(refunds, 2);
});

test("successful study result is durable before closing the browser response", async () => {
  const res = new ResponseMock(),
    testFetch = globalThis.fetch;
  let cached;
  globalThis.fetch = (url, init) => {
    if (String(url).includes("/rest/v1/ai_jobs") && init?.method === "PATCH") {
      const patch = JSON.parse(init.body);
      if (patch.status === "complete") {
        assert.equal(res.writableEnded, false);
        cached = patch.result;
      }
    }
    return testFetch(url, init);
  };
  await handler(
    {
      method: "POST",
      headers: { authorization: "Bearer test-session" },
      body: { task: "fix", input: "Text", stream: true },
    },
    res,
  );
  assert.equal(cached.text, "Дұрыс жауап");
  assert.equal(events(res).at(-1).type, "done");
});

test("provider attempt denial is terminal and never fans out into more models", async () => {
  const testFetch = globalThis.fetch;
  let providerReservations = 0;
  globalThis.fetch = (url, init) => {
    if (
      String(url).includes("/rpc/reserve_ai_attempt") &&
      JSON.parse(init.body).p_channel === "provider"
    ) {
      providerReservations++;
      return Promise.resolve(
        json({ allowed: false, reason: "ATTEMPT_LIMIT", retryAfter: 20 }),
      );
    }
    return testFetch(url, init);
  };
  const response = await invoke({
    task: "flashcards",
    topic: "Limits",
    stream: true,
  });
  assert.equal(events(response).at(-1).retryAfter, 20);
  assert.equal(providerReservations, 1);
  assert.equal(requests.length, 0);
  assert.equal(refunds, 1);
});

test("cached chat completions preserve the actual provider citations", async () => {
  const testFetch = globalThis.fetch;
  let cached;
  globalThis.fetch = (url, init) => {
    if (String(url).includes("/rest/v1/ai_jobs") && init?.method === "PATCH") {
      const patch = JSON.parse(init.body);
      if (patch.status === "complete") cached = patch.result;
    }
    return testFetch(url, init);
  };
  modelResponse = () =>
    new Response(
      encode({
        choices: [
          {
            delta: {
              content: "Answer",
              annotations: [
                {
                  type: "url_citation",
                  url_citation: {
                    title: "Reference",
                    url: "https://example.org/reference",
                  },
                },
              ],
            },
            finish_reason: "stop",
          },
        ],
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  const res = await invoke({ ...chat, deep: true, web: true });
  assert.equal(events(res).at(-1).type, "done");
  assert.equal(cached.sources[0].url, "https://example.org/reference");
  assert.equal(cached.webStatus, "ok");
});

test("a broken response transport cannot refund the same reservation twice", async () => {
  const res = new ResponseMock();
  const write = res.write.bind(res);
  res.write = (chunk) => {
    if (chunk.includes('"type":"error"')) throw new Error("Transport closed");
    write(chunk);
  };
  modelResponse = () =>
    Response.json({ error: { code: 402 } }, { status: 402 });
  await handler(
    {
      method: "POST",
      headers: { authorization: "Bearer test-session" },
      body: { ...chat },
    },
    res,
  );
  assert.equal(refunds, 1);
});

test("resuming a partial quiz reuses checked questions and generates only the missing batch", async () => {
  const testFetch = globalThis.fetch;
  globalThis.fetch = (url, init) =>
    String(url).includes("/rpc/claim_ai_job")
      ? Promise.resolve(
          json({
            parts: [
              {
                index: 0,
                model: "earlier-model",
                data: {
                  questions: Array.from({ length: 5 }, (_, i) =>
                    question(i + 1),
                  ),
                },
              },
            ],
          }),
        )
      : testFetch(url, init);
  modelResponse = (request) => {
    const count = getSchema(request).properties.questions.minItems;
    assert.equal(count, 5);
    assert.ok(request.messages.at(-1).content.includes("сұрақ 1?"));
    return completeJSON({
      questions: Array.from({ length: 5 }, (_, i) => question(i + 6)),
    });
  };
  const result = await invoke({
    task: "quiz",
    topic: "Resume",
    count: 10,
    stream: true,
  });
  assert.equal(events(result).at(-1).type, "done");
  assert.equal(events(result).at(-1).data.questions.length, 10);
  assert.equal(requests.length, 1);
});

test("Gemini handles chat and study tools without an OpenRouter key", async () => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  const originalMock = globalThis.fetch;
  const native = [];
  process.env.AI_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.OPENROUTER_API_KEY;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith("https://generativelanguage.googleapis.com/"))
      return originalMock(url, init);
    native.push(JSON.parse(init.body));
    const text =
      native.at(-1).generationConfig.responseMimeType === "application/json"
        ? JSON.stringify({
            questions: Array.from({ length: 5 }, (_, i) => question(i)),
          })
        : "Gemini response";
    const data = {
      candidates: [
        {
          content: { parts: [{ text }] },
          finishReason: "STOP",
        },
      ],
    };
    return new Response(`data: ${JSON.stringify(data)}\n\n`, {
      headers: { "content-type": "text/event-stream" },
    });
  };
  try {
    const result = await invoke(chat);
    assert.ok(
      events(result).some(
        (e) => e.type === "done" && e.text === "Gemini response",
      ),
    );
    const identity = native[0].systemInstruction.parts
      .map((p) => p.text)
      .join("\n");
    assert.ok(identity.includes("Айдос пен Нурасыл"));
    assert.ok(identity.includes("Айдос и Нурасыл"));
    assert.ok(identity.includes("Gemini моделін Google әзірлеген"));
    const tool = await invoke({
      task: "fix",
      input: "Some text",
      stream: true,
    });
    assert.ok(events(tool).some((e) => e.type === "done"));
    const quiz = await invoke({
      task: "quiz",
      topic: "Logic",
      count: 5,
      stream: true,
    });
    assert.equal(events(quiz).at(-1).type, "done");
    assert.equal(events(quiz).at(-1).data.questions.length, 5);
    assert.equal(native.length, 3);
    assert.ok(native.every((p) => !p.provider && !p.user));
    assert.equal(requests.length, 0);
    process.env.AI_REQUIRE_ZDR = "true";
    assert.equal((await invoke(chat)).statusCode, 503);
    assert.equal(native.length, 3);
  } finally {
    process.env.OPENROUTER_API_KEY = oldKey;
    delete process.env.AI_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    delete process.env.AI_REQUIRE_ZDR;
  }
});
