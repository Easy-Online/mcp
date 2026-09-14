import { randomUUID } from "node:crypto";
import { calculateDocumentTotals, calculateJobTotal, money } from "./calculations.js";
import type {
  CommercialDocument, Currency, Customer, DocumentKind, Employee, InventoryItem,
  InventoryMovement, JobCard, JobLine, LineItem, PayrollLine, PayrollRun, Receipt
} from "./models.js";
import { JsonStore } from "./store.js";

const prefixes: Record<DocumentKind, string> = {
  quote: "QUO", invoice: "INV", sales_order: "SO", purchase_order: "PO"
};

const initialStatus: Record<DocumentKind, string> = {
  quote: "draft", invoice: "draft", sales_order: "draft", purchase_order: "draft"
};

export interface DocumentInput {
  customerId?: string;
  counterpartyName: string;
  counterpartyEmail?: string;
  issueDate: string;
  dueDate?: string;
  currency: Currency;
  reference?: string;
  items: LineItem[];
  notes?: string;
  terms?: string;
  sourceId?: string;
}

export class EasyFileService {
  constructor(readonly store: JsonStore) {}

  modules() {
    return [
      { id: "crm", name: "Easy CRM", entities: ["customers"], capabilities: ["upsert", "get", "list", "search"] },
      { id: "quotes", name: "Easy Quote", entities: ["quotes"], capabilities: ["create", "list", "status", "convert-to-invoice", "convert-to-sales-order"] },
      { id: "invoices", name: "Easy Invoice", entities: ["invoices"], capabilities: ["create", "list", "status", "record-payment"] },
      { id: "purchase_orders", name: "Easy Purchase Order", entities: ["purchase_orders"], capabilities: ["create", "list", "status", "receive-to-inventory"] },
      { id: "sales_orders", name: "Easy Sales Order", entities: ["sales_orders"], capabilities: ["create", "list", "status", "fulfil-from-inventory"] },
      { id: "receipts", name: "Easy Receipt", entities: ["receipts"], capabilities: ["create", "list"] },
      { id: "job_cards", name: "Easy Job Card", entities: ["job_cards"], capabilities: ["create", "list", "status", "convert-to-invoice"] },
      { id: "payroll", name: "Easy Payroll", entities: ["employees", "payroll_runs"], capabilities: ["upsert-employee", "run-payroll", "list"] },
      { id: "inventory", name: "Easy Inventory", entities: ["inventory", "movements"], capabilities: ["upsert", "adjust", "list", "low-stock"] }
    ];
  }

