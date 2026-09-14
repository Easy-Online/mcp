import { describe, expect, it } from "vitest";
import { calculateDocumentTotals } from "../src/calculations.js";

describe("document calculations", () => {
  it("calculates line discounts and VAT independently", () => {
    expect(calculateDocumentTotals([
      { description: "Subscription", quantity: 2, unitPrice: 100, discountRate: 10, taxRate: 15 },
      { description: "Exempt service", quantity: 1, unitPrice: 50, discountRate: 0, taxRate: 0 }
    ])).toEqual({ subtotal: 230, discount: 20, tax: 27, total: 257, amountPaid: 0, balance: 257 });
  });
});
