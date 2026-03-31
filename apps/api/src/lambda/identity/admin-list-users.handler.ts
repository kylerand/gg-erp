import { wrapHandler, jsonResponse } from '../../shared/lambda/index.js';
import { listUsers } from './admin-cognito.service.js';

export const adminListUsersHandler = wrapHandler(
  async () => {
    const users = await listUsers();
    return jsonResponse(200, { users });
  },
  { requireAuth: true, allowedRoles: ['admin'] },
);
