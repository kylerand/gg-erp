import { PrismaClient } from '@prisma/client';
import { wrapHandler, jsonResponse } from '../../shared/lambda/index.js';

let identityPrisma: PrismaClient | undefined;

function getIdentityPrisma(): PrismaClient {
  identityPrisma ??= new PrismaClient();
  return identityPrisma;
}

// ─── Exported query object (mockable in tests) ─────────────────────────────

export const identityQueries = {
  async findUserByCognitoSubject(cognitoSubject: string) {
    return getIdentityPrisma().user.findUnique({
      where: { cognitoSubject },
      include: {
        userRoles: {
          where: { assignmentStatus: 'ACTIVE' },
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });
  },

  async listEmployees(filters?: { employmentState?: string }) {
    return getIdentityPrisma().employee.findMany({
      where: {
        deletedAt: null,
        ...(filters?.employmentState
          ? { employmentState: filters.employmentState as 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED' }
          : {}),
      },
      include: {
        skills: {
          where: { deletedAt: null },
          select: { skillCode: true },
        },
      },
      orderBy: [{ employmentState: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
    });
  },
};

// ─── Response types ─────────────────────────────────────────────────────────

interface MePermission {
  code: string;
  name: string;
}

interface MeRole {
  code: string;
  name: string;
  permissions: MePermission[];
}

interface MeResponse {
  id: string;
  cognitoSubject: string;
  email: string;
  displayName: string;
  status: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
  roles: MeRole[];
  permissions: string[];
}

// ─── GET /auth/me ───────────────────────────────────────────────────────────

export const getMeHandler = wrapHandler(
  async (ctx) => {
    const cognitoSubject = ctx.actorUserId;
    if (!cognitoSubject) {
      return jsonResponse(401, { message: 'Authentication required.' });
    }

    const user = await identityQueries.findUserByCognitoSubject(cognitoSubject);
    if (!user) {
      return jsonResponse(404, {
        message: 'User profile not found.',
      });
    }

    const roles: MeRole[] = user.userRoles.map((ur) => ({
      code: ur.role.roleCode,
      name: ur.role.roleName,
      permissions: ur.role.rolePermissions.map((rp) => ({
        code: rp.permission.permissionCode,
        name: rp.permission.permissionName,
      })),
    }));

    const allPermissions = new Set<string>();
    for (const role of roles) {
      for (const perm of role.permissions) {
        allPermissions.add(perm.code);
      }
    }

    const response: MeResponse = {
      id: user.id,
      cognitoSubject: user.cognitoSubject,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      lastLoginAt: user.lastLoginAt?.toISOString(),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      roles,
      permissions: [...allPermissions].sort(),
    };

    return jsonResponse(200, response);
  },
  { requireAuth: true },
);

// ─── GET /hr/employees ──────────────────────────────────────────────────────

export const listEmployeesHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const items = await identityQueries.listEmployees({ employmentState: qs.state ?? qs.employmentState });

  return jsonResponse(200, {
    items: items.map((e) => ({
      id: e.id,
      employeeNumber: e.employeeNumber,
      firstName: e.firstName,
      lastName: e.lastName,
      employmentState: e.employmentState,
      hireDate: e.hireDate.toISOString(),
      skills: e.skills.map((s) => s.skillCode),
    })),
    total: items.length,
  });
}, { requireAuth: false });
