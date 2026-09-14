export type Currency = "ZAR" | "USD" | "EUR" | "GBP" | "BWP" | "MWK" | "NGN" | "RWF" | "XAF" | "MXN";

export interface Metadata {
  id: string;
  createdAt: string;
  updatedAt: string;
  externalIds?: Record<string, string>;
}

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export interface Customer extends Metadata {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  taxNumber?: string;
  registrationNumber?: string;
  address?: Address;
  status: "lead" | "prospect" | "customer" | "inactive";
  tags: string[];
  notes?: string;
}

export interface LineItem {
  sku?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  taxRate: number;
}

export interface Totals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amountPaid: number;
  balance: number;
}

export type DocumentKind = "quote" | "invoice" | "sales_order" | "purchase_order";

export interface CommercialDocument extends Metadata {
  kind: DocumentKind;
  number: string;
  customerId?: string;
  counterpartyName: string;
  counterpartyEmail?: string;
  issueDate: string;
  dueDate?: string;
  currency: Currency;
  status: string;
  reference?: string;
  items: LineItem[];
  totals: Totals;
  notes?: string;
  terms?: string;
  sourceId?: string;
}

export interface Receipt extends Metadata {
  number: string;
  customerId?: string;
  invoiceId?: string;
  receivedFrom: string;
  date: string;
  paymentMethod: "cash" | "card" | "eft" | "bank_transfer" | "other";
  currency: Currency;
  amount: number;
  reference?: string;
  notes?: string;
}

export interface JobLine {
  description: string;
  hours: number;
  hourlyRate: number;
  partsCost: number;
}

export interface JobCard extends Metadata {
  number: string;
  customerId?: string;
  customerName: string;
  date: string;
  dueDate?: string;
  status: "draft" | "scheduled" | "in_progress" | "waiting" | "completed" | "invoiced" | "cancelled";
  assignedTo?: string;
  description: string;
  currency: Currency;
  deposit: number;
  lines: JobLine[];
  total: number;
  balance: number;
  notes?: string;
}

export interface InventoryItem extends Metadata {
  sku: string;
  name: string;
  category?: string;
  cost: number;
  price: number;
  stock: number;
  reorderLevel: number;
  active: boolean;
}

export interface InventoryMovement extends Metadata {
  sku: string;
  type: "receipt" | "sale" | "adjustment" | "return";
  quantity: number;
  before: number;
  after: number;
  reference?: string;
  notes?: string;
}

export interface Employee extends Metadata {
  employeeNumber: string;
  name: string;
  email?: string;
  taxNumber?: string;
  baseSalary: number;
  active: boolean;
}

export interface PayrollLine {
  description: string;
  amount: number;
}

export interface PayrollRun extends Metadata {
  employeeId: string;
  employeeName: string;
  payPeriod: string;
  currency: Currency;
  earnings: PayrollLine[];
  deductions: PayrollLine[];
  paye: number;
  uif: number;
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  status: "draft" | "approved" | "paid";
}

export interface AuditEvent {
  id: string;
  at: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
}

export interface OutboxEvent {
  id: string;
  at: string;
  topic: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  attempts: number;
  deliveredAt?: string;
  lastError?: string;
}

export interface EasyFileDatabase {
  schemaVersion: 1;
  customers: Customer[];
  documents: CommercialDocument[];
  receipts: Receipt[];
  jobCards: JobCard[];
  inventory: InventoryItem[];
  inventoryMovements: InventoryMovement[];
  employees: Employee[];
  payrollRuns: PayrollRun[];
  audit: AuditEvent[];
  outbox: OutboxEvent[];
}

export type CollectionName = keyof Pick<EasyFileDatabase,
  "customers" | "documents" | "receipts" | "jobCards" | "inventory" |
  "inventoryMovements" | "employees" | "payrollRuns">;
