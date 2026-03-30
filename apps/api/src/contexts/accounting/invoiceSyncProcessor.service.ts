/**
 * Invoice sync processor — executes the actual QuickBooks invoice push.
 *
 * This is the "heavy lift" service that:
 *   1. Picks up PENDING InvoiceSyncRecords
 *   2. Loads work order + line items from DB
 *   3. Resolves the QB customer (via entity mapping or creates one)
 *   4. Assembles the QB invoice payload
 *   5. Calls QB API to create the invoice
 *   6. Updates the sync record to SYNCED or FAILED
 *
 * Called by the trigger-sync Lambda or the worker polling loop.
 */
import { PrismaClient } from '@prisma/client';
import { QuickBooksClient, type QbTokens } from './quickbooks.client.js';
import type { EntityMappingService } from './entityMapping.service.js';

export interface InvoiceSyncProcessorDeps {
  prisma: PrismaClient;
  entityMapping: EntityMappingService;
}

export interface ProcessResult {
  recordId: string;
  invoiceNumber: string;
  outcome: 'synced' | 'failed' | 'skipped';
  qbInvoiceId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export class InvoiceSyncProcessor {
  constructor(private readonly deps: InvoiceSyncProcessorDeps) {}

  /**
   * Process a single PENDING InvoiceSyncRecord — push to QuickBooks.
   */
  async processRecord(
    recordId: string,
    integrationAccountId: string,
    tokens: QbTokens
  ): Promise<ProcessResult> {
    const { prisma, entityMapping } = this.deps;

    const record = await prisma.invoiceSyncRecord.findUnique({ where: { id: recordId } });
    if (!record) {
      return { recordId, invoiceNumber: '', outcome: 'skipped', errorMessage: 'Record not found' };
    }
    if (record.state !== 'PENDING' && record.state !== 'FAILED') {
      return {
        recordId,
        invoiceNumber: record.invoiceNumber,
        outcome: 'skipped',
        errorMessage: `Record in ${record.state} state`,
      };
    }

    // Transition → IN_PROGRESS
    await prisma.invoiceSyncRecord.update({
      where: { id: recordId },
      data: {
        state: 'IN_PROGRESS',
        attemptCount: { increment: 1 },
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: new Date(),
      },
    });

    try {
      // Load work order + parts
      const workOrder = await prisma.woOrder.findUnique({
        where: { id: record.workOrderId },
      });
      if (!workOrder) {
        throw new Error(`Work order not found: ${record.workOrderId}`);
      }

      // Load part lines for the work order with part details
      const partLines = await prisma.woPartLine.findMany({
        where: { workOrderId: record.workOrderId },
        include: { part: true },
      });

      // Resolve or create QB customer
      const client = new QuickBooksClient(tokens);

      const customerReference = workOrder.customerReference;
      let qbCustomerRef: string;

      if (customerReference) {
        // Try to find a customer by reference
        const customer = await prisma.customer.findFirst({
          where: { externalReference: customerReference },
        });

        if (customer) {
          // Look up existing mapping
          const existingQbId = await entityMapping.findExternalId(
            integrationAccountId,
            'Customer',
            customer.id
          );

          if (existingQbId) {
            qbCustomerRef = existingQbId;
          } else {
            const displayName = customer.companyName ?? customer.fullName;
            const found = await client.findCustomer(displayName);
            if (found) {
              qbCustomerRef = found.id;
            } else {
              const created = await client.createCustomer(
                displayName,
                customer.email
              );
              qbCustomerRef = created.qbCustomerId;
            }

            await entityMapping.upsertMapping(
              integrationAccountId,
              'Customer',
              customer.id,
              qbCustomerRef
            );
          }
        } else {
          // No customer record found — try QB lookup by reference string
          const found = await client.findCustomer(customerReference);
          qbCustomerRef = found?.id ?? '1';
        }
      } else {
        // No customer on work order — use a default "Walk-in" customer ref
        qbCustomerRef = '1'; // QB default customer; configure per tenant
      }

      // Assemble invoice lines from work order parts
      const invoiceLines = partLines.map((line) => ({
        description: line.part?.name ?? `Part ${line.partId}`,
        amount: Number(line.consumedQuantity) * Number(line.part?.reorderPoint ?? 0),
        quantity: Number(line.consumedQuantity),
        unitPrice: Number(line.part?.reorderPoint ?? 0),
      }));

      // If no part lines, create a single summary line
      if (invoiceLines.length === 0) {
        invoiceLines.push({
          description: `Work Order ${workOrder.workOrderNumber}`,
          amount: 0,
          quantity: 1,
          unitPrice: 0,
        });
      }

      // Create invoice in QB
      const qbResult = await client.createInvoice({
        customerRef: qbCustomerRef,
        lines: invoiceLines,
        docNumber: record.invoiceNumber,
      });

      // Store invoice mapping
      await entityMapping.upsertMapping(
        integrationAccountId,
        'Invoice',
        record.id,
        qbResult.qbInvoiceId
      );

      // Transition → SYNCED
      await prisma.invoiceSyncRecord.update({
        where: { id: recordId },
        data: {
          state: 'SYNCED',
          externalReference: qbResult.qbInvoiceId,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return {
        recordId,
        invoiceNumber: record.invoiceNumber,
        outcome: 'synced',
        qbInvoiceId: qbResult.qbInvoiceId,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const errorCode = errorMessage.startsWith('QB_') ? errorMessage.split(':')[0] : 'SYNC_ERROR';

      // Transition → FAILED
      await prisma.invoiceSyncRecord.update({
        where: { id: recordId },
        data: {
          state: 'FAILED',
          lastErrorCode: errorCode,
          lastErrorMessage: errorMessage.slice(0, 1000),
          updatedAt: new Date(),
        },
      });

      return {
        recordId,
        invoiceNumber: record.invoiceNumber,
        outcome: 'failed',
        errorCode,
        errorMessage,
      };
    }
  }

  /**
   * Process all PENDING records in a batch. Called by the scheduled Lambda.
   */
  async processPendingBatch(
    integrationAccountId: string,
    tokens: QbTokens,
    batchSize = 25
  ): Promise<ProcessResult[]> {
    const pending = await this.deps.prisma.invoiceSyncRecord.findMany({
      where: { state: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    const results: ProcessResult[] = [];
    for (const record of pending) {
      const result = await this.processRecord(record.id, integrationAccountId, tokens);
      results.push(result);
    }

    return results;
  }
}
