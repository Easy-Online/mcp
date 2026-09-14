import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { EasyFileService } from "../src/service.js";
import { JsonStore } from "../src/store.js";

let service: EasyFileService;

beforeEach(async () => {
  const store = new JsonStore(await mkdtemp(join(tmpdir(), "easyfile-test-")));
  await store.init();
  service = new EasyFileService(store);
});

describe("EasyFile workflows", () => {
  it("converts a quote to an invoice and records settlement", async () => {
    const customer = await service.upsertCustomer({ name: "Acme", status: "customer", tags: [] });
    const quote = await service.createDocument("quote", {
      customerId: customer.id, counterpartyName: "Acme", issueDate: "2026-09-11", currency: "ZAR",
      items: [{ description: "Consulting", quantity: 2, unitPrice: 1000, discountRate: 0, taxRate: 15 }]
    });
    const invoice = await service.convertDocument(quote.id, "quote", "invoice", "2026-09-12", "2026-10-12");
    expect(invoice.sourceId).toBe(quote.id);
    expect(invoice.totals.total).toBe(2300);
    await service.createReceipt({ invoiceId: invoice.id, customerId: customer.id, receivedFrom: "Acme", date: "2026-09-13", paymentMethod: "eft", currency: "ZAR", amount: 2300 });
    expect(service.getDocument(invoice.id, "invoice").status).toBe("paid");
  });

  it("receives a purchase order into inventory", async () => {
    await service.upsertInventory({ sku: "SKU-1", name: "Router", cost: 500, price: 750, stock: 2, reorderLevel: 2, active: true });
    const order = await service.createDocument("purchase_order", {
      counterpartyName: "Distributor", issueDate: "2026-09-11", currency: "ZAR",
      items: [{ sku: "SKU-1", description: "Router", quantity: 5, unitPrice: 500, discountRate: 0, taxRate: 15 }]
    });
    await service.applyDocumentToInventory(order.id, "purchase_order");
    expect(service.listInventory("SKU-1")[0]?.stock).toBe(7);
    expect(service.getDocument(order.id).status).toBe("received");
  });
});
