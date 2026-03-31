import { wrapHandler, jsonResponse } from '../../shared/lambda/index.js';
import { deleteUser } from './admin-cognito.service.js';

export const adminDeleteUserHandler = wrapHandler(
  async (ctx) => {
    const username = ctx.event.pathParameters?.username;
    if (!username) return jsonResponse(400, { message: 'username path parameter is required.' });

    await deleteUser(decodeURIComponent(username));
    return jsonResponse(200, { message: 'User deleted.' });
  },
  { requireAuth: true, allowedRoles: ['admin'] },
);
