import { wrapHandler, jsonResponse } from '../../shared/lambda/index.js';

/*
 * GET /identity/dealers
 *
 * No dedicated Dealer entity exists in the schema yet — dealer support is a
 * Phase 2 scope item. For now this returns an empty list so the UI shows
 * "0 dealers" instead of the prior mock fallback that surfaced fake data.
 * Replace with a real Prisma query once a Dealer model (or a `customer_type`
 * discriminator on Customer) lands.
 */
export const handler = wrapHandler(
  async () => jsonResponse(200, { items: [], total: 0 }),
  { requireAuth: false }
);
