export const MAX_RECEIPT_TITLE_LENGTH = 100;

/** @param {string} merchant */
export const defaultReceiptTitle = (merchant) => merchant.trim() || "Receipt";

/** @param {string} title */
export const receiptTitleKey = (title) =>
  title.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
