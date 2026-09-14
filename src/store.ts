import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { AuditEvent, CollectionName, EasyFileDatabase, Metadata, OutboxEvent } from "./models.js";

const emptyDatabase = (): EasyFileDatabase => ({
  schemaVersion: 1,
  customers: [], documents: [], receipts: [], jobCards: [], inventory: [],
  inventoryMovements: [], employees: [], payrollRuns: [], audit: [], outbox: []
});

export class JsonStore {
  private readonly file: string;
  private db: EasyFileDatabase = emptyDatabase();
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = resolve(dataDir, "easyfile.json");
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as EasyFileDatabase;
      if (parsed.schemaVersion !== 1) throw new Error(`Unsupported database schema ${String(parsed.schemaVersion)}`);
      this.db = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist();
    }
  }

  snapshot(): EasyFileDatabase {
    return structuredClone(this.db);
  }

  list<T extends Metadata>(collection: CollectionName): T[] {
    return structuredClone(this.db[collection] as unknown as T[]);
  }

  get<T extends Metadata>(collection: CollectionName, id: string): T | undefined {
    const result = (this.db[collection] as Metadata[]).find(item => item.id === id);
    return result ? structuredClone(result as T) : undefined;
  }

  async create<T extends Metadata>(collection: CollectionName, value: Omit<T, keyof Metadata>): Promise<T> {
    const now = new Date().toISOString();
    const entity = { ...value, id: randomUUID(), createdAt: now, updatedAt: now } as T;
    (this.db[collection] as unknown as T[]).push(entity);
    await this.recordChange("created", collection, entity.id, entity);
    return structuredClone(entity);
  }

  async upsert<T extends Metadata>(collection: CollectionName, value: Omit<T, "createdAt" | "updatedAt"> & Partial<Pick<T, "createdAt">>): Promise<T> {
    const rows = this.db[collection] as unknown as T[];
    const index = rows.findIndex(item => item.id === value.id);
    const now = new Date().toISOString();
    const entity = { ...value, createdAt: index >= 0 ? rows[index]!.createdAt : value.createdAt ?? now, updatedAt: now } as T;
    if (index >= 0) rows[index] = entity; else rows.push(entity);
    await this.recordChange(index >= 0 ? "updated" : "created", collection, entity.id, entity);
    return structuredClone(entity);
  }

  async update<T extends Metadata>(collection: CollectionName, id: string, updater: (current: T) => T): Promise<T> {
    const rows = this.db[collection] as unknown as T[];
    const index = rows.findIndex(item => item.id === id);
    if (index < 0) throw new Error(`${collection} record ${id} was not found`);
    const entity = { ...updater(structuredClone(rows[index]!)), id, createdAt: rows[index]!.createdAt, updatedAt: new Date().toISOString() };
    rows[index] = entity;
    await this.recordChange("updated", collection, id, entity);
    return structuredClone(entity);
  }

  audit(limit = 100): AuditEvent[] {
    return structuredClone(this.db.audit.slice(-Math.max(1, Math.min(limit, 500))).reverse());
  }

  outbox(includeDelivered = false, limit = 100): OutboxEvent[] {
    return structuredClone(this.db.outbox.filter(event => includeDelivered || !event.deliveredAt).slice(0, Math.max(1, Math.min(limit, 500))));
  }

  async markOutbox(id: string, delivered: boolean, error?: string): Promise<void> {
    const event = this.db.outbox.find(row => row.id === id);
    if (!event) throw new Error(`Outbox event ${id} was not found`);
    event.attempts += 1;
    if (delivered) event.deliveredAt = new Date().toISOString();
    if (error) event.lastError = error;
    await this.persist();
  }

  private async recordChange(action: string, entityType: string, entityId: string, payload: unknown): Promise<void> {
    const at = new Date().toISOString();
    this.db.audit.push({ id: randomUUID(), at, action, entityType, entityId, summary: `${entityType}.${action}` });
    this.db.outbox.push({ id: randomUUID(), at, topic: `easyfile.${entityType}.${action}`, entityType, entityId, payload, attempts: 0 });
    this.db.audit = this.db.audit.slice(-5000);
    this.db.outbox = this.db.outbox.slice(-10000);
    await this.persist();
  }

  private async persist(): Promise<void> {
    this.saveQueue = this.saveQueue.then(async () => {
      const temporary = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(this.db, null, 2), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.file);
    });
    await this.saveQueue;
  }
}
