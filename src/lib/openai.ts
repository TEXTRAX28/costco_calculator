import { z } from "zod";
import type { ReceiptImage } from "./images";
import type { ReadingContext } from "./reading-context.mjs";
import { panelsForImages } from "./panel-transport";
import { receiptFromOpenAi } from "./openai-draft";
import { MAX_AI_BODY_BYTES } from "./scan-limits.mjs";
import { openaiStatusSchema } from "./openai-schema.mjs";

export class ScanAccessError extends Error {
  constructor() {
    super("The scan server requires sign-in.");
  }
}

export async function openaiConfiguration(signal: AbortSignal) {
  const response = await fetch("./api/receipts/openai/config", {
    signal,
    cache: "no-store",
    redirect: "error",
  });
  if (response.status === 401 || response.status === 403)
    throw new ScanAccessError();
  if (!response.ok) throw new Error("OpenAI connection unavailable");
  return openaiStatusSchema.parse(await response.json());
}

export async function extractWithOpenAi(
  images: ReceiptImage[],
  signal: AbortSignal,
  progress: (status: string) => void,
  context?: ReadingContext,
) {
  progress("Preparing receipt sections for OpenAI…");
  const panels = await panelsForImages(images, signal).catch((error) => {
    if (signal.aborted)
      throw new Error("Scan cancelled before upload. No app attempt was used.");
    throw error;
  });
  if (signal.aborted)
    throw new Error("Scan cancelled before upload. No app attempt was used.");
  const body = JSON.stringify({ consent: true, useCredits: true, panels });
  if (new TextEncoder().encode(body).byteLength > MAX_AI_BODY_BYTES)
    throw new Error(
      "These receipt sections are too large together. Crop the photos or choose fewer sections.",
    );
  const deadline = AbortSignal.timeout(95000);
  const requestSignal = AbortSignal.any([signal, deadline]);
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    throw new Error(
      "You’re offline. No scan was sent. Reconnect to scan or enter the receipt manually.",
    );
  progress("OpenAI is reading your receipt…");
  try {
    const response = await fetch("./api/receipts/openai", {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "x-gather-request": "receipt-scan",
      },
      body,
      signal: requestSignal,
    });
    const result = await response.json().catch(() => null);
    requestSignal.throwIfAborted();
    if (!response.ok) {
      const message =
        typeof result?.error === "string"
          ? result.error.slice(0, 500)
          : response.status === 401 || response.status === 403
            ? "Access to the scan server expired or was refused. Sign in again or enter the receipt manually."
            : response.status === 413
              ? "The receipt is too large to upload. Crop the photos or choose fewer pages or photos."
              : response.status === 408 || response.status === 504
                ? "The scan timed out. Try fewer sections or enter the receipt manually."
                : "The scan server did not return a usable response. Check the connection or enter the receipt manually.";
      const attempt =
        result?.attemptUsed === true
          ? " One app attempt was used. OpenAI may have billed for it."
          : result?.attemptUsed === false
            ? " No app attempt was used."
            : " Check the remaining allowance before trying again.";
      throw new Error(message + attempt);
    }
    return receiptFromOpenAi(result?.receipt, context, images.length);
  } catch (error) {
    if (signal.aborted || deadline.aborted)
      throw new Error(
        (deadline.aborted ? "The scan timed out." : "Scan cancelled.") +
          " If the request reached the server, it may have used an attempt and API credits. Your photos are still available.",
      );
    if (error instanceof z.ZodError)
      throw new Error(
        "OpenAI returned an invalid or incomplete draft. Check the remaining attempts before trying again, or enter the receipt manually. Your photos are still available.",
      );
    if (error instanceof TypeError || error instanceof SyntaxError)
      throw new Error(
        "The scan connection dropped. It may have used an attempt and API credits. Reconnect and check the allowance, or enter the receipt manually.",
      );
    throw error;
  }
}
