import test from "node:test";
import assert from "node:assert/strict";
import {
  providerError,
  retrySeconds,
  createAttemptBudget,
  checkProviderCooldown,
  PROVIDER_FREE,
} from "../lib/provider-errors.js";
import { generateUtility } from "../lib/utility-provider.js";
import { generateChatStream } from "../lib/ai-stream.js";
import { generateStudyTask, splitToolText } from "../lib/study-generation.js";
import { createAIClient } from "../lib/ai-http.js";

const event = (data) => `data: ${JSON.stringify(data)}\n\n`;
const completion = (text) =>
  new Response(
    event({ choices: [{ delta: { content: text }, finish_reason: "stop" }] }),
    { headers: { "content-type": "text/event-stream" } },
  );
const utility = (request, extra = {}) => ({
  models: ["one:free", "two:free"],
  request,
  modelRequest: {
    messages: [{ role: "user", content: "Test" }],
    max_tokens: 1000,
  },
  validate: (text) => ({ text }),
  deadline: Date.now() + 5000,
  ...extra,
});

test("Retry-After accepts seconds and HTTP dates and rejects malformed waits", () => {
  const now = Date.parse("2026-11-26T12:00:00Z");
  assert.equal(retrySeconds("41", now), 41);
  assert.equal(retrySeconds("Thu, 26 Nov 2026 12:00:12 GMT", now), 12);
  assert.equal(retrySeconds("bad", now), 0);
  assert.equal(retrySeconds("9999999", now), 86400);
  const daily = providerError(
    {
      error: {
        code: 429,
        message: "Rate limit exceeded: free-models-per-day.",
      },
    },
    429,
    new Headers(),
    now,
  );
  assert.equal(daily.retryAfter, 12 * 3600);
  assert.equal(daily.cooldownKey, PROVIDER_FREE);
  const streamed = providerError(
    {
      error: {
        code: "rate_limit_exceeded",
        metadata: { headers: { "Retry-After": "17" } },
      },
    },
    502,
    new Headers(),
    now,
  );
  assert.equal(streamed.status, 429);
  assert.equal(streamed.retryAfter, 17);
});

test("shared free-model limits stop all model hopping, including HTTP-200 error events", async () => {
  for (const stream of [false, true]) {
    let requests = 0;
    await assert.rejects(
      generateUtility(
        utility(async () => {
          requests++;
          const error = {
            code: 429,
            message: "Rate limit exceeded: free-models-per-min.",
          };
          return stream
            ? new Response(event({ error }), {
                headers: { "content-type": "text/event-stream" },
              })
            : Response.json(
                { error },
                { status: 429, headers: { "retry-after": "34" } },
              );
        }),
      ),
      (error) =>
        error.kind === "busy" && error.stopRetries && error.retryAfter > 0,
    );
    assert.equal(requests, 1);
  }
});

test("account credit and key errors do not spend attempts on backups", async () => {
  for (const code of [401, 402]) {
    let requests = 0;
    await assert.rejects(
      generateUtility(
        utility(async () => {
          requests++;
          return Response.json(
            { error: { code, message: "Account unavailable" } },
            { status: code },
          );
        }),
      ),
      (error) => error.stopRetries === true,
    );
    assert.equal(requests, 1);
  }
});

test("a missing model is skipped immediately, while a format mismatch may downgrade once", async () => {
  const models = [];
  const result = await generateUtility(
    utility(async (payload) => {
      models.push(payload.model);
      return payload.model === "one:free"
        ? Response.json(
            { error: { code: 404, message: "Unknown model" } },
            { status: 404 },
          )
        : completion("Done");
    }),
  );
  assert.equal(result.text, "Done");
  assert.deepEqual(models, ["one:free", "two:free"]);
});

