export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiOperation {
  method: HttpMethod;
  path: string;
  summary: string;
}

export interface RequiredIndex {
  name: string;
  fields: readonly string[];
  unique?: boolean;
  where?: string;
}

export interface StateTransition<TState extends string> {
  from: TState | 'ANY';
  to: TState;
  rule: string;
}

export interface LifecycleDefinition<TState extends string> {
  initial: TState;
  terminal: readonly TState[];
  transitions: readonly StateTransition<TState>[];
}

export interface EntityDesign<TState extends string> {
  entity: string;
  purpose: string;
  keyFields: readonly string[];
  requiredIndexes: readonly RequiredIndex[];
  lifecycle: LifecycleDefinition<TState>;
  businessRules: readonly string[];
  emittedEvents: readonly string[];
  apiOperations: readonly ApiOperation[];
}

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class InvariantViolationError extends DomainError {
  constructor(message: string) {
    super('INVARIANT_VIOLATION', message);
    this.name = 'InvariantViolationError';
  }
}

export class TransitionError extends DomainError {
  constructor(message: string) {
    super('INVALID_TRANSITION', message);
    this.name = 'TransitionError';
  }
}

export function assertTransitionAllowed<TState extends string>(
  current: TState,
  next: TState,
  lifecycle: LifecycleDefinition<TState>
): void {
  const allowed = lifecycle.transitions.some(
    (transition) =>
      (transition.from === 'ANY' || transition.from === current) &&
      transition.to === next
  );

  if (!allowed) {
    throw new TransitionError(`Transition ${current} -> ${next} is not allowed`);
  }
}
