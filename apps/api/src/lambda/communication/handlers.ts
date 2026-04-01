import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  wrapHandler,
  parseBody,
  jsonResponse,
} from '../../shared/lambda/index.js';

const prisma = new PrismaClient();

// ─── List Channels ────────────────────────────────────────────────────────────

export const listChannelsHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const type = qs.type as string | undefined;
  const userId = ctx.actorUserId;

  const where = {
    archivedAt: null,
    ...(type ? { type: type as 'TEAM' | 'WORK_ORDER' | 'CUSTOMER' | 'DIRECT' } : {}),
    ...(userId ? { members: { some: { userId } } } : {}),
  };

  const channels = await prisma.channel.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: {
      members: { select: { userId: true, role: true, lastReadAt: true } },
      _count: { select: { messages: true, todos: true } },
    },
  });

  const items = channels.map((ch) => {
    const myMembership = userId
      ? ch.members.find((m) => m.userId === userId)
      : null;
    const unreadCount =
      myMembership?.lastReadAt
        ? 0 // real unread count computed below
        : ch._count.messages;
    return {
      id: ch.id,
      name: ch.name,
      type: ch.type,
      description: ch.description,
      entityId: ch.entityId,
      memberCount: ch.members.length,
      messageCount: ch._count.messages,
      todoCount: ch._count.todos,
      unreadCount,
      createdAt: ch.createdAt.toISOString(),
      updatedAt: ch.updatedAt.toISOString(),
    };
  });

  // Compute real unread counts where lastReadAt exists
  if (userId) {
    for (const item of items) {
      const membership = channels
        .find((c) => c.id === item.id)
        ?.members.find((m) => m.userId === userId);
      if (membership?.lastReadAt) {
        const unread = await prisma.message.count({
          where: {
            channelId: item.id,
            createdAt: { gt: membership.lastReadAt },
            deletedAt: null,
          },
        });
        item.unreadCount = unread;
      }
    }
  }

  return jsonResponse(200, { items });
}, { requireAuth: true });

// ─── Create Channel ───────────────────────────────────────────────────────────

interface CreateChannelBody {
  name: string;
  type: 'TEAM' | 'WORK_ORDER' | 'CUSTOMER' | 'DIRECT';
  description?: string;
  entityId?: string;
  memberUserIds?: string[];
}

export const createChannelHandler = wrapHandler(async (ctx) => {
  const body = parseBody<CreateChannelBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { name, type, description, entityId, memberUserIds = [] } = body.value;
  if (!name?.trim()) return jsonResponse(422, { message: 'name is required.' });
  if (!type) return jsonResponse(422, { message: 'type is required.' });

  const validTypes = ['TEAM', 'WORK_ORDER', 'CUSTOMER', 'DIRECT'];
  if (!validTypes.includes(type)) {
    return jsonResponse(422, { message: `type must be one of: ${validTypes.join(', ')}` });
  }

  const creatorId = ctx.actorUserId ?? randomUUID();
  const channelId = randomUUID();
  const now = new Date();

  // Build member list — always include creator as OWNER
  const allMemberIds = new Set([creatorId, ...memberUserIds]);
  const memberData = [...allMemberIds].map((uid) => ({
    id: randomUUID(),
    userId: uid,
    role: uid === creatorId ? 'OWNER' as const : 'MEMBER' as const,
    joinedAt: now,
  }));

  const channel = await prisma.channel.create({
    data: {
      id: channelId,
      name: name.trim(),
      type,
      description: description?.trim() ?? null,
      entityId: entityId ?? null,
      createdBy: creatorId,
      createdAt: now,
      updatedAt: now,
      members: { createMany: { data: memberData } },
    },
    include: {
      members: { select: { userId: true, role: true } },
    },
  });

  return jsonResponse(201, {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    description: channel.description,
    entityId: channel.entityId,
    members: channel.members,
    createdAt: channel.createdAt.toISOString(),
  });
}, { requireAuth: true });

// ─── List Messages ────────────────────────────────────────────────────────────

