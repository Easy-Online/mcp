import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { IntegrationService } from "./integrations.js";
import type { DocumentKind } from "./models.js";
import { EasyFileService } from "./service.js";
import { commercialDocumentInputSchema, currencySchema, customerInputSchema, dateSchema, jobLineSchema, payrollLineSchema, receiptInputSchema } from "./schemas.js";

const jsonResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
});

const tool = async <T>(operation: () => Promise<T> | T) => {
  try {
    return jsonResult(await operation());
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
      isError: true
    };
  }
};

const listFilterSchema = {
  status: z.string().optional().describe("Optional exact status filter"),
  customerId: z.string().uuid().optional()
};

export function createEasyFileServer(service: EasyFileService, integrations: IntegrationService): McpServer {
  const server = new McpServer({ name: "easyfile-mcp", version: "0.1.0" }, { capabilities: { logging: {} } });

  server.registerTool("easyfile_modules_list", {
    title: "List EasyFile modules",
    description: "Discover EasyFile modules, entities and supported operations.",
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async () => jsonResult(service.modules()));

  server.registerTool("easyfile_summary", {
    title: "Get EasyFile summary",
    description: "Return record counts, invoice balances, stock value, low-stock count and pending integration events.",
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async () => tool(() => {
    const db = service.store.snapshot();
    const invoices = db.documents.filter(row => row.kind === "invoice");
    return {
      counts: {
        customers: db.customers.length,
        quotes: db.documents.filter(row => row.kind === "quote").length,
        invoices: invoices.length,
        salesOrders: db.documents.filter(row => row.kind === "sales_order").length,
        purchaseOrders: db.documents.filter(row => row.kind === "purchase_order").length,
        receipts: db.receipts.length,
        jobCards: db.jobCards.length,
        inventoryItems: db.inventory.length,
        employees: db.employees.length,
        payrollRuns: db.payrollRuns.length
      },
      receivables: invoices.reduce((sum, row) => sum + row.totals.balance, 0),
      inventoryCostValue: db.inventory.reduce((sum, row) => sum + row.cost * row.stock, 0),
      lowStockItems: db.inventory.filter(row => row.stock <= row.reorderLevel).length,
      pendingIntegrationEvents: db.outbox.filter(row => !row.deliveredAt).length
    };
  }));

  server.registerTool("crm_customer_upsert", {
    title: "Create or update customer",
    description: "Create a CRM customer, or update one when id is supplied.",
    inputSchema: customerInputSchema.shape,
    annotations: { idempotentHint: true }
  }, async input => tool(() => service.upsertCustomer(input)));

  server.registerTool("crm_customer_get", {
    title: "Get customer",
    description: "Get a CRM customer by EasyFile UUID.",
    inputSchema: { id: z.string().uuid() },
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async ({ id }) => tool(() => service.getCustomer(id)));

  server.registerTool("crm_customers_list", {
    title: "Search customers",
    description: "List or search CRM customers by name, company, contact detail or tag.",
    inputSchema: { query: z.string().optional(), status: z.enum(["lead", "prospect", "customer", "inactive"]).optional() },
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async ({ query, status }) => jsonResult(service.listCustomers(query, status)));

  const registerDocumentModule = (kind: DocumentKind, label: string) => {
    const toolPrefix = kind.replaceAll("_", "-");
    server.registerTool(`${toolPrefix}_create`, {
      title: `Create ${label}`,
      description: `Create a calculated ${label.toLowerCase()} with line-level discounts and tax.`,
      inputSchema: commercialDocumentInputSchema.shape
    }, async input => tool(() => service.createDocument(kind, input)));

    server.registerTool(`${toolPrefix}_get`, {
      title: `Get ${label}`,
      description: `Get a ${label.toLowerCase()} by EasyFile UUID.`,
      inputSchema: { id: z.string().uuid() },
      annotations: { readOnlyHint: true, idempotentHint: true }
    }, async ({ id }) => tool(() => service.getDocument(id, kind)));

    server.registerTool(`${toolPrefix}_list`, {
      title: `List ${label}s`,
      description: `List ${label.toLowerCase()} records with optional status and customer filters.`,
      inputSchema: listFilterSchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    }, async ({ status, customerId }) => jsonResult(service.listDocuments(kind, status, customerId)));

    server.registerTool(`${toolPrefix}_status_update`, {
      title: `Update ${label} status`,
      description: `Set the workflow status of a ${label.toLowerCase()}.`,
      inputSchema: { id: z.string().uuid(), status: z.string().min(1).max(50) },
      annotations: { idempotentHint: true }
    }, async ({ id, status }) => tool(() => service.updateDocumentStatus(id, kind, status)));
  };

  registerDocumentModule("quote", "Quote");
  registerDocumentModule("invoice", "Invoice");
  registerDocumentModule("sales_order", "Sales order");
  registerDocumentModule("purchase_order", "Purchase order");

  server.registerTool("quote_convert", {
    title: "Convert quote",
    description: "Convert a quote into an invoice or sales order and preserve the source link.",
    inputSchema: { quoteId: z.string().uuid(), target: z.enum(["invoice", "sales_order"]), issueDate: dateSchema, dueDate: dateSchema.optional() }
  }, async ({ quoteId, target, issueDate, dueDate }) => tool(() => service.convertDocument(quoteId, "quote", target, issueDate, dueDate)));

  server.registerTool("receipt_create", {
    title: "Create receipt",
    description: "Record a payment receipt. If invoiceId is supplied, automatically update the invoice balance and status.",
    inputSchema: receiptInputSchema.shape
  }, async input => tool(() => service.createReceipt(input)));

  server.registerTool("receipts_list", {
    title: "List receipts",
    description: "List receipts, optionally filtered by invoice or customer.",
    inputSchema: { invoiceId: z.string().uuid().optional(), customerId: z.string().uuid().optional() },
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async ({ invoiceId, customerId }) => jsonResult(service.listReceipts(invoiceId, customerId)));

  server.registerTool("job-card_create", {
    title: "Create job card",
    description: "Create a service job card with labour and parts costing.",
    inputSchema: {
      customerId: z.string().uuid().optional(), customerName: z.string().min(1), date: dateSchema,
      dueDate: dateSchema.optional(), assignedTo: z.string().optional(), description: z.string().min(1),
      currency: currencySchema.default("ZAR"), deposit: z.number().nonnegative().default(0),
      lines: z.array(jobLineSchema).min(1), notes: z.string().optional()
    }
  }, async input => tool(() => service.createJobCard(input)));

  server.registerTool("job-cards_list", {
    title: "List job cards",
    description: "List job cards with optional status and customer filters.",
    inputSchema: { status: z.enum(["draft", "scheduled", "in_progress", "waiting", "completed", "invoiced", "cancelled"]).optional(), customerId: z.string().uuid().optional() },
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async ({ status, customerId }) => jsonResult(service.listJobCards(status, customerId)));

  server.registerTool("job-card_status_update", {
    title: "Update job status",
    description: "Update a job card workflow status.",
    inputSchema: { id: z.string().uuid(), status: z.enum(["draft", "scheduled", "in_progress", "waiting", "completed", "invoiced", "cancelled"]) },
    annotations: { idempotentHint: true }
  }, async ({ id, status }) => tool(() => service.updateJobStatus(id, status)));

  server.registerTool("job-card_convert_to_invoice", {
    title: "Invoice a job card",
    description: "Create an invoice from a job card and mark the job as invoiced.",
    inputSchema: { id: z.string().uuid(), issueDate: dateSchema, dueDate: dateSchema.optional() }
  }, async ({ id, issueDate, dueDate }) => tool(() => service.jobToInvoice(id, issueDate, dueDate)));

  server.registerTool("inventory_item_upsert", {
    title: "Create or update inventory item",
    description: "Upsert an inventory item by UUID or SKU.",
    inputSchema: {
      id: z.string().uuid().optional(), sku: z.string().min(1), name: z.string().min(1), category: z.string().optional(),
      cost: z.number().nonnegative(), price: z.number().nonnegative(), stock: z.number().int().nonnegative().default(0),
      reorderLevel: z.number().int().nonnegative().default(5), active: z.boolean().default(true), externalIds: z.record(z.string()).optional()
    },
    annotations: { idempotentHint: true }
  }, async input => tool(() => service.upsertInventory(input)));

  server.registerTool("inventory_list", {
    title: "List inventory",
    description: "Search inventory or return only low-stock items.",
    inputSchema: { query: z.string().optional(), lowStockOnly: z.boolean().default(false) },
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async ({ query, lowStockOnly }) => jsonResult(service.listInventory(query, lowStockOnly)));

  server.registerTool("inventory_adjust", {
    title: "Adjust inventory",
    description: "Record a stock receipt, sale, return or signed adjustment with an audit movement.",
    inputSchema: {
      sku: z.string().min(1), type: z.enum(["receipt", "sale", "adjustment", "return"]),
      quantity: z.number().int().refine(value => value !== 0), reference: z.string().optional(), notes: z.string().optional()
    }
  }, async ({ sku, type, quantity, reference, notes }) => tool(() => service.adjustInventory(sku, type, quantity, reference, notes)));

  server.registerTool("inventory_apply_order", {
    title: "Apply order to stock",
    description: "Receive a purchase order into stock or fulfil a sales order from stock using line-item SKUs.",
    inputSchema: { documentId: z.string().uuid(), kind: z.enum(["purchase_order", "sales_order"]) }
  }, async ({ documentId, kind }) => tool(() => service.applyDocumentToInventory(documentId, kind)));

  server.registerTool("payroll_employee_upsert", {
    title: "Create or update employee",
    description: "Upsert an employee by UUID or employee number.",
    inputSchema: {
      id: z.string().uuid().optional(), employeeNumber: z.string().min(1), name: z.string().min(1), email: z.string().email().optional(),
      taxNumber: z.string().optional(), baseSalary: z.number().nonnegative(), active: z.boolean().default(true), externalIds: z.record(z.string()).optional()
    },
    annotations: { idempotentHint: true }
  }, async input => tool(() => service.upsertEmployee(input)));

  server.registerTool("payroll_employees_list", {
    title: "List employees",
    description: "List payroll employees.",
    inputSchema: { activeOnly: z.boolean().default(true) },
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async ({ activeOnly }) => jsonResult(service.listEmployees(activeOnly)));

  server.registerTool("payroll_run_create", {
    title: "Create payroll run",
    description: "Calculate a payroll run. Rates are explicit inputs and are not presented as statutory tax advice.",
    inputSchema: {
      employeeId: z.string().uuid(), payPeriod: z.string().regex(/^\d{4}-\d{2}$/), currency: currencySchema.default("ZAR"),
      earnings: z.array(payrollLineSchema).default([]), deductions: z.array(payrollLineSchema).default([]),
      payeRate: z.number().min(0).max(100), uifRate: z.number().min(0).max(100)
    }
  }, async input => tool(() => service.runPayroll(input)));

  server.registerTool("payroll_runs_list", {
    title: "List payroll runs",
    description: "List payroll runs by period or employee.",
    inputSchema: { payPeriod: z.string().regex(/^\d{4}-\d{2}$/).optional(), employeeId: z.string().uuid().optional() },
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async ({ payPeriod, employeeId }) => jsonResult(service.listPayrollRuns(payPeriod, employeeId)));

  server.registerTool("integrations_list", {
    title: "List integrations",
    description: "List supported connector contracts and whether their required environment variables are configured. Secret values are never returned.",
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async () => jsonResult(integrations.list()));

  server.registerTool("integration_outbox_list", {
    title: "List integration events",
    description: "List pending transactional-outbox events for reliable downstream synchronisation.",
    inputSchema: { limit: z.number().int().min(1).max(500).default(100) },
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async ({ limit }) => jsonResult(integrations.pending(limit)));

  server.registerTool("integration_webhook_dispatch", {
    title: "Dispatch integration webhooks",
    description: "Send pending change events to the configured signed HTTPS webhook and record delivery attempts.",
    inputSchema: { limit: z.number().int().min(1).max(100).default(50) },
    annotations: { destructiveHint: false }
  }, async ({ limit }) => tool(() => integrations.dispatchWebhook(limit)));

  server.registerTool("audit_events_list", {
    title: "List audit events",
    description: "Return the latest EasyFile entity change events.",
    inputSchema: { limit: z.number().int().min(1).max(500).default(100) },
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async ({ limit }) => jsonResult(service.store.audit(limit)));

  server.registerResource("easyfile-modules", "easyfile://modules", {
    title: "EasyFile module catalog", description: "Available EasyFile modules and capabilities", mimeType: "application/json"
  }, async uri => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(service.modules(), null, 2) }] }));

  server.registerResource("easyfile-integrations", "easyfile://integrations", {
    title: "EasyFile integration catalog", description: "Supported connectors and configuration state", mimeType: "application/json"
  }, async uri => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(integrations.list(), null, 2) }] }));

  server.registerResource("easyfile-summary", "easyfile://summary", {
    title: "EasyFile database summary", description: "Non-secret record counts and operational state", mimeType: "application/json"
  }, async uri => {
    const db = service.store.snapshot();
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ schemaVersion: db.schemaVersion, customers: db.customers.length, documents: db.documents.length, receipts: db.receipts.length, jobCards: db.jobCards.length, inventory: db.inventory.length, employees: db.employees.length, payrollRuns: db.payrollRuns.length, pendingEvents: db.outbox.filter(row => !row.deliveredAt).length }, null, 2) }] };
  });

  server.registerPrompt("quote-to-cash", {
    title: "Quote-to-cash workflow",
    description: "Guide an operator through quote, invoice and receipt creation.",
    argsSchema: { customerName: z.string(), requirement: z.string(), currency: currencySchema.optional() }
  }, async ({ customerName, requirement, currency }) => ({ messages: [{ role: "user", content: { type: "text", text: `Run a controlled EasyFile quote-to-cash workflow for ${customerName} in ${currency ?? "ZAR"}. Requirement: ${requirement}. Search CRM first; avoid duplicates; draft the quote; show totals before conversion; convert only when instructed; record payment only from confirmed payment evidence.` } }] }));

  server.registerPrompt("procure-to-stock", {
    title: "Procure-to-stock workflow",
    description: "Guide an operator through purchase ordering and inventory receipt.",
    argsSchema: { supplier: z.string(), requirement: z.string() }
  }, async ({ supplier, requirement }) => ({ messages: [{ role: "user", content: { type: "text", text: `Prepare an EasyFile procure-to-stock workflow for supplier ${supplier}. Requirement: ${requirement}. Verify SKUs exist before creating the purchase order, show calculated totals, and apply the order to inventory only after goods receipt is confirmed.` } }] }));

  return server;
}
