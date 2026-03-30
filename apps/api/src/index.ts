import type { Permission } from '../../../packages/auth/src/permissions.js';
import type { RowScopeInput } from '../../../packages/auth/src/row-access.js';
import { scopeGrantKey, type ScopeTarget } from '../../../packages/auth/src/scope.js';
import { InMemoryAuditSink } from './audit/index.js';
import { ConsoleObservabilityHooks } from './observability/index.js';
import {
  InMemoryEventPublisher,
  InMemoryOutbox
} from './events/index.js';
import { BaselineAiProvider } from './contexts/ai/baselineAi.provider.js';
import { AiService } from './contexts/ai/ai.service.js';
import { createAiRoutes } from './contexts/ai/ai.routes.js';
import { CustomerService } from './contexts/identity/customer.service.js';
import { createCustomerRoutes } from './contexts/identity/customer.routes.js';
import { InMemoryAuthzRepository } from './contexts/identity/authz.repository.js';
import { AuthzService } from './contexts/identity/authz.service.js';
import { InMemoryInventoryRepository } from './contexts/inventory/inventory.repository.js';
import { InventoryService } from './contexts/inventory/inventory.service.js';
import { ProcurementService } from './contexts/inventory/procurement.service.js';
import { createInventoryRoutes } from './contexts/inventory/inventory.routes.js';
import { createProcurementRoutes } from './contexts/inventory/procurement.routes.js';
import { InMemoryWorkOrderRepository } from './contexts/build-planning/workOrder.repository.js';
import { WorkOrderService } from './contexts/build-planning/workOrder.service.js';
import { createWorkOrderRoutes } from './contexts/build-planning/workOrder.routes.js';
import { TechnicianTaskService } from './contexts/tickets/technicianTask.service.js';
import { TicketReworkService } from './contexts/tickets/ticketRework.service.js';
import { createTicketRoutes } from './contexts/tickets/ticket.routes.js';
import { createAttachmentRoutes } from './contexts/tickets/attachment.routes.js';
import { InvoiceSyncService, invoiceSyncQueries } from './contexts/accounting/invoiceSync.service.js';
import { createInvoiceSyncRoutes } from './contexts/accounting/invoiceSync.routes.js';
import { CustomerSyncService, customerSyncQueries } from './contexts/accounting/customerSync.service.js';
import { createCustomerSyncRoutes } from './contexts/accounting/customerSync.routes.js';
import { EntityMappingService } from './contexts/accounting/entityMapping.service.js';
import { PrismaClient } from '@prisma/client';
import {
  authorizePermission as createPermissionGuard,
  composeAuthorizationGuards,
  type AuthorizationFailure,
  type AuthorizationGuard,
  type AuthorizePermissionOptions
} from './middleware/authorize-permission.js';
import { requireScope as createScopeGuard, type RequireScopeOptions } from './middleware/require-scope.js';
import {
  createAuthzDeniedReporter,
  reportAuthzAllow
} from './middleware/authz-denial-reporter.js';
import {
  requireRowLevelAccess as createRowLevelGuard,
  type RequireRowLevelAccessOptions
} from './middleware/row-level-access.js';

export const apiName = 'gg-erp-api';

export interface ApiAuthorizationGuards {
  authorizePermission(permission: Permission, options?: AuthorizePermissionOptions): AuthorizationGuard;
  requireScope(scope: ScopeTarget, options?: RequireScopeOptions): AuthorizationGuard;
  requireRowLevelAccess(scope: RowScopeInput, options?: RequireRowLevelAccessOptions): AuthorizationGuard;
  compose(...guards: readonly AuthorizationGuard[]): AuthorizationGuard;
}

export interface ApiRuntime {
  routes: {
    customer: ReturnType<typeof createCustomerRoutes>;
    inventory: ReturnType<typeof createInventoryRoutes>;
    procurement: ReturnType<typeof createProcurementRoutes>;
    planning: ReturnType<typeof createWorkOrderRoutes>;
    tickets: ReturnType<typeof createTicketRoutes>;
    attachments: ReturnType<typeof createAttachmentRoutes>;
    invoiceSync: ReturnType<typeof createInvoiceSyncRoutes>;
    customerSync: ReturnType<typeof createCustomerSyncRoutes>;
    ai: ReturnType<typeof createAiRoutes>;
  };
  authz: {
    service: AuthzService;
    repository: InMemoryAuthzRepository;
    guards: ApiAuthorizationGuards;
  };
}

