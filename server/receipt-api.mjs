import { createOpenAiReader, OpenAiError } from "./openai-reader.mjs";
import { openaiRequestSchema } from "../src/lib/openai-schema.mjs";
import {
  MAX_AI_BODY_BYTES,
  SCAN_UPLOAD_TIMEOUT_MS,
} from "../src/lib/scan-limits.mjs";

const configPath = "/api/receipts/openai/config";
const scanPath = "/api/receipts/openai";
const oversized =
  "These photos are too large together. Crop them or choose fewer sections.";

/** A loopback API for the local app and its authenticated phone preview. */
export function createReceiptApi({
  openaiReader = createOpenAiReader(),
  uploadTimeoutMs = SCAN_UPLOAD_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  let active = false;
  const attempts = [];
  return async (req, res, next) => {
    const pathname = (req.url || "").split("?")[0];
    if (!pathname.startsWith("/api/receipts/")) return next();
    const send = (status, data) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(JSON.stringify(data));
    };
    const rejectScan = (status, error, attemptUsed = false) =>
      send(status, { error, attemptUsed });
    const host = req.headers.host || "";
    if (
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress,
      ) ||
      !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
    )
      return send(403, {
        error: "Open Gather using its local server address.",
      });
    const origin = req.headers.origin;
    if ((req.method === "POST" || origin) && origin !== "http://" + host)
      return send(403, {
        error: "Start the scan from Gather on this server.",
      });
    if (pathname === configPath && req.method === "GET")
      return send(200, await openaiReader.getStatus());
    if (pathname !== scanPath)
      return send(404, { error: "Receipt endpoint not found." });
    if (req.method !== "POST")
      return send(405, { error: "Use the scan button to submit a receipt." });
    if (!openaiReader.configured)
      return rejectScan(
        503,
        "OpenAI needs a server key and a scan allowance. You can enter the receipt manually.",
      );
    if (
      req.headers["x-gather-request"] !== "receipt-scan" ||
      !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "") ||
      (req.headers["content-encoding"] &&
        req.headers["content-encoding"] !== "identity")
    )
      return rejectScan(
        415,
        "Use Gather's receipt scanner to send these photos.",
      );
    if (Number(req.headers["content-length"]) > MAX_AI_BODY_BYTES)
      return rejectScan(413, oversized);
    // Acquire before buffering so concurrent requests cannot accumulate uploads.
    if (active)
      return rejectScan(
        429,
        "A scan is already running. Wait for it to finish.",
      );
    const started = now();
    while (attempts.length && started - attempts[0] >= 3600000)
      attempts.shift();
    if (
      attempts.length >= 10 ||
      attempts.filter((time) => started - time < 60000).length >= 2
    )
      return rejectScan(
        429,
        "Wait before scanning again. Gather allows two submissions per minute and ten per hour.",
      );
    active = true;
    const abort = new AbortController();
    const disconnected = () => abort.abort();
    req.once("aborted", disconnected);
    res.once("close", disconnected);
    const uploadDeadline = setTimeout(() => {
      abort.abort();
      // End the response and release an incomplete upload.
      if (res.destroyed || res.writableEnded) return;
      res.once("finish", () => req.destroy());
      res.setHeader("connection", "close");
      rejectScan(
        408,
        "Uploading the receipt took too long. Try fewer photos or enter it manually.",
      );
    }, uploadTimeoutMs);
    try {
      const chunks = [];
      let size = 0;
      // Leave the socket open long enough to send a 413 for chunked uploads.
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        abort.signal.throwIfAborted();
        size += chunk.length;
        if (size > MAX_AI_BODY_BYTES) {
          res.setHeader("connection", "close");
          return rejectScan(413, oversized);
        }
        chunks.push(chunk);
      }
      clearTimeout(uploadDeadline);
      abort.signal.throwIfAborted();
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
      } catch {
        return rejectScan(
          400,
          "The receipt request is invalid. Choose the photos again.",
        );
      }
      const parsed = openaiRequestSchema.safeParse(body);
      if (!parsed.success)
        return rejectScan(
          400,
          "Choose valid receipt sections and confirm sending them to OpenAI and using API credits.",
        );
      attempts.push(now());
      const result = await openaiReader.extract(parsed.data.panels, {
        signal: abort.signal,
      });
      return send(200, result);
    } catch (error) {
      if (error instanceof OpenAiError)
        return rejectScan(error.status, error.message, error.attemptUsed);
      return rejectScan(
        abort.signal.aborted ? 504 : 500,
        "The scan could not finish. Your photos are still available. You can enter the receipt manually.",
        null,
      );
    } finally {
      clearTimeout(uploadDeadline);
      req.removeListener("aborted", disconnected);
      res.removeListener("close", disconnected);
      active = false;
    }
  };
}
