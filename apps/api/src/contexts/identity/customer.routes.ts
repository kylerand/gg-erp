import { CustomerLifecycleState } from '../../../../../packages/domain/src/model/index.js';
import type { CreateCustomerInput, CustomerService } from './customer.service.js';

export interface CustomerRoutes {
  create(input: CreateCustomerInput, correlationId: string, actorId?: string): ReturnType<
    CustomerService['createCustomer']
  >;
  transitionState(
    customerId: string,
    nextState: CustomerLifecycleState,
    correlationId: string,
    actorId?: string
  ): ReturnType<CustomerService['transitionState']>;
  get(customerId: string): ReturnType<CustomerService['getCustomer']>;
}

export function createCustomerRoutes(service: CustomerService): CustomerRoutes {
  return {
    create(input, correlationId, actorId) {
      return service.createCustomer(input, { correlationId, actorId, module: 'identity' });
    },
    transitionState(customerId, nextState, correlationId, actorId) {
      return service.transitionState(customerId, nextState, {
        correlationId,
        actorId,
        module: 'identity'
      });
    },
    get(customerId) {
      return service.getCustomer(customerId);
    }
  };
}