export function createApiRuntime(): ApiRuntime {
  const audit = new InMemoryAuditSink();
  const publisher = new InMemoryEventPublisher();
  const outbox = new InMemoryOutbox();
  const observability = ConsoleObservabilityHooks;

  const customerService = new CustomerService({
    audit,
    publisher,
    outbox,
    observability
  });
  const authzRepository = new InMemoryAuthzRepository();
  const authzService = new AuthzService({ repository: authzRepository });

  const inventoryRepository = new InMemoryInventoryRepository();
  const inventoryService = new InventoryService({
    repository: inventoryRepository,
    audit,
    publisher,
    outbox,
    observability
  });
  const procurementService = new ProcurementService({
    repository: inventoryRepository,
    audit,
    publisher,
    outbox,
    observability
  });

  const workOrderRepository = new InMemoryWorkOrderRepository();
  const workOrderService = new WorkOrderService({
    repository: workOrderRepository,
    audit,
    publisher,
    outbox,
    observability
  });

  const technicianTaskService = new TechnicianTaskService({
    audit,
    publisher,
    outbox,
    observability
  });
  const ticketReworkService = new TicketReworkService({
    audit,
    publisher,
    outbox,
    observability
  });

  const prisma = new PrismaClient();
  const entityMappingService = new EntityMappingService({ prisma });

  const invoiceSyncService = new InvoiceSyncService({
    audit,
    publisher,
    outbox,
    observability,
    queries: invoiceSyncQueries,
  });
  const customerSyncService = new CustomerSyncService({
    audit,
    publisher,
    outbox,
    observability,
    entityMapping: entityMappingService,
    queries: customerSyncQueries,
  });
  const aiProvider = new BaselineAiProvider();
  const aiService = new AiService({
    provider: aiProvider,
    audit,
    observability
  });
  const reportAuthzFailure = createAuthzDeniedReporter({
    audit,
    observability,
    module: 'identity'
  });

  const guards: ApiAuthorizationGuards = {
    authorizePermission(permission, options = {}) {
      return withAllowedHook(
        createPermissionGuard(permission, {
          ...options,
          onDenied: chainDeniedHooks(reportAuthzFailure, options.onDenied)
        }),
        (requestContext) => {
          reportAuthzAllow({
            audit,
            observability,
            requestContext,
            module: 'identity',
            check: 'permission',
            detail: permission
          });
        }
      );
    },
    requireScope(scope, options = {}) {
      return withAllowedHook(
        createScopeGuard(scope, {
          ...options,
          onDenied: chainDeniedHooks(reportAuthzFailure, options.onDenied),
          resolveScopes:
            options.resolveScopes ??
            (async ({ requestContext, principal }) => {
              if (requestContext.scopes.length > 0) {
                return requestContext.scopes;
              }

              const activeGrants = await authzService.listActiveRoleScopeGrantsForUser(principal.userId);
              return activeGrants.map((grant) => grant.scope);
            })
        }),
        (requestContext) => {
          reportAuthzAllow({
            audit,
            observability,
            requestContext,
            module: 'identity',
            check: 'scope',
            detail: scopeGrantKey(scope)
          });
        }
      );
    },
    requireRowLevelAccess(scope, options = {}) {
      return withAllowedHook(
        createRowLevelGuard(scope, {
          ...options,
          onDenied: chainDeniedHooks(reportAuthzFailure, options.onDenied)
        }),
        (requestContext) => {
          reportAuthzAllow({
            audit,
            observability,
            requestContext,
            module: 'identity',
            check: 'row',
            detail: rowScopeDetail(scope, options.minimumLevel)
          });
        }
      );
    },
    compose(...requestedGuards) {
      return composeAuthorizationGuards(...requestedGuards);
    }
  };

  return {
    routes: {
      customer: createCustomerRoutes(customerService),
      inventory: createInventoryRoutes(inventoryService),
      procurement: createProcurementRoutes(procurementService),
      planning: createWorkOrderRoutes(workOrderService),
      tickets: createTicketRoutes(technicianTaskService, ticketReworkService),
      attachments: createAttachmentRoutes({
        audit,
        publisher,
        outbox,
        observability
      }),
      invoiceSync: createInvoiceSyncRoutes(invoiceSyncService),
      customerSync: createCustomerSyncRoutes(customerSyncService),
      ai: createAiRoutes(aiService)
    },
    authz: {
      service: authzService,
      repository: authzRepository,
      guards
    }
  };
}

function withAllowedHook(
  guard: AuthorizationGuard,
  onAllowed: (requestContext: Parameters<AuthorizationGuard>[0]) => void
): AuthorizationGuard {
  return async (requestContext) => {
    await guard(requestContext);
    onAllowed(requestContext);
  };
}

function rowScopeDetail(scope: RowScopeInput, minimumLevel: 'org' | 'shop' | 'team' | undefined): string {
  const normalizedOrg = scope.orgId?.trim();
  const normalizedShop = scope.shopId?.trim();
  const normalizedTeam = scope.teamId?.trim();
  const level = minimumLevel ?? 'shop';

  if (level === 'team' || normalizedTeam) {
    return `team:${normalizedOrg ?? ''}:${normalizedShop ?? ''}:${normalizedTeam ?? ''}`;
  }

  if (level === 'shop' || normalizedShop) {
    return `shop:${normalizedOrg ?? ''}:${normalizedShop ?? ''}`;
  }

  return `org:${normalizedOrg ?? ''}`;
}

function chainDeniedHooks(
  defaultHook: (failure: AuthorizationFailure) => void,
  customHook?: (failure: AuthorizationFailure) => void
): (failure: AuthorizationFailure) => void {
  return (failure) => {
    defaultHook(failure);
    customHook?.(failure);
  };
}
