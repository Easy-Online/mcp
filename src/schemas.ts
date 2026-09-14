import { z } from "zod";

export const currencySchema = z.enum(["ZAR", "USD", "EUR", "GBP", "BWP", "MWK", "NGN", "RWF", "XAF", "MXN"]);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const addressSchema = z.object({
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional()
}).strict();

export const lineItemSchema = z.object({
  sku: z.string().min(1).optional(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discountRate: z.number().min(0).max(100).default(0),
  taxRate: z.number().min(0).max(100).default(15)
}).strict();

export const customerInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  company: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  taxNumber: z.string().optional(),
  registrationNumber: z.string().optional(),
  address: addressSchema.optional(),
  status: z.enum(["lead", "prospect", "customer", "inactive"]).default("customer"),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  externalIds: z.record(z.string()).optional()
}).strict();

export const commercialDocumentInputSchema = z.object({
  customerId: z.string().uuid().optional(),
  counterpartyName: z.string().min(1),
  counterpartyEmail: z.string().email().optional(),
  issueDate: dateSchema,
  dueDate: dateSchema.optional(),
  currency: currencySchema.default("ZAR"),
  reference: z.string().optional(),
  items: z.array(lineItemSchema).min(1),
  notes: z.string().optional(),
  terms: z.string().optional(),
  sourceId: z.string().uuid().optional()
}).strict();

export const receiptInputSchema = z.object({
  customerId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  receivedFrom: z.string().min(1),
  date: dateSchema,
  paymentMethod: z.enum(["cash", "card", "eft", "bank_transfer", "other"]),
  currency: currencySchema.default("ZAR"),
  amount: z.number().positive(),
  reference: z.string().optional(),
  notes: z.string().optional()
}).strict();

export const jobLineSchema = z.object({
  description: z.string().min(1),
  hours: z.number().nonnegative(),
  hourlyRate: z.number().nonnegative(),
  partsCost: z.number().nonnegative()
}).strict();

export const payrollLineSchema = z.object({
  description: z.string().min(1),
  amount: z.number().nonnegative()
}).strict();