export const listMessagesHandler = wrapHandler(async (ctx) => {
  const channelId = ctx.event.pathParameters?.channelId;
  if (!channelId) return jsonResponse(400, { message: 'Channel ID is required.' });

  const qs = ctx.event.queryStringParameters ?? {};
  const limit = Math.min(parseInt(qs.limit ?? '50', 10), 100);
  const before = qs.before; // cursor: ISO date

  const where = {
    channelId,
    deletedAt: null,
    parentId: null, // top-level messages only
    ...(before ? { createdAt: { lt: new Date(before) } } : {}),
  };

  const messages = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      attachments: { select: { id: true, fileAttachmentId: true } },
      reactions: { select: { id: true, userId: true, emoji: true } },
      _count: { select: { replies: true } },
    },
  });

  // Mark channel as read for the current user
  const userId = ctx.actorUserId;
  if (userId) {
    await prisma.channelMember.updateMany({
      where: { channelId, userId },
      data: { lastReadAt: new Date() },
    });
  }

  const items = messages.map((m) => ({
    id: m.id,
    channelId: m.channelId,
    authorId: m.authorId,
    content: m.content,
    parentId: m.parentId,
    replyCount: m._count.replies,
    attachments: m.attachments,
    reactions: groupReactions(m.reactions),
    editedAt: m.editedAt?.toISOString(),
    createdAt: m.createdAt.toISOString(),
  }));

  return jsonResponse(200, { items, hasMore: items.length === limit });
}, { requireAuth: true });

// ─── List Replies (thread) ────────────────────────────────────────────────────

export const listRepliesHandler = wrapHandler(async (ctx) => {
  const messageId = ctx.event.pathParameters?.messageId;
  if (!messageId) return jsonResponse(400, { message: 'Message ID is required.' });

  const replies = await prisma.message.findMany({
    where: { parentId: messageId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    include: {
      attachments: { select: { id: true, fileAttachmentId: true } },
      reactions: { select: { id: true, userId: true, emoji: true } },
    },
  });

  return jsonResponse(200, {
    items: replies.map((m) => ({
      id: m.id,
      channelId: m.channelId,
      authorId: m.authorId,
      content: m.content,
      parentId: m.parentId,
      attachments: m.attachments,
      reactions: groupReactions(m.reactions),
      editedAt: m.editedAt?.toISOString(),
      createdAt: m.createdAt.toISOString(),
    })),
  });
}, { requireAuth: true });

// ─── Send Message ─────────────────────────────────────────────────────────────

interface SendMessageBody {
  content: string;
  parentId?: string;
  attachmentIds?: string[];
}

export const sendMessageHandler = wrapHandler(async (ctx) => {
  const channelId = ctx.event.pathParameters?.channelId;
  if (!channelId) return jsonResponse(400, { message: 'Channel ID is required.' });

  const body = parseBody<SendMessageBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { content, parentId, attachmentIds = [] } = body.value;
  if (!content?.trim()) return jsonResponse(422, { message: 'content is required.' });

  const authorId = ctx.actorUserId;
  if (!authorId) return jsonResponse(401, { message: 'Authentication required.' });

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return jsonResponse(404, { message: 'Channel not found.' });

  const messageId = randomUUID();
  const now = new Date();

  const message = await prisma.message.create({
    data: {
      id: messageId,
      channelId,
      authorId,
      content: content.trim(),
      parentId: parentId ?? null,
      createdAt: now,
      ...(attachmentIds.length > 0
        ? {
            attachments: {
              createMany: {
                data: attachmentIds.map((fId) => ({
                  id: randomUUID(),
                  fileAttachmentId: fId,
                })),
              },
            },
          }
        : {}),
    },
    include: {
      attachments: { select: { id: true, fileAttachmentId: true } },
    },
  });

  // Bump channel updatedAt
  await prisma.channel.update({
    where: { id: channelId },
    data: { updatedAt: now },
  });

  return jsonResponse(201, {
    id: message.id,
    channelId: message.channelId,
    authorId: message.authorId,
    content: message.content,
    parentId: message.parentId,
    attachments: message.attachments,
    createdAt: message.createdAt.toISOString(),
  });
}, { requireAuth: true });

// ─── Edit Message ─────────────────────────────────────────────────────────────

export const editMessageHandler = wrapHandler(async (ctx) => {
  const messageId = ctx.event.pathParameters?.messageId;
  if (!messageId) return jsonResponse(400, { message: 'Message ID is required.' });

  const body = parseBody<{ content: string }>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { content } = body.value;
  if (!content?.trim()) return jsonResponse(422, { message: 'content is required.' });

  const existing = await prisma.message.findUnique({ where: { id: messageId } });
  if (!existing || existing.deletedAt) return jsonResponse(404, { message: 'Message not found.' });

  if (ctx.actorUserId && existing.authorId !== ctx.actorUserId) {
    return jsonResponse(403, { message: 'You can only edit your own messages.' });
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { content: content.trim(), editedAt: new Date() },
  });

  return jsonResponse(200, {
    id: updated.id,
    content: updated.content,
    editedAt: updated.editedAt?.toISOString(),
  });
}, { requireAuth: true });

