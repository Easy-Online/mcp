import type { JobLine, LineItem, Totals } from "./models.js";

export const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateDocumentTotals(items: LineItem[], amountPaid = 0): Totals {
  let beforeDiscount = 0;
  let subtotal = 0;
  let tax = 0;
  for (const item of items) {
    const lineBase = item.quantity * item.unitPrice;
    const discounted = lineBase * (1 - item.discountRate / 100);
    beforeDiscount += lineBase;
    subtotal += discounted;
    tax += discounted * item.taxRate / 100;
  }
  const total = money(subtotal + tax);
  return {
    subtotal: money(subtotal),
    discount: money(beforeDiscount - subtotal),
    tax: money(tax),
    total,
    amountPaid: money(amountPaid),
    balance: money(total - amountPaid)
  };
}

export function calculateJobTotal(lines: JobLine[]): number {
  return money(lines.reduce((sum, line) => sum + line.hours * line.hourlyRate + line.partsCost, 0));
}
