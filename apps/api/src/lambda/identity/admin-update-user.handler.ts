import { wrapHandler, jsonResponse, parseBody } from '../../shared/lambda/index.js';
import { updateUser, type UpdateUserInput } from './admin-cognito.service.js';

export const adminUpdateUserHandler = wrapHandler(
  async (ctx) => {
    const username = ctx.event.pathParameters?.username;
    if (!username) return jsonResponse(400, { message: 'username path parameter is required.' });

    const body = parseBody<UpdateUserInput>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const user = await updateUser(decodeURIComponent(username), body.value);
    return jsonResponse(200, { user });
  },
  { requireAuth: true, allowedRoles: ['admin'] },
);
