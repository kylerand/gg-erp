export interface WorkerMetrics {
  increment(name: string, value?: number, tags?: Record<string, string>): void;
}

export const consoleWorkerMetrics: WorkerMetrics = {
  increment(name, value = 1, tags = {}) {
    console.info('metric', { name, value, tags });
  }
};