// ─── Delete Message ───────────────────────────────────────────────────────────

export const deleteMessageHandler = wrapHandler(async (ctx) => {
  const messageId = ctx.event.pathParameters?.messageId;
  if (!messageId) return jsonResponse(400, { message: 'Message ID is required.' });

  const existing = await prisma.message.findUnique({ where: { id: messageId } });
  if (!existing || existing.deletedAt) return jsonResponse(404, { message: 'Message not found.' });

  if (ctx.actorUserId && existing.authorId !== ctx.actorUserId) {
    const isAdmin = ctx.actorRoles.includes('admin');
    if (!isAdmin) return jsonResponse(403, { message: 'You can only delete your own messages.' });
  }

  await prisma.message.update({
    where: { id: messageId },
    data: { deletedAt: new Date() },
  });

  return jsonResponse(200, { deleted: true });
}, { requireAuth: true });

// ─── Add Reaction ─────────────────────────────────────────────────────────────

export const addReactionHandler = wrapHandler(async (ctx) => {
  const messageId = ctx.event.pathParameters?.messageId;
  if (!messageId) return jsonResponse(400, { message: 'Message ID is required.' });

  const body = parseBody<{ emoji: string }>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { emoji } = body.value;
  if (!emoji?.trim()) return jsonResponse(422, { message: 'emoji is required.' });

  const userId = ctx.actorUserId;
  if (!userId) return jsonResponse(401, { message: 'Authentication required.' });

  // Upsert to avoid duplicates
  await prisma.messageReaction.upsert({
    where: {
      messageId_userId_emoji: { messageId, userId, emoji: emoji.trim() },
    },
    create: { id: randomUUID(), messageId, userId, emoji: emoji.trim() },
    update: {},
  });

  return jsonResponse(201, { messageId, emoji: emoji.trim() });
}, { requireAuth: true });

// ─── Remove Reaction ──────────────────────────────────────────────────────────

export const removeReactionHandler = wrapHandler(async (ctx) => {
  const messageId = ctx.event.pathParameters?.messageId;
  if (!messageId) return jsonResponse(400, { message: 'Message ID is required.' });

  const emoji = ctx.event.pathParameters?.emoji ?? ctx.event.queryStringParameters?.emoji;
  if (!emoji) return jsonResponse(400, { message: 'emoji is required.' });

  const userId = ctx.actorUserId;
  if (!userId) return jsonResponse(401, { message: 'Authentication required.' });

  await prisma.messageReaction.deleteMany({
    where: { messageId, userId, emoji },
  });

  return jsonResponse(200, { removed: true });
}, { requireAuth: true });

// ─── List Channel Todos ───────────────────────────────────────────────────────

export const listTodosHandler = wrapHandler(async (ctx) => {
  const channelId = ctx.event.pathParameters?.channelId;
  if (!channelId) return jsonResponse(400, { message: 'Channel ID is required.' });

  const qs = ctx.event.queryStringParameters ?? {};
  const status = qs.status as 'OPEN' | 'DONE' | undefined;

  const todos = await prisma.channelTodo.findMany({
    where: { channelId, ...(status ? { status } : {}) },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });

  return jsonResponse(200, {
    items: todos.map((t) => ({
      id: t.id,
      channelId: t.channelId,
      title: t.title,
      status: t.status,
      assigneeId: t.assigneeId,
      dueDate: t.dueDate?.toISOString().split('T')[0],
      createdBy: t.createdBy,
      createdAt: t.createdAt.toISOString(),
    })),
  });
}, { requireAuth: true });

// ─── Create Channel Todo ──────────────────────────────────────────────────────

interface CreateTodoBody {
  title: string;
  assigneeId?: string;
  dueDate?: string;
}

