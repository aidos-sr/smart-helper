import { readSSEData } from "./sse.js";

export const useGemini = () => process.env.AI_PROVIDER === "gemini";
export const geminiModel = () =>
  "gemini-direct/" + (process.env.GEMINI_MODEL || "gemini-3.8-flash");
export const hasAIKey = () =>
  Boolean(
    useGemini() ? process.env.GEMINI_API_KEY : process.env.OPENROUTER_API_KEY,
  );

function parts(content) {
  if (typeof content === "string") return [{ text: content }];
  return content.map((part) => {
    if (part.type === "text") return { text: part.text };
    const value = part.image_url?.url || part.file?.file_data;
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(value || "");
    if (!match) throw new Error("INVALID_GEMINI_ATTACHMENT");
    return { inlineData: { mimeType: match[1], data: match[2] } };
  });
}

export function geminiPayload(payload) {
  const system = payload.messages
    .filter((m) => m.role === "system")
    .flatMap((m) => parts(m.content));
  const schema = payload.response_format?.json_schema?.schema;
  const json =
    payload.response_format && payload.response_format.type !== "text";
  return {
    ...(system.length ? { systemInstruction: { parts: system } } : {}),
    contents: payload.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: parts(m.content),
      })),
    generationConfig: {
      maxOutputTokens: payload.max_tokens || 8000,
      temperature: payload.temperature ?? 0.2,
      ...(json ? { responseMimeType: "application/json" } : {}),
      ...(schema ? { responseJsonSchema: schema } : {}),
    },
    ...(payload.plugins?.some((p) => p.id === "web")
      ? { tools: [{ google_search: {} }] }
      : {}),
  };
}

function completion(data, model, streaming) {
  if (data.error)
    return { error: { code: data.error.code || 502 }, _provider: "gemini" };
  const c = data.candidates?.[0];
  const text = (c?.content?.parts || [])
    .filter((p) => !p.thought)
    .map((p) => p.text || "")
    .join("");
  const annotations = (c?.groundingMetadata?.groundingChunks || [])
    .filter((p) => p.web?.uri)
    .map((p) => ({
      type: "url_citation",
      url_citation: { url: p.web.uri, title: p.web.title },
    }));
  const finish = data.promptFeedback?.blockReason
    ? "content_filter"
    : c?.finishReason
      ? {
          STOP: "stop",
          MAX_TOKENS: "length",
          SAFETY: "content_filter",
          RECITATION: "content_filter",
          BLOCKLIST: "content_filter",
          PROHIBITED_CONTENT: "content_filter",
          SPII: "content_filter",
        }[c.finishReason] || "error"
      : null;
  const content = { content: text, annotations };
  return {
    model,
    choices: [
      { [streaming ? "delta" : "message"]: content, finish_reason: finish },
    ],
  };
}

// Keep the application stream contract; native Gemini handles inline images/PDFs.
export async function requestAICompletion(payload, signal) {
  if (!useGemini())
    return fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer":
          process.env.PUBLIC_SITE_URL || "https://smart-helper-six.vercel.app",
        "X-OpenRouter-Title": "Smart Helper",
      },
      body: JSON.stringify(payload),
    });
  const model = payload.model.replace(/^gemini-direct\//, "");
  if (!/^gemini-[a-zA-Z0-9._-]+$/.test(model))
    throw new Error("INVALID_GEMINI_MODEL");
  const streaming = payload.stream === true;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:${streaming ? "streamGenerateContent?alt=sse" : "generateContent"}`,
    {
      method: "POST",
      signal,
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(geminiPayload(payload)),
    },
  );
  if (!response.ok) {
    // Do not expose provider messages, which may contain request details or keys.
    response.body?.cancel().catch(() => {});
    return Response.json(
      { _provider: "gemini", error: { code: response.status } },
      {
        status: response.status,
        headers: { "retry-after": response.headers.get("retry-after") || "60" },
      },
    );
  }
  if (!streaming)
    return Response.json(completion(await response.json(), model, false));
  const iterator = readSSEData(response.body, { signal });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        const event = completion(JSON.parse(value), model, true);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      return iterator.return();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream" },
  });
}
