import { parentPort, workerData } from "node:worker_threads";
import { PDFDocument } from "pdf-lib";
try {
  const doc = await PDFDocument.load(workerData, {
    ignoreEncryption: false,
    updateMetadata: false,
  });
  parentPort.postMessage({ pages: doc.getPageCount() });
} catch {
  parentPort.postMessage({ error: true });
}
