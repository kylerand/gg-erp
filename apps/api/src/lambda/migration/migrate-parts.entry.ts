import { handle } from './migrate-parts.handler.js';

export const handler = async (event: Record<string, unknown>) => {
  return handle(event as unknown as Parameters<typeof handle>[0]);
};
