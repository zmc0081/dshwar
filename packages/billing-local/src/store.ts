/**
 * 发票持久化 —— 实现细节,不进契约包。
 *
 * 与 metering 的 store 同一套形状(InMemory + Kv 走上游 storage 契约),
 * 同款已知限制:`loadAll` 整表进内存。发票量级是「每租户每月一张」,
 * 这个限制在可见的将来都不构成问题。
 */
import type { Invoice } from '@dshwar/billing'

export interface InvoiceStore {
  put(invoice: Invoice): Promise<void>
  get(tenantId: string, invoiceId: string): Promise<Invoice | undefined>
  /** 该租户全部发票,顺序不保证 —— 排序是服务层的事。 */
  listByTenant(tenantId: string): Promise<Invoice[]>
}

/** 内存实现。测试与单机开发用。 */
export class InMemoryInvoiceStore implements InvoiceStore {
  private readonly invoices = new Map<string, Invoice>()

  async put(invoice: Invoice): Promise<void> {
    this.invoices.set(invoice.id, invoice)
  }

  async get(tenantId: string, invoiceId: string): Promise<Invoice | undefined> {
    const found = this.invoices.get(invoiceId)
    // 租户不匹配按「不存在」处理 —— 与 attachment-tenant 同一条理由:
    // 404 与 403 的区分会向猜 id 的人确认「这个 id 存在」。
    return found === undefined || found.tenantId !== tenantId ? undefined : found
  }

  async listByTenant(tenantId: string): Promise<Invoice[]> {
    return [...this.invoices.values()].filter((i) => i.tenantId === tenantId)
  }
}

/** 上游 KvUnit 的最小形状(同 metering / subject / audit 的做法)。 */
export interface KvUnitLike {
  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }>
  putRecord(table: string, key: string, value: unknown): Promise<void>
}

export const INVOICE_TABLE = 'invoices'

/** 走上游 storage 契约的实现。 */
export class KvInvoiceStore implements InvoiceStore {
  private readonly unit: KvUnitLike

  constructor(unit: KvUnitLike) {
    this.unit = unit
  }

  async put(invoice: Invoice): Promise<void> {
    await this.unit.putRecord(INVOICE_TABLE, invoice.id, invoice)
  }

  async get(tenantId: string, invoiceId: string): Promise<Invoice | undefined> {
    const snapshot = await this.unit.loadAll()
    const found = (snapshot.tables[INVOICE_TABLE] ?? {})[invoiceId] as Invoice | undefined
    return found === undefined || found.tenantId !== tenantId ? undefined : found
  }

  async listByTenant(tenantId: string): Promise<Invoice[]> {
    const snapshot = await this.unit.loadAll()
    const table = snapshot.tables[INVOICE_TABLE] ?? {}
    return Object.values(table)
      .map((v) => v as Invoice)
      .filter((i) => i.tenantId === tenantId)
  }
}