export const createTodoHandler = wrapHandler(async (ctx) => {
  const channelId = ctx.event.pathParameters?.channelId;
  if (!channelId) return jsonResponse(400, { message: 'Channel ID is required.' });

  const body = parseBody<CreateTodoBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { title, assigneeId, dueDate } = body.value;
  if (!title?.trim()) return jsonResponse(422, { message: 'title is required.' });

  const createdBy = ctx.actorUserId;
  if (!createdBy) return jsonResponse(401, { message: 'Authentication required.' });

  const todo = await prisma.channelTodo.create({
    data: {
      id: randomUUID(),
      channelId,
      title: title.trim(),
      status: 'OPEN',
      assigneeId: assigneeId ?? null,
      dueDate: dueDate ? new Date(dueDate) : null,
      createdBy,
    },
  });

  return jsonResponse(201, {
    id: todo.id,
    channelId: todo.channelId,
    title: todo.title,
    status: todo.status,
    assigneeId: todo.assigneeId,
    dueDate: todo.dueDate?.toISOString().split('T')[0],
    createdBy: todo.createdBy,
    createdAt: todo.createdAt.toISOString(),
  });
}, { requireAuth: true });

// ─── Update Channel Todo ──────────────────────────────────────────────────────

interface UpdateTodoBody {
  title?: string;
  status?: 'OPEN' | 'DONE';
  assigneeId?: string | null;
  dueDate?: string | null;
}

export const updateTodoHandler = wrapHandler(async (ctx) => {
  const todoId = ctx.event.pathParameters?.todoId;
  if (!todoId) return jsonResponse(400, { message: 'Todo ID is required.' });

  const body = parseBody<UpdateTodoBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const existing = await prisma.channelTodo.findUnique({ where: { id: todoId } });
  if (!existing) return jsonResponse(404, { message: 'Todo not found.' });

  const { title, status, assigneeId, dueDate } = body.value;

  const updated = await prisma.channelTodo.update({
    where: { id: todoId },
    data: {
      ...(title !== undefined ? { title: title.trim() } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(assigneeId !== undefined ? { assigneeId } : {}),
      ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
      updatedAt: new Date(),
    },
  });

  return jsonResponse(200, {
    id: updated.id,
    channelId: updated.channelId,
    title: updated.title,
    status: updated.status,
    assigneeId: updated.assigneeId,
    dueDate: updated.dueDate?.toISOString().split('T')[0],
    createdBy: updated.createdBy,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
}, { requireAuth: true });

// ─── List Notifications ───────────────────────────────────────────────────────

export const listNotificationsHandler = wrapHandler(async (ctx) => {
  const userId = ctx.actorUserId;
  if (!userId) return jsonResponse(401, { message: 'Authentication required.' });

  const qs = ctx.event.queryStringParameters ?? {};
  const limit = Math.min(parseInt(qs.limit ?? '30', 10), 100);
  const unreadOnly = qs.unreadOnly === 'true';

  const where = {
    userId,
    ...(unreadOnly ? { readAt: null } : {}),
  };

  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  return jsonResponse(200, {
    items: items.map((n) => ({
      id: n.id,
      type: n.type,
      referenceType: n.referenceType,
      referenceId: n.referenceId,
      title: n.title,
      body: n.body,
      read: !!n.readAt,
      createdAt: n.createdAt.toISOString(),
    })),
    unreadCount,
  });
}, { requireAuth: true });

// ─── Mark Notifications Read ──────────────────────────────────────────────────

export const markNotificationsReadHandler = wrapHandler(async (ctx) => {
  const userId = ctx.actorUserId;
  if (!userId) return jsonResponse(401, { message: 'Authentication required.' });

  const body = parseBody<{ ids?: string[] }>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { ids } = body.value;
  const now = new Date();

  if (ids && ids.length > 0) {
    await prisma.notification.updateMany({
      where: { id: { in: ids }, userId, readAt: null },
      data: { readAt: now },
    });
  } else {
    // Mark all unread as read
    await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: now },
    });
  }

  return jsonResponse(200, { success: true });
}, { requireAuth: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupReactions(reactions: { id: string; userId: string; emoji: string }[]) {
  const map = new Map<string, string[]>();
  for (const r of reactions) {
    const users = map.get(r.emoji) ?? [];
    users.push(r.userId);
    map.set(r.emoji, users);
  }
  return [...map.entries()].map(([emoji, userIds]) => ({ emoji, count: userIds.length, userIds }));
}
