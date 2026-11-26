import { imageSize } from "image-size";
import { Worker } from "node:worker_threads";
function inspectPDF(bytes) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./pdf-inspect-worker.js", import.meta.url),
      { workerData: bytes, resourceLimits: { maxOldGenerationSizeMb: 64 } },
    );
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("INVALID_ATTACHMENT"));
    }, 2000);
    const done = (error, result) => {
      clearTimeout(timer);
      worker.terminate();
      error ? reject(error) : resolve(result);
    };
    worker.once("message", (result) =>
      done(result.error ? new Error("INVALID_ATTACHMENT") : null, result),
    );
    worker.once("error", (error) => done(error));
    worker.once("exit", (code) => {
      if (code !== 0) done(new Error("INVALID_ATTACHMENT"));
    });
  });
}
export async function validateAttachments(attachments) {
  if (attachments === undefined) return;
  if (!Array.isArray(attachments) || attachments.length > 3)
    throw new Error("INVALID_ATTACHMENT");
  let total = 0;
  for (const file of attachments) {
    if (file?.kind === "text") {
      if (typeof file.content !== "string" || file.content.length > 20000)
        throw new Error("INVALID_ATTACHMENT");
      continue;
    }
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(
      file?.dataUrl || "",
    );
    if (!match || match[1] !== file.type || match[2].length % 4)
      throw new Error("INVALID_ATTACHMENT");
    const bytes = Buffer.from(match[2], "base64");
    total += bytes.length;
    if (bytes.toString("base64") !== match[2] || total > 2600000)
      throw new Error("INVALID_ATTACHMENT");
    if (file.kind === "image") {
      const size = imageSize(bytes),
        type = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[
          size.type
        ];
      if (
        type !== file.type ||
        !size.width ||
        !size.height ||
        size.width * size.height > 16000000 ||
        Math.max(size.width, size.height) > 10000
      )
        throw new Error("INVALID_ATTACHMENT");
    } else if (file.kind === "pdf") {
      if (
        file.type !== "application/pdf" ||
        !bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) ||
        bytes.length > 2400000
      )
        throw new Error("INVALID_ATTACHMENT");
      const result = await inspectPDF(bytes);
      if (
        result.pages > 50 ||
        /\/(?:JavaScript|Launch|EmbeddedFile|OpenAction)\b/.test(
          bytes.toString("latin1"),
        )
      )
        throw new Error("INVALID_ATTACHMENT");
    } else throw new Error("INVALID_ATTACHMENT");
  }
}
