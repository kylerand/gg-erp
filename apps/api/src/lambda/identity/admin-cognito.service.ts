import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminEnableUserCommand,
  AdminDisableUserCommand,
  AdminDeleteUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminListGroupsForUserCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? '';
const client = new CognitoIdentityProviderClient({});

export interface AdminUser {
  username: string;
  email: string;
  name: string;
  status: string;
  enabled: boolean;
  groups: string[];
  createdAt: string;
  lastModified: string;
}

function attr(
  attrs: { Name?: string; Value?: string }[] | undefined,
  name: string,
): string {
  return attrs?.find((a) => a.Name === name)?.Value ?? '';
}

export async function listUsers(): Promise<AdminUser[]> {
  const users: AdminUser[] = [];
  let paginationToken: string | undefined;

  do {
    const res = await client.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Limit: 60,
        PaginationToken: paginationToken,
      }),
    );

    for (const u of res.Users ?? []) {
      const groupsRes = await client.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: u.Username!,
        }),
      );

      users.push({
        username: u.Username!,
        email: attr(u.Attributes, 'email'),
        name: attr(u.Attributes, 'name') || attr(u.Attributes, 'email'),
        status: u.UserStatus ?? 'UNKNOWN',
        enabled: u.Enabled ?? false,
        groups: (groupsRes.Groups ?? []).map((g) => g.GroupName!),
        createdAt: u.UserCreateDate?.toISOString() ?? '',
        lastModified: u.UserLastModifiedDate?.toISOString() ?? '',
      });
    }

    paginationToken = res.PaginationToken;
  } while (paginationToken);

  return users;
}

export interface CreateUserInput {
  email: string;
  name: string;
  temporaryPassword?: string;
  group?: string;
}

export async function createUser(input: CreateUserInput): Promise<AdminUser> {
  const res = await client.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: input.email,
      UserAttributes: [
        { Name: 'email', Value: input.email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: input.name },
      ],
      TemporaryPassword: input.temporaryPassword,
      DesiredDeliveryMediums: ['EMAIL'],
    }),
  );

  const username = res.User!.Username!;

  // If a permanent password was provided, set it
  if (input.temporaryPassword) {
    await client.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        Password: input.temporaryPassword,
        Permanent: true,
      }),
    );
  }

  if (input.group) {
    await client.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        GroupName: input.group,
      }),
    );
  }

  return {
    username,
    email: input.email,
    name: input.name,
    status: res.User!.UserStatus ?? 'FORCE_CHANGE_PASSWORD',
    enabled: res.User!.Enabled ?? true,
    groups: input.group ? [input.group] : [],
    createdAt: res.User!.UserCreateDate?.toISOString() ?? new Date().toISOString(),
    lastModified: res.User!.UserLastModifiedDate?.toISOString() ?? new Date().toISOString(),
  };
}

export interface UpdateUserInput {
  name?: string;
  enabled?: boolean;
  groups?: string[];
}

export async function updateUser(
  username: string,
  input: UpdateUserInput,
): Promise<AdminUser> {
  if (input.name !== undefined) {
    await client.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        UserAttributes: [{ Name: 'name', Value: input.name }],
      }),
    );
  }

  if (input.enabled === true) {
    await client.send(new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
  } else if (input.enabled === false) {
    await client.send(new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
  }

  if (input.groups !== undefined) {
    const currentGroups = await client.send(
      new AdminListGroupsForUserCommand({ UserPoolId: USER_POOL_ID, Username: username }),
    );
    const current = new Set((currentGroups.Groups ?? []).map((g) => g.GroupName!));
    const desired = new Set(input.groups);

    for (const g of current) {
      if (!desired.has(g)) {
        await client.send(
          new AdminRemoveUserFromGroupCommand({
            UserPoolId: USER_POOL_ID,
            Username: username,
            GroupName: g,
          }),
        );
      }
    }
    for (const g of desired) {
      if (!current.has(g)) {
        await client.send(
          new AdminAddUserToGroupCommand({
            UserPoolId: USER_POOL_ID,
            Username: username,
            GroupName: g,
          }),
        );
      }
    }
  }

  const userRes = await client.send(
    new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username }),
  );
  const groupsRes = await client.send(
    new AdminListGroupsForUserCommand({ UserPoolId: USER_POOL_ID, Username: username }),
  );

  return {
    username: userRes.Username!,
    email: attr(userRes.UserAttributes, 'email'),
    name: attr(userRes.UserAttributes, 'name') || attr(userRes.UserAttributes, 'email'),
    status: userRes.UserStatus ?? 'UNKNOWN',
    enabled: userRes.Enabled ?? false,
    groups: (groupsRes.Groups ?? []).map((g) => g.GroupName!),
    createdAt: userRes.UserCreateDate?.toISOString() ?? '',
    lastModified: userRes.UserLastModifiedDate?.toISOString() ?? '',
  };
}

export async function deleteUser(username: string): Promise<void> {
  await client.send(
    new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username }),
  );
}
