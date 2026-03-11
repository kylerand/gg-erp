import { TechnicianTaskState } from '../../../../../packages/domain/src/model/tickets.js';
import { TicketReworkIssueState } from '../../../../../packages/domain/src/model/tickets.js';
import type {
  CreateTechnicianTaskInput,
  TechnicianTaskService
} from './technicianTask.service.js';
import type { CreateReworkIssueInput, TicketReworkService } from './ticketRework.service.js';

export interface TicketRoutes {
  createTechnicianTask(
    input: CreateTechnicianTaskInput,
    correlationId: string,
    actorId?: string
  ): ReturnType<TechnicianTaskService['createTask']>;
  transitionTechnicianTask(
    taskId: string,
    nextState: TechnicianTaskState,
    correlationId: string,
    actorId?: string
  ): ReturnType<TechnicianTaskService['transitionTask']>;
  createReworkIssue(
    input: CreateReworkIssueInput,
    correlationId: string,
    actorId?: string
  ): ReturnType<TicketReworkService['createIssue']>;
  transitionReworkIssue(
    issueId: string,
    nextState: TicketReworkIssueState,
    correlationId: string,
    actorId?: string
  ): ReturnType<TicketReworkService['transitionIssue']>;
}

export function createTicketRoutes(
  technicianTaskService: TechnicianTaskService,
  ticketReworkService: TicketReworkService
): TicketRoutes {
  return {
    createTechnicianTask(input, correlationId, actorId) {
      return technicianTaskService.createTask(input, {
        correlationId,
        actorId,
        module: 'tickets'
      });
    },
    transitionTechnicianTask(taskId, nextState, correlationId, actorId) {
      return technicianTaskService.transitionTask(taskId, nextState, {
        correlationId,
        actorId,
        module: 'tickets'
      });
    },
    createReworkIssue(input, correlationId, actorId) {
      return ticketReworkService.createIssue(input, {
        correlationId,
        actorId,
        module: 'tickets'
      });
    },
    transitionReworkIssue(issueId, nextState, correlationId, actorId) {
      return ticketReworkService.transitionIssue(issueId, nextState, {
        correlationId,
        actorId,
        module: 'tickets'
      });
    }
  };
}
