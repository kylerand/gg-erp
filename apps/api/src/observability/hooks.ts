export interface ObservabilityContext {
  correlationId: string;
  actorId?: string;
  module: string;
}

export interface ObservabilityHooks {
  logInfo(message: string, context: ObservabilityContext): void;
  logError(message: string, context: ObservabilityContext): void;
  metric(name: string, value: number, context: ObservabilityContext): void;
  trace(operation: string, context: ObservabilityContext): void;
}

export const ConsoleObservabilityHooks: ObservabilityHooks = {
  logInfo(message, context) {
    console.info(message, context);
  },
  logError(message, context) {
    console.error(message, context);
  },
  metric(name, value, context) {
    console.info('metric', { name, value, ...context });
  },
  trace(operation, context) {
    console.info('trace', { operation, ...context });
  }
};
