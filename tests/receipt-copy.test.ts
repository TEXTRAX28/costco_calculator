import { expect, it } from "vitest";
import { documentSchemas } from "../server/auth/documents.mjs";
import { receiptToSave, reopenSavedReceipt } from "../src/account/receipt-copy";
import { costcoDemo } from "../src/lib/demo";
import { calculateSplit } from "../src/lib/engine";
import { finalStamp, newState, receiptStamp } from "../src/lib/model";

it("saves reviewed details without raw receipt text and rechecks saved final splits", () => {
  const draft = newState();
  draft.receipt = costcoDemo();
  draft.receipt.source = "text";
  draft.receipt.rawText = "Sensitive source text";
  draft.people = [
    { id: "a", name: "Alex" },
    { id: "b", name: "Jamie" },
  ];
  draft.splitMode = "whole";
  draft.wholeAssignment.participants = ["a", "b"];
  draft.step = "summary";
  draft.reviewedStamp = receiptStamp(draft.receipt);
  draft.finalizedStamp = finalStamp(draft);
  const payload = documentSchemas.receipts.parse(receiptToSave(draft, true));
  expect(JSON.stringify(payload)).not.toContain("Sensitive source text");
  expect(payload.finalizedStamp).toBe("");

  const opened = reopenSavedReceipt(payload);
  expect(opened.step).toBe("review");
  expect(calculateSplit(opened).canFinalize).toBe(true);
  expect(opened.finalizedStamp).toBe(finalStamp(opened));

  const unassigned = reopenSavedReceipt({
    ...payload,
    wholeAssignment: { ...payload.wholeAssignment, participants: [] },
  });
  expect(calculateSplit(unassigned).canFinalize).toBe(false);
  expect(unassigned.finalizedStamp).toBe("");
});