  async upsertCustomer(input: Omit<Customer, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<Customer> {
    const id = input.id ?? randomUUID();
    return this.store.upsert<Customer>("customers", { ...input, id });
  }

  listCustomers(query?: string, status?: Customer["status"]): Customer[] {
    const q = query?.trim().toLowerCase();
    return this.store.list<Customer>("customers").filter(customer => {
      const matchesQuery = !q || `${customer.name} ${customer.company ?? ""} ${customer.email ?? ""} ${customer.phone ?? ""} ${customer.tags.join(" ")}`.toLowerCase().includes(q);
      return matchesQuery && (!status || customer.status === status);
    });
  }

  getCustomer(id: string): Customer {
    return this.require("customers", id);
  }

  async createDocument(kind: DocumentKind, input: DocumentInput): Promise<CommercialDocument> {
    if (input.customerId) this.getCustomer(input.customerId);
    const sequence = this.store.list<CommercialDocument>("documents").filter(row => row.kind === kind).length + 1;
    const year = new Date(input.issueDate).getUTCFullYear();
    return this.store.create<CommercialDocument>("documents", {
      ...input,
      kind,
      number: `${prefixes[kind]}-${year}-${String(sequence).padStart(5, "0")}`,
      status: initialStatus[kind],
      totals: calculateDocumentTotals(input.items)
    });
  }

  listDocuments(kind: DocumentKind, status?: string, customerId?: string): CommercialDocument[] {
    return this.store.list<CommercialDocument>("documents").filter(row => row.kind === kind && (!status || row.status === status) && (!customerId || row.customerId === customerId));
  }

  getDocument(id: string, expectedKind?: DocumentKind): CommercialDocument {
    const result = this.require<CommercialDocument>("documents", id);
    if (expectedKind && result.kind !== expectedKind) throw new Error(`Document ${id} is a ${result.kind}, not a ${expectedKind}`);
    return result;
  }

  async updateDocumentStatus(id: string, kind: DocumentKind, status: string): Promise<CommercialDocument> {
    this.getDocument(id, kind);
    return this.store.update<CommercialDocument>("documents", id, current => ({ ...current, status }));
  }

  async convertDocument(sourceId: string, sourceKind: DocumentKind, targetKind: DocumentKind, issueDate: string, dueDate?: string): Promise<CommercialDocument> {
    const source = this.getDocument(sourceId, sourceKind);
    const converted = await this.createDocument(targetKind, {
      customerId: source.customerId,
      counterpartyName: source.counterpartyName,
      counterpartyEmail: source.counterpartyEmail,
      issueDate,
      dueDate,
      currency: source.currency,
      reference: source.number,
      items: source.items,
      notes: source.notes,
      terms: source.terms,
      sourceId: source.id
    });
    await this.updateDocumentStatus(source.id, sourceKind, targetKind === "invoice" ? "converted_to_invoice" : `converted_to_${targetKind}`);
    return converted;
  }

  async createReceipt(input: Omit<Receipt, "id" | "createdAt" | "updatedAt" | "number">): Promise<Receipt> {
    if (input.invoiceId) {
      const invoice = this.getDocument(input.invoiceId, "invoice");
      if (invoice.currency !== input.currency) throw new Error("Receipt currency must match the invoice currency");
    }
    const sequence = this.store.list<Receipt>("receipts").length + 1;
    const receipt = await this.store.create<Receipt>("receipts", { ...input, number: `REC-${new Date(input.date).getUTCFullYear()}-${String(sequence).padStart(5, "0")}` });
    if (input.invoiceId) {
      await this.store.update<CommercialDocument>("documents", input.invoiceId, invoice => {
        const totals = calculateDocumentTotals(invoice.items, invoice.totals.amountPaid + input.amount);
        return { ...invoice, totals, status: totals.balance <= 0 ? "paid" : "partially_paid" };
      });
    }
    return receipt;
  }

  listReceipts(invoiceId?: string, customerId?: string): Receipt[] {
    return this.store.list<Receipt>("receipts").filter(row => (!invoiceId || row.invoiceId === invoiceId) && (!customerId || row.customerId === customerId));
  }

  async createJobCard(input: {
    customerId?: string; customerName: string; date: string; dueDate?: string; assignedTo?: string;
    description: string; currency: Currency; deposit: number; lines: JobLine[]; notes?: string;
  }): Promise<JobCard> {
    if (input.customerId) this.getCustomer(input.customerId);
    const total = calculateJobTotal(input.lines);
    const sequence = this.store.list<JobCard>("jobCards").length + 1;
    return this.store.create<JobCard>("jobCards", {
      ...input, number: `JOB-${new Date(input.date).getUTCFullYear()}-${String(sequence).padStart(5, "0")}`,
      status: "draft", total, balance: money(total - input.deposit)
    });
  }

  listJobCards(status?: JobCard["status"], customerId?: string): JobCard[] {
    return this.store.list<JobCard>("jobCards").filter(row => (!status || row.status === status) && (!customerId || row.customerId === customerId));
  }

  async updateJobStatus(id: string, status: JobCard["status"]): Promise<JobCard> {
    return this.store.update<JobCard>("jobCards", id, current => ({ ...current, status }));
  }

  async jobToInvoice(id: string, issueDate: string, dueDate?: string): Promise<CommercialDocument> {
    const job = this.require<JobCard>("jobCards", id);
    const invoice = await this.createDocument("invoice", {
      customerId: job.customerId, counterpartyName: job.customerName, issueDate, dueDate,
      currency: job.currency, reference: job.number, sourceId: job.id,
      items: job.lines.map(line => ({ description: line.description, quantity: line.hours || 1, unitPrice: line.hours ? line.hourlyRate + line.partsCost / line.hours : line.partsCost, discountRate: 0, taxRate: 15 })),
      notes: job.notes
    });
    await this.updateJobStatus(id, "invoiced");
    return invoice;
  }

  async upsertInventory(input: Omit<InventoryItem, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<InventoryItem> {
    const normalizedSku = input.sku.trim().toUpperCase();
    const existing = this.store.list<InventoryItem>("inventory").find(row => row.sku === normalizedSku);
    return this.store.upsert<InventoryItem>("inventory", { ...input, sku: normalizedSku, id: input.id ?? existing?.id ?? randomUUID() });
  }

  listInventory(query?: string, lowStockOnly = false): InventoryItem[] {
    const q = query?.trim().toLowerCase();
    return this.store.list<InventoryItem>("inventory").filter(row => (!q || `${row.sku} ${row.name} ${row.category ?? ""}`.toLowerCase().includes(q)) && (!lowStockOnly || row.stock <= row.reorderLevel));
  }

  async adjustInventory(sku: string, type: InventoryMovement["type"], quantity: number, reference?: string, notes?: string): Promise<InventoryMovement> {
    const normalizedSku = sku.trim().toUpperCase();
    const item = this.store.list<InventoryItem>("inventory").find(row => row.sku === normalizedSku);
    if (!item) throw new Error(`Inventory SKU ${normalizedSku} was not found`);
    const delta = type === "sale" ? -Math.abs(quantity) : type === "adjustment" ? quantity : Math.abs(quantity);
    if (item.stock + delta < 0) throw new Error(`Insufficient stock for ${normalizedSku}; available ${item.stock}, requested ${Math.abs(delta)}`);
    const before = item.stock;
    const after = before + delta;
    await this.store.update<InventoryItem>("inventory", item.id, current => ({ ...current, stock: after }));
    return this.store.create<InventoryMovement>("inventoryMovements", { sku: normalizedSku, type, quantity: delta, before, after, reference, notes });
  }

  async applyDocumentToInventory(id: string, kind: "purchase_order" | "sales_order"): Promise<InventoryMovement[]> {
    const document = this.getDocument(id, kind);
    const movements: InventoryMovement[] = [];
    for (const line of document.items) {
      if (!line.sku) continue;
      movements.push(await this.adjustInventory(line.sku, kind === "purchase_order" ? "receipt" : "sale", line.quantity, document.number));
    }
    await this.updateDocumentStatus(id, kind, kind === "purchase_order" ? "received" : "fulfilled");
    return movements;
  }

  async upsertEmployee(input: Omit<Employee, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<Employee> {
    const existing = this.store.list<Employee>("employees").find(row => row.employeeNumber === input.employeeNumber);
    return this.store.upsert<Employee>("employees", { ...input, id: input.id ?? existing?.id ?? randomUUID() });
  }

  listEmployees(activeOnly = true): Employee[] {
    return this.store.list<Employee>("employees").filter(row => !activeOnly || row.active);
  }

  async runPayroll(input: { employeeId: string; payPeriod: string; currency: Currency; earnings: PayrollLine[]; deductions: PayrollLine[]; payeRate: number; uifRate: number }): Promise<PayrollRun> {
    const employee = this.require<Employee>("employees", input.employeeId);
    const earnings = input.earnings.length ? input.earnings : [{ description: "Base salary", amount: employee.baseSalary }];
    const grossPay = money(earnings.reduce((sum, line) => sum + line.amount, 0));
    const paye = money(grossPay * input.payeRate / 100);
    const uif = money(grossPay * input.uifRate / 100);
    const manual = input.deductions.reduce((sum, line) => sum + line.amount, 0);
    const totalDeductions = money(manual + paye + uif);
    return this.store.create<PayrollRun>("payrollRuns", {
      employeeId: employee.id, employeeName: employee.name, payPeriod: input.payPeriod,
      currency: input.currency, earnings, deductions: input.deductions, paye, uif, grossPay,
      totalDeductions, netPay: money(grossPay - totalDeductions), status: "draft"
    });
  }

  listPayrollRuns(payPeriod?: string, employeeId?: string): PayrollRun[] {
    return this.store.list<PayrollRun>("payrollRuns").filter(row => (!payPeriod || row.payPeriod === payPeriod) && (!employeeId || row.employeeId === employeeId));
  }

  private require<T extends { id: string }>(collection: Parameters<JsonStore["get"]>[0], id: string): T {
    const row = this.store.get(collection, id) as T | undefined;
    if (!row) throw new Error(`${collection} record ${id} was not found`);
    return row;
  }
}
