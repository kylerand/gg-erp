import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';

const prisma = new PrismaClient();
const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
const DOCUMENT_BUCKET = process.env.DOCUMENT_BUCKET_NAME ?? 'gg-erp-dev-documents';
const PRESIGN_TTL_SECONDS = 3600;
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

// ─── Request presigned upload URL ─────────────────────────────────────────────

interface PresignUploadBody {
  entityType: string;
  entityId: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
}

export const presignUploadHandler = wrapHandler(async (ctx) => {
  const body = parseBody<PresignUploadBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { entityType, entityId, fileName, mimeType, sizeBytes } = body.value;
  if (!entityType?.trim()) return jsonResponse(422, { message: 'entityType is required.' });
  if (!entityId?.trim()) return jsonResponse(422, { message: 'entityId is required.' });
  if (!fileName?.trim()) return jsonResponse(422, { message: 'fileName is required.' });
  if (!mimeType?.trim()) return jsonResponse(422, { message: 'mimeType is required.' });

  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const s3Key = `attachments/${entityType}/${entityId}/${randomUUID()}/${safeFileName}`;

  const command = new PutObjectCommand({
    Bucket: DOCUMENT_BUCKET,
    Key: s3Key,
    ContentType: mimeType,
    ...(sizeBytes ? { ContentLength: sizeBytes } : {}),
    Metadata: {
      'entity-type': entityType,
      'entity-id': entityId,
      'uploaded-by': ctx.actorUserId ?? SYSTEM_USER_ID,
      'correlation-id': ctx.correlationId,
    },
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: PRESIGN_TTL_SECONDS });

  const attachment = await prisma.fileAttachment.create({
    data: {
      id: randomUUID(),
      entityType,
      entityId,
      fileName: safeFileName,
      mimeType,
      sizeBytes: sizeBytes ?? 0,
      s3Key,
      s3Bucket: DOCUMENT_BUCKET,
      uploadedBy: ctx.actorUserId ?? SYSTEM_USER_ID,
      correlationId: ctx.correlationId,
    },
  });

  return jsonResponse(200, {
    attachmentId: attachment.id,
    uploadUrl,
    s3Key,
    expiresIn: PRESIGN_TTL_SECONDS,
  });
}, { requireAuth: false });

// ─── Confirm upload complete (no-op for now; S3 event-driven confirmation is optional) ──

export const confirmUploadHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Attachment ID is required.' });

  const attachment = await prisma.fileAttachment.findUnique({ where: { id } });
  if (!attachment) return jsonResponse(404, { message: `Attachment not found: ${id}` });
  if (attachment.deletedAt) return jsonResponse(410, { message: 'Attachment has been deleted.' });

  return jsonResponse(200, { attachment: toAttachmentResponse(attachment) });
}, { requireAuth: false });

// ─── List attachments for an entity ───────────────────────────────────────────

export const listAttachmentsHandler = wrapHandler(async (ctx) => {
  const { entityType, entityId } = ctx.event.queryStringParameters ?? {};
  if (!entityType || !entityId) {
    return jsonResponse(400, { message: 'entityType and entityId query params are required.' });
  }

  const items = await prisma.fileAttachment.findMany({
    where: { entityType, entityId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return jsonResponse(200, { items: items.map(toAttachmentResponse) });
}, { requireAuth: false });

// ─── Get presigned download URL ────────────────────────────────────────────────

export const presignDownloadHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Attachment ID is required.' });

  const attachment = await prisma.fileAttachment.findUnique({ where: { id } });
  if (!attachment) return jsonResponse(404, { message: `Attachment not found: ${id}` });
  if (attachment.deletedAt) return jsonResponse(410, { message: 'Attachment has been deleted.' });

  const command = new GetObjectCommand({
    Bucket: attachment.s3Bucket,
    Key: attachment.s3Key,
    ResponseContentDisposition: `attachment; filename="${attachment.fileName}"`,
  });

  const downloadUrl = await getSignedUrl(s3, command, { expiresIn: PRESIGN_TTL_SECONDS });

  return jsonResponse(200, {
    downloadUrl,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    expiresIn: PRESIGN_TTL_SECONDS,
  });
}, { requireAuth: false });

// ─── Response mapper ──────────────────────────────────────────────────────────

function toAttachmentResponse(r: {
  id: string; entityType: string; entityId: string; fileName: string;
  mimeType: string; sizeBytes: number; s3Key: string; s3Bucket: string;
  uploadedBy: string; createdAt: Date; deletedAt: Date | null;
}) {
  return {
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    fileName: r.fileName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    s3Key: r.s3Key,
    uploadedBy: r.uploadedBy,
    createdAt: r.createdAt.toISOString(),
    deleted: r.deletedAt !== null,
  };
}
