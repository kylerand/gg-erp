import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { getMeHandler, identityQueries } from '../lambda/identity/handlers.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildEvent({
  actorUserId,
  actorRoles = [],
}: {
  actorUserId?: string;
  actorRoles?: string[];
} = {}) {
  const claims: Record<string, string> = {};
  if (actorUserId) claims.sub = actorUserId;
  if (actorRoles.length > 0) claims['cognito:groups'] = JSON.stringify(actorRoles);

  return {
    httpMethod: 'GET',
    headers: {},
    requestContext: {
      requestId: 'test-req-1',
      authorizer: {
        jwt: { claims: Object.keys(claims).length > 0 ? claims : undefined },
      },
    },
  };
}

function buildDbUser(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'user-uuid-1',
    cognitoSubject: 'cognito-sub-123',
    email: 'tech@example.com',
    displayName: 'Test Technician',
    status: 'ACTIVE' as const,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
    userRoles: [
      {
        id: 'ur-1',
        userId: 'user-uuid-1',
        roleId: 'role-uuid-1',
        assignmentStatus: 'ACTIVE' as const,
        effectiveFrom: now,
        effectiveTo: null,
        correlationId: 'seed',
        createdAt: now,
        updatedAt: now,
        version: 0,
        role: {
          id: 'role-uuid-1',
          roleCode: 'technician',
          roleName: 'Technician',
          description: null,
          isSystem: true,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 0,
          rolePermissions: [
            {
              roleId: 'role-uuid-1',
              permissionId: 'perm-uuid-1',
              grantedByUserId: null,
              correlationId: 'seed',
              requestId: null,
              createdAt: now,
              permission: {
                id: 'perm-uuid-1',
                permissionCode: 'work_orders:read',
                permissionName: 'Read Work Orders',
                description: null,
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
                version: 0,
              },
            },
            {
              roleId: 'role-uuid-1',
              permissionId: 'perm-uuid-2',
              grantedByUserId: null,
              correlationId: 'seed',
              requestId: null,
              createdAt: now,
              permission: {
                id: 'perm-uuid-2',
                permissionCode: 'work_orders:write',
                permissionName: 'Create/Modify Work Orders',
                description: null,
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
                version: 0,
              },
            },
          ],
        },
      },
    ],
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test('GET /auth/me returns 401 when no Authorization / actor is present', async () => {
  const response = await getMeHandler(buildEvent());

  assert.equal(response.statusCode, 401);
  const body = JSON.parse(response.body) as { message: string };
  assert.match(body.message, /[Aa]uthentication required/);
});

test('GET /auth/me returns 401 when actor user ID is empty string', async () => {
  const event = {
    httpMethod: 'GET',
    headers: { 'x-actor-id': '   ' },
    requestContext: { requestId: 'test-empty' },
  };

  const response = await getMeHandler(event);

  assert.equal(response.statusCode, 401);
});

test('GET /auth/me returns 404 when user is not found in DB', async () => {
  const findMock = mock.method(
    identityQueries,
    'findUserByCognitoSubject',
    async () => null,
  );

  try {
    const response = await getMeHandler(
      buildEvent({ actorUserId: 'cognito-sub-unknown' }),
    );

    assert.equal(response.statusCode, 404);
    assert.equal(findMock.mock.calls.length, 1);
    assert.equal(findMock.mock.calls[0]?.arguments[0], 'cognito-sub-unknown');

    const body = JSON.parse(response.body) as { message: string };
    assert.match(body.message, /not found/i);
  } finally {
    findMock.mock.restore();
  }
});

test('GET /auth/me returns user profile with roles and permissions', async () => {
  const dbUser = buildDbUser();
  const findMock = mock.method(
    identityQueries,
    'findUserByCognitoSubject',
    async () => dbUser,
  );

  try {
    const response = await getMeHandler(
      buildEvent({ actorUserId: 'cognito-sub-123', actorRoles: ['technician'] }),
    );

    assert.equal(response.statusCode, 200);
    assert.equal(findMock.mock.calls.length, 1);

    const body = JSON.parse(response.body) as {
      id: string;
      cognitoSubject: string;
      email: string;
      displayName: string;
      status: string;
      roles: Array<{
        code: string;
        name: string;
        permissions: Array<{ code: string; name: string }>;
      }>;
      permissions: string[];
    };

    assert.equal(body.id, 'user-uuid-1');
    assert.equal(body.cognitoSubject, 'cognito-sub-123');
    assert.equal(body.email, 'tech@example.com');
    assert.equal(body.displayName, 'Test Technician');
    assert.equal(body.status, 'ACTIVE');

    assert.equal(body.roles.length, 1);
    assert.equal(body.roles[0]?.code, 'technician');
    assert.equal(body.roles[0]?.name, 'Technician');
    assert.equal(body.roles[0]?.permissions.length, 2);

    assert.deepEqual(body.permissions, ['work_orders:read', 'work_orders:write']);
  } finally {
    findMock.mock.restore();
  }
});

test('GET /auth/me returns user with no roles when user has no active role assignments', async () => {
  const dbUser = buildDbUser({ userRoles: [] });
  const findMock = mock.method(
    identityQueries,
    'findUserByCognitoSubject',
    async () => dbUser,
  );

  try {
    const response = await getMeHandler(
      buildEvent({ actorUserId: 'cognito-sub-123' }),
    );

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      roles: unknown[];
      permissions: string[];
    };

    assert.deepEqual(body.roles, []);
    assert.deepEqual(body.permissions, []);
  } finally {
    findMock.mock.restore();
  }
});

test('GET /auth/me deduplicates permissions across multiple roles', async () => {
  const now = new Date();
  const sharedPerm = {
    roleId: 'role-uuid-2',
    permissionId: 'perm-uuid-1',
    grantedByUserId: null,
    correlationId: 'seed',
    requestId: null,
    createdAt: now,
    permission: {
      id: 'perm-uuid-1',
      permissionCode: 'work_orders:read',
      permissionName: 'Read Work Orders',
      description: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 0,
    },
  };

  const dbUser = buildDbUser({
    userRoles: [
      ...buildDbUser().userRoles,
      {
        id: 'ur-2',
        userId: 'user-uuid-1',
        roleId: 'role-uuid-2',
        assignmentStatus: 'ACTIVE' as const,
        effectiveFrom: now,
        effectiveTo: null,
        correlationId: 'seed',
        createdAt: now,
        updatedAt: now,
        version: 0,
        role: {
          id: 'role-uuid-2',
          roleCode: 'shop_manager',
          roleName: 'Shop Manager',
          description: null,
          isSystem: true,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 0,
          rolePermissions: [sharedPerm],
        },
      },
    ],
  });

  const findMock = mock.method(
    identityQueries,
    'findUserByCognitoSubject',
    async () => dbUser,
  );

  try {
    const response = await getMeHandler(
      buildEvent({ actorUserId: 'cognito-sub-123' }),
    );

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as { permissions: string[] };

    // work_orders:read appears in both roles but should only appear once
    const readCount = body.permissions.filter((p) => p === 'work_orders:read').length;
    assert.equal(readCount, 1);
  } finally {
    findMock.mock.restore();
  }
});
