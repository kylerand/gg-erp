import { handle } from './run-migration.handler.js';

export const handler = async (event: Record<string, unknown>) => {
  return handle(event as Parameters<typeof handle>[0]);
};
