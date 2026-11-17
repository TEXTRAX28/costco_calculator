import type { z } from "zod";
import {
  currencies,
  assignmentSchema,
  itemSchema,
  adjustmentSchema,
  receiptReviewFields,
  reviewCheckSchema,
  receiptSchema,
  personSchema,
  appSchema,
} from "./draft-schema.mjs";

export {
  currencies,
  assignmentSchema,
  itemSchema,
  adjustmentSchema,
  itemReviewFields,
  receiptReviewFields,
  reviewCheckSchema,
  receiptSchema,
  personSchema,
  appSchema,
} from "./draft-schema.mjs";

export type Currency = keyof typeof currencies;
export type Assignment = z.infer<typeof assignmentSchema>;
export type Item = z.infer<typeof itemSchema>;
export type Adjustment = z.infer<typeof adjustmentSchema>;
export type ReceiptReviewField = (typeof receiptReviewFields)[number];
export type ReviewCheck = z.infer<typeof reviewCheckSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type Person = z.infer<typeof personSchema>;
export type AppState = z.infer<typeof appSchema>;

export const uid = () => crypto.randomUUID();
export const emptyAssignment = (): Assignment => ({
  mode: "equal",
  participants: [],
  values: {},
});
export function newItem(): Item {
  return {
    id: uid(),
    description: "",
    quantity: "1",
    unitPrice: "",
    unitPriceDerived: false,
    lineTotal: "",
    discount: "0",
    taxCode: "",
    packSize: "",
    unitKind: "whole",
    note: "",
    assignment: emptyAssignment(),
  };
}
export function newReceipt(): Receipt {
  return {
    id: uid(),
    merchant: "",
    date: "",
    currency: "GBP",
    currencyUnresolved: false,
    subtotal: "",
    printedTotal: "",
    printedTax: "",
    taxRegistrationNumber: "",
    printedTaxRate: "",
    pricesIncludeTax: true,
    taxMode: "printed",
    taxCodes: [],
    items: [],
    adjustments: [],
    source: "manual",
    rawText: "",
    warnings: [],
    reviewChecks: [],
  };
}
export function newState(): AppState {
  return {
    version: 1,
    receipt: newReceipt(),
    people: [],
    splitMode: "items",
    wholeAssignment: emptyAssignment(),
    reviewedStamp: "",
    finalizedStamp: "",
    step: "scan",
  };
}
export const receiptStamp = (receipt: Receipt) => {
  const {
    currencyUnresolved,
    reviewChecks: _reviewChecks,
    ...fields
  } = receipt;
  return JSON.stringify({
    ...fields,
    // Preserve valid review fingerprints from drafts saved before this flag existed.
    ...(currencyUnresolved ? { currencyUnresolved: true } : {}),
    rawText: "",
    items: receipt.items.map(
      ({
        assignment: _assignment,
        packSize: _packSize,
        unitKind: _unitKind,
        ...financial
      }) => financial,
    ),
  });
};
export const finalStamp = (state: AppState) =>
  JSON.stringify([
    state.receipt,
    state.people,
    state.splitMode,
    state.wholeAssignment,
  ]);
