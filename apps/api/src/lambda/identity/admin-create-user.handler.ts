import { wrapHandler, jsonResponse, parseBody } from '../../shared/lambda/index.js';
import { createUser, type CreateUserInput } from './admin-cognito.service.js';

export const adminCreateUserHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<CreateUserInput>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const { email, name, temporaryPassword, group } = body.value;
    if (!email || !name) {
      return jsonResponse(400, { message: 'email and name are required.' });
    }

    const user = await createUser({ email, name, temporaryPassword, group });
    return jsonResponse(201, { user });
  },
  { requireAuth: true, allowedRoles: ['admin'] },
);