test("a shared cooldown blocks free routes without blocking an explicitly selected paid route", () => {
  const cooldowns = new Map([[PROVIDER_FREE, Date.now() + 30000]]);
  assert.throws(
    () => checkProviderCooldown(cooldowns, "one:free"),
    (error) => error.retryAfter > 0,
  );
  assert.throws(() => checkProviderCooldown(cooldowns, "openrouter/free"));
  assert.doesNotThrow(() =>
    checkProviderCooldown(cooldowns, "explicit-paid-model"),
  );
});

test("one shared attempt budget bounds retries across simultaneous workers", async () => {
  const take = createAttemptBudget(3);
  let sent = 0;
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, async () => {
      take();
      sent++;
    }),
  );
  assert.equal(sent, 3);
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    5,
  );
  assert.ok(
    results
      .filter((result) => result.status === "rejected")
      .every((result) => result.reason.stopRetries),
  );
});

test("chat rate-limit events propagate their wait instead of switching models", async () => {
  let requests = 0;
  const result = await generateChatStream({
    attempts: [{ model: "one:free" }, { model: "two:free" }],
    modelRequest: { messages: [] },
    onEvent() {},
    request: async () => {
      requests++;
      return Response.json(
        { error: { code: 429 } },
        { status: 429, headers: { "retry-after": "29" } },
      );
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.retryAfter, 29);
  assert.equal(requests, 1);
});

test("a failed text tool checkpoints completed chunks and resumes only missing work", async () => {
  const input = "alpha ".repeat(650),
    chunks = splitToolText(input);
  assert.equal(chunks.length, 2);
  let release;
  const checked = new Promise((resolve) => {
    release = resolve;
  });
  let saved = [];
  const config = {
    task: "trans",
    body: { input },
    models: ["one:free"],
    deadline: Date.now() + 5000,
    buildRequest: (body) => ({
      messages: [{ role: "user", content: body.input }],
      max_tokens: 1000,
    }),
    onCheckpoint: async (parts) => {
      saved = parts;
      release();
    },
  };
  let firstCalls = 0;
  await assert.rejects(
    generateStudyTask({
      ...config,
      request: async () => {
        if (++firstCalls === 1) return completion("First translated part");
        await checked;
        return Response.json({ error: { code: 402 } }, { status: 402 });
      },
    }),
  );
  assert.equal(saved.length, 1);
  let resumedCalls = 0;
  const result = await generateStudyTask({
    ...config,
    resumeParts: saved,
    request: async () => {
      resumedCalls++;
      return completion("Second translated part");
    },
  });
  assert.equal(resumedCalls, 1);
  assert.equal(
    result.text,
    "First translated part" + chunks[0].separator + "Second translated part",
  );
});

test("a five-day plan needs one completion instead of a separate outline request", async () => {
  let requests = 0;
  const days = Array.from({ length: 5 }, (_, i) => ({
    day: i + 1,
    title: "Day " + (i + 1),
    tasks: "Practice",
    subject: "math",
  }));
  const result = await generateStudyTask({
    task: "planner",
    body: { topic: "Math", days: 5, hours: 1 },
    models: ["one:free"],
    useOutline: true,
    deadline: Date.now() + 5000,
    buildRequest: () => ({
      messages: [],
      max_tokens: 3000,
      response_format: { json_schema: { schema: { type: "object" } } },
    }),
    request: async () => {
      requests++;
      return completion(JSON.stringify({ days }));
    },
  });
  assert.equal(result.data.days.length, 5);
  assert.equal(requests, 1);
});

test("browser errors retain restored quota and Retry-After from the terminal event", async () => {
  const client = createAIClient({
    getAccessToken: () => "session",
    refreshSession: async () => {},
    fetchImpl: async () =>
      new Response(
        event({ type: "meta", remaining: { day: 49, minute: 9 } }) +
          event({
            type: "error",
            error: "Wait",
            retryAfter: 25,
            remaining: { day: 50, minute: 10 },
          }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  });
  await assert.rejects(client.send("fix", { input: "Text" }), (error) => {
    assert.equal(error.retryAfter, 25);
    assert.deepEqual(error.metadata.remaining, { day: 50, minute: 10 });
    return true;
  });
});
