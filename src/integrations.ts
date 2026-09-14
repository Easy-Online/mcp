import { createHmac, timingSafeEqual } from "node:crypto";
import type { OutboxEvent } from "./models.js";
import { JsonStore } from "./store.js";

export interface IntegrationDescriptor {
  id: string;
  name: string;
  purpose: string;
  configured: boolean;
  mode: "outbound" | "bidirectional";
  requiredEnvironment: string[];
}

const present = (name: string): boolean => Boolean(process.env[name]?.trim());

export class IntegrationService {
  constructor(private readonly store: JsonStore) {}

  list(): IntegrationDescriptor[] {
    return [
      { id: "webhook", name: "Generic signed webhook", purpose: "Push EasyFile change events to automation platforms and custom services", configured: present("EASYFILE_WEBHOOK_URL") && present("EASYFILE_WEBHOOK_SECRET"), mode: "outbound", requiredEnvironment: ["EASYFILE_WEBHOOK_URL", "EASYFILE_WEBHOOK_SECRET"] },
      { id: "shopify", name: "Shopify Admin", purpose: "Product, inventory, customer and order synchronisation", configured: present("SHOPIFY_STORE_DOMAIN") && present("SHOPIFY_ADMIN_ACCESS_TOKEN"), mode: "bidirectional", requiredEnvironment: ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_ACCESS_TOKEN"] },
      { id: "business_central", name: "Microsoft Dynamics 365 Business Central", purpose: "Items, customers, sales, purchasing and finance", configured: ["BUSINESS_CENTRAL_TENANT_ID", "BUSINESS_CENTRAL_ENVIRONMENT", "BUSINESS_CENTRAL_COMPANY_ID", "BUSINESS_CENTRAL_ACCESS_TOKEN"].every(present), mode: "bidirectional", requiredEnvironment: ["BUSINESS_CENTRAL_TENANT_ID", "BUSINESS_CENTRAL_ENVIRONMENT", "BUSINESS_CENTRAL_COMPANY_ID", "BUSINESS_CENTRAL_ACCESS_TOKEN"] },
      { id: "dynamics_365", name: "Microsoft Dynamics 365 Sales", purpose: "Accounts, contacts, leads and opportunities", configured: present("DYNAMICS_365_BASE_URL") && present("DYNAMICS_365_ACCESS_TOKEN"), mode: "bidirectional", requiredEnvironment: ["DYNAMICS_365_BASE_URL", "DYNAMICS_365_ACCESS_TOKEN"] },
      { id: "sage", name: "Sage", purpose: "Customers, invoices and accounting handoff", configured: present("SAGE_BASE_URL") && present("SAGE_ACCESS_TOKEN"), mode: "bidirectional", requiredEnvironment: ["SAGE_BASE_URL", "SAGE_ACCESS_TOKEN"] },
      { id: "xero", name: "Xero", purpose: "Contacts, invoices, payments and accounting handoff", configured: present("XERO_TENANT_ID") && present("XERO_ACCESS_TOKEN"), mode: "bidirectional", requiredEnvironment: ["XERO_TENANT_ID", "XERO_ACCESS_TOKEN"] }
    ];
  }

  async dispatchWebhook(limit = 50): Promise<{ delivered: number; failed: number; events: Array<{ id: string; ok: boolean; error?: string }> }> {
    const url = process.env.EASYFILE_WEBHOOK_URL;
    const secret = process.env.EASYFILE_WEBHOOK_SECRET;
    if (!url || !secret) throw new Error("EASYFILE_WEBHOOK_URL and EASYFILE_WEBHOOK_SECRET are required");
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) {
      throw new Error("Webhook URL must use HTTPS, except for localhost development");
    }
    const events = this.store.outbox(false, limit);
    const result: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const event of events) {
      const body = JSON.stringify(event);
      const signature = createHmac("sha256", secret).update(body).digest("hex");
      try {
        const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-easyfile-signature": `sha256=${signature}`, "x-easyfile-event": event.topic, "x-easyfile-delivery": event.id }, body, signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await this.store.markOutbox(event.id, true);
        result.push({ id: event.id, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.store.markOutbox(event.id, false, message);
        result.push({ id: event.id, ok: false, error: message });
      }
    }
    return { delivered: result.filter(row => row.ok).length, failed: result.filter(row => !row.ok).length, events: result };
  }

  static verifyWebhook(body: string, signature: string, secret: string): boolean {
    const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  pending(limit = 100): OutboxEvent[] {
    return this.store.outbox(false, limit);
  }
}
