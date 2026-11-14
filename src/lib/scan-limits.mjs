export const MAX_RECEIPT_IMAGES = 12;
export const MAX_BATCH_BYTES = 48 * 1024 * 1024;
export const MAX_READING_PANELS = 24;
export const MAX_AI_BODY_BYTES = 18 * 1024 * 1024;

export const SCAN_UPLOAD_TIMEOUT_MS = 15000;
export const OPENAI_RESPONSE_TIMEOUT_MS = 90000;
// Allow the upload and model to finish before the browser gives up.
export const SCAN_REQUEST_TIMEOUT_MS =
  SCAN_UPLOAD_TIMEOUT_MS + OPENAI_RESPONSE_TIMEOUT_MS + 10000;
