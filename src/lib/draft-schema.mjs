import { z } from "zod";

export const currencies = Object.freeze({
  GBP: 2,
  USD: 2,
  EUR: 2,
  CAD: 2,
  AUD: 2,
  NZD: 2,
  CHF: 2,
  SEK: 2,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
  IDR: 2,
  TWD: 2,
});
const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[\w-]+$/);
const numericDraft = z.string().max(40);
export const assignmentSchema = z.object({
  mode: z.enum(["equal", "quantity", "ratio", "percent"]),
  participants: z.array(id).max(30),
  values: z.record(id, numericDraft),
});
export const itemSchema = z.object({
  id,
  description: z.string().max(180),
  quantity: numericDraft,
  unitPrice: numericDraft,
  unitPriceDerived: z.boolean().optional(),
  unitPriceEdited: z.boolean().optional(),
  observedUnitPrice: numericDraft.optional(),
  observedDescription: z.string().max(180).optional(),
  observedPriceSuffix: z.string().max(12).optional(),
  lineTotal: numericDraft,
  discount: numericDraft,
  taxCode: z.string().max(12),
  packSize: numericDraft,
  unitKind: z.enum(["whole", "measured"]),
  note: z.string().max(300),
  assignment: assignmentSchema,
});
export const adjustmentSchema = z.object({
  id,
  label: z.string().max(100),
  kind: z.enum(["discount", "tax", "fee", "tip", "deposit", "rounding"]),
  amount: numericDraft,
  allocation: z.enum(["proportional", "equal-people"]),
  // Present only when a fee's printed amount explicitly includes tax at this rate.
  includedTaxRate: numericDraft.optional(),
});
export const itemReviewFields = /** @type {const} */ ([
  "description",
  "quantity",
  "unitPrice",
  "lineTotal",
  "discount",
  "taxCode",
]);
export const receiptReviewFields = /** @type {const} */ ([
  "merchant",
  "date",
  "currency",
  "subtotal",
  "printedTotal",
  "printedTax",
  "pricesIncludeTax",
  "taxCodes",
  "adjustments",
  "items",
]);
const reviewDetails = {
  reason: z.enum([
    "different",
    "unsupported",
    "unclear",
    "recovered",
    "coverage",
    "document",
    "classification",
    "source",
  ]),
  other: z.string().max(180).default(""),
  confirmedValue: z.string().max(250000).default(""),
  details: z
    .array(z.object({ label: z.string().max(100), value: z.string().max(80) }))
    .max(30)
    .optional(),
};
export const reviewCheckSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("item"),
    itemId: id,
    field: z.enum(itemReviewFields),
    ...reviewDetails,
  }),
  z.object({
    scope: z.literal("receipt"),
    field: z.enum(receiptReviewFields),
    ...reviewDetails,
  }),
]);
export const receiptSchema = z.object({
  id,
  merchant: z.string().max(100),
  date: z.string().max(20),
  currency: z.enum(
    /** @type {[keyof typeof currencies, ...(keyof typeof currencies)[]]} */ (
      Object.keys(currencies)
    ),
  ),
  currencyUnresolved: z.boolean().default(false),
  subtotal: numericDraft,
  printedTotal: numericDraft,
  printedTax: numericDraft.default(""),
  taxRegistrationNumber: z.string().max(80).optional(),
  printedTaxRate: numericDraft.optional(),
  pricesIncludeTax: z.boolean(),
  taxMode: z.enum(["printed", "codes"]),
  taxCodes: z
    .array(z.object({ code: z.string().max(12), rate: numericDraft }))
    .max(20),
  items: z.array(itemSchema).max(300),
  adjustments: z.array(adjustmentSchema).max(30),
  source: z.enum(["manual", "ocr", "ai", "text", "demo"]),
  rawText: z.string().max(60000),
  warnings: z.array(z.string().max(400)).max(60),
  reviewChecks: z.array(reviewCheckSchema).max(2100).default([]),
});
export const personSchema = z.object({ id, name: z.string().min(1).max(50) });
export const appSchema = z
  .object({
    version: z.literal(1),
    receipt: receiptSchema,
    people: z.array(personSchema).max(30),
    splitMode: z.enum(["items", "whole"]),
    wholeAssignment: assignmentSchema,
    reviewedStamp: z.string().max(250000),
    finalizedStamp: z.string().max(250000),
    step: z.enum(["scan", "review", "people", "assign", "summary"]),
  })
  .superRefine((state, ctx) => {
    for (const group of [
      state.receipt.items,
      state.receipt.adjustments,
      state.people,
    ]) {
      if (new Set(group.map((x) => x.id)).size !== group.length)
        ctx.addIssue({
          code: "custom",
          message: "Duplicate internal identifiers.",
        });
    }
  });

// Older Library entries have the same fields and no final confirmation.
export const savedReceiptSchema = appSchema.safeExtend({
  savedAsFinal: z.literal(true).optional(),
});
