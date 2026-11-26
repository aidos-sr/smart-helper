import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { geminiPayload, requestAICompletion } from "../lib/ai-provider.js";
import {
  providerError,
  checkProviderCooldown,
} from "../lib/provider-errors.js";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.AI_PROVIDER;
  delete process.env.GEMINI_API_KEY;
});
const request = {
  model: "gemini-direct/gemini-3.8-flash",
  max_tokens: 800,
  messages: [
    { role: "system", content: "Teach" },
    { role: "user", content: "Hello" },
  ],
};
test("Gemini converts instructions, history, images, PDF and JSON schema without router fields", () => {
  const payload = geminiPayload({
    ...request,
    response_format: {
      type: "json_schema",
      json_schema: { schema: { type: "object" } },
    },
    messages: [
      ...request.messages,
      { role: "assistant", content: "Earlier" },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,YQ==" },
          },
          {
            type: "file",
            file: { file_data: "data:application/pdf;base64,Yg==" },
          },
        ],
      },
    ],
  });
  assert.equal(payload.systemInstruction.parts[0].text, "Teach");
  assert.equal(payload.contents[1].role, "model");
  assert.deepEqual(
    payload.contents[2].parts.map((p) => p.inlineData.mimeType),
    ["image/png", "application/pdf"],
  );
  assert.equal(payload.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(payload.generationConfig.responseJsonSchema, {
    type: "object",
  });
  assert.throws(() =>
    geminiPayload({
      ...request,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "https://untrusted.example/image" },
            },
          ],
        },
      ],
    }),
  );
});
test("Gemini streams visible text, finish reasons and citations without revealing thoughts", async () => {
  process.env.AI_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (url, init) => {
    assert.equal(
      url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse",
    );
    assert.equal(init.headers["x-goog-api-key"], "test-secret");
    assert.ok(!url.includes("test-secret"));
    assert.ok(!("Authorization" in init.headers));
    const payload = JSON.parse(init.body);
    assert.ok(!payload.provider);
    assert.ok(!payload.user);
    return new Response(
      "data: " +
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ thought: true, text: "private" }, { text: "Hello" }],
              },
              finishReason: "STOP",
              groundingMetadata: {
                groundingChunks: [
                  { web: { uri: "https://example.org", title: "Source" } },
                ],
              },
            },
          ],
        }) +
        "\n\n",
    );
  };
  const response = await requestAICompletion({ ...request, stream: true });
  const text = await response.text();
  assert.ok(text.includes("Hello"));
  assert.ok(!text.includes("private"));
  assert.ok(text.includes("url_citation"));
  assert.ok(text.includes('"finish_reason":"stop"'));
});
test("Gemini safety blocks and truncation never become successful stop responses", async () => {
  process.env.AI_PROVIDER = "gemini";
  for (const [response, expected] of [
    [{ promptFeedback: { blockReason: "SAFETY" } }, "content_filter"],
    [{ candidates: [{ finishReason: "MAX_TOKENS" }] }, "length"],
  ]) {
    globalThis.fetch = async () => Response.json(response);
    const data = await (await requestAICompletion(request)).json();
    assert.equal(data.choices[0].finish_reason, expected);
  }
});
test("Gemini quota errors are sanitized, terminal and isolated from router cooldowns", async () => {
  process.env.AI_PROVIDER = "gemini";
  globalThis.fetch = async () =>
    Response.json(
      { error: { message: "sensitive details" } },
      { status: 429, headers: { "Retry-After": "75" } },
    );
  const response = await requestAICompletion(request);
  const data = await response.json();
  assert.ok(!JSON.stringify(data).includes("sensitive"));
  const error = providerError(data, response.status, response.headers);
  assert.equal(error.retryAfter, 75);
  assert.equal(error.stopRetries, true);
  assert.equal(error.cooldownKey, "gemini:all");
  const cooldowns = new Map([["openrouter:all", Date.now() + 10000]]);
  assert.doesNotThrow(() => checkProviderCooldown(cooldowns, request.model));
  cooldowns.set("gemini:all", Date.now() + 10000);
  assert.throws(() => checkProviderCooldown(cooldowns, request.model));
});

test("in-stream Gemini quota errors retain provider scope and stop retries", async () => {
  process.env.AI_PROVIDER = "gemini";
  globalThis.fetch = async () =>
    new Response(
      'data: {"error":{"code":429,"message":"private request details"}}\n\n',
    );
  const response = await requestAICompletion({ ...request, stream: true });
  await assert.rejects(response.text(), (error) => {
    assert.equal(error.cooldownKey, "gemini:all");
    assert.equal(error.stopRetries, true);
    assert.ok(!error.message.includes("private"));
    return true;
  });
});
