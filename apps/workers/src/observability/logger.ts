export interface WorkerLogger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export const consoleWorkerLogger: WorkerLogger = {
  info(message, context) {
    console.info(message, context ?? {});
  },
  error(message, context) {
    console.error(message, context ?? {});
  }
};
