import type {
  PrismaClient,
  TechnicianTask as PrismaTechnicianTask,
  ReworkIssue as PrismaReworkIssue,
  FileAttachment as PrismaFileAttachment,
  TechnicianTaskState,
  ReworkIssueState,
} from '@prisma/client';

// ── TechnicianTask ───────────────────────────────────────────────────────────

export interface TechnicianTaskRecord {
  id: string;
  workOrderId: string;
  routingStepId: string;
  technicianId?: string;
  state: TechnicianTaskState;
  startedAt?: string;
  completedAt?: string;
  blockedReason?: string;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface TechnicianTaskRepository {
  findById(id: string): Promise<TechnicianTaskRecord | undefined>;
  listByWorkOrder(workOrderId: string): Promise<TechnicianTaskRecord[]>;
  listByTechnician(technicianId: string, state?: TechnicianTaskState): Promise<TechnicianTaskRecord[]>;
  save(record: TechnicianTaskRecord): Promise<void>;
}

export class InMemoryTechnicianTaskRepository implements TechnicianTaskRepository {
  private readonly records = new Map<string, TechnicianTaskRecord>();

  async findById(id: string): Promise<TechnicianTaskRecord | undefined> {
    return this.records.get(id);
  }

  async listByWorkOrder(workOrderId: string): Promise<TechnicianTaskRecord[]> {
    return [...this.records.values()].filter((r) => r.workOrderId === workOrderId);
  }

  async listByTechnician(technicianId: string, state?: TechnicianTaskState): Promise<TechnicianTaskRecord[]> {
    return [...this.records.values()].filter(
      (r) => r.technicianId === technicianId && (state ? r.state === state : true),
    );
  }

  async save(record: TechnicianTaskRecord): Promise<void> {
    this.records.set(record.id, record);
  }
}

export class PrismaTechnicianTaskRepository implements TechnicianTaskRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<TechnicianTaskRecord | undefined> {
    const r = await this.prisma.technicianTask.findUnique({ where: { id } });
    return r ? toTaskRecord(r) : undefined;
  }

  async listByWorkOrder(workOrderId: string): Promise<TechnicianTaskRecord[]> {
    const records = await this.prisma.technicianTask.findMany({
      where: { workOrderId },
      orderBy: { createdAt: 'asc' },
    });
    return records.map(toTaskRecord);
  }

  async listByTechnician(technicianId: string, state?: TechnicianTaskState): Promise<TechnicianTaskRecord[]> {
    const records = await this.prisma.technicianTask.findMany({
      where: { technicianId, ...(state ? { state } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    return records.map(toTaskRecord);
  }

  async save(record: TechnicianTaskRecord): Promise<void> {
    const data = {
      workOrderId: record.workOrderId,
      routingStepId: record.routingStepId,
      technicianId: record.technicianId ?? null,
      state: record.state,
      startedAt: record.startedAt ? new Date(record.startedAt) : null,
      completedAt: record.completedAt ? new Date(record.completedAt) : null,
      blockedReason: record.blockedReason ?? null,
      correlationId: record.correlationId,
      updatedAt: new Date(record.updatedAt),
      version: record.version,
    };
    await this.prisma.technicianTask.upsert({
      where: { id: record.id },
      create: { id: record.id, ...data, createdAt: new Date(record.createdAt) },
      update: data,
    });
  }
}

function toTaskRecord(r: PrismaTechnicianTask): TechnicianTaskRecord {
  return {
    id: r.id,
    workOrderId: r.workOrderId,
    routingStepId: r.routingStepId,
    technicianId: r.technicianId ?? undefined,
    state: r.state,
    startedAt: r.startedAt?.toISOString(),
    completedAt: r.completedAt?.toISOString(),
    blockedReason: r.blockedReason ?? undefined,
    correlationId: r.correlationId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

// ── ReworkIssue ──────────────────────────────────────────────────────────────

export interface ReworkIssueRecord {
  id: string;
  workOrderId: string;
  title: string;
  description: string;
  severity: string;
  state: ReworkIssueState;
  reportedBy: string;
  assignedTo?: string;
  resolvedAt?: string;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ReworkIssueRepository {
  findById(id: string): Promise<ReworkIssueRecord | undefined>;
  listByWorkOrder(workOrderId: string): Promise<ReworkIssueRecord[]>;
  save(record: ReworkIssueRecord): Promise<void>;
}

export class InMemoryReworkIssueRepository implements ReworkIssueRepository {
  private readonly records = new Map<string, ReworkIssueRecord>();

  async findById(id: string): Promise<ReworkIssueRecord | undefined> {
    return this.records.get(id);
  }

  async listByWorkOrder(workOrderId: string): Promise<ReworkIssueRecord[]> {
    return [...this.records.values()].filter((r) => r.workOrderId === workOrderId);
  }

  async save(record: ReworkIssueRecord): Promise<void> {
    this.records.set(record.id, record);
  }
}

export class PrismaReworkIssueRepository implements ReworkIssueRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<ReworkIssueRecord | undefined> {
    const r = await this.prisma.reworkIssue.findUnique({ where: { id } });
    return r ? toReworkRecord(r) : undefined;
  }

  async listByWorkOrder(workOrderId: string): Promise<ReworkIssueRecord[]> {
    const records = await this.prisma.reworkIssue.findMany({
      where: { workOrderId },
      orderBy: { createdAt: 'desc' },
    });
    return records.map(toReworkRecord);
  }

  async save(record: ReworkIssueRecord): Promise<void> {
    const data = {
      workOrderId: record.workOrderId,
      title: record.title,
      description: record.description,
      severity: record.severity,
      state: record.state,
      reportedBy: record.reportedBy,
      assignedTo: record.assignedTo ?? null,
      resolvedAt: record.resolvedAt ? new Date(record.resolvedAt) : null,
      correlationId: record.correlationId,
      updatedAt: new Date(record.updatedAt),
      version: record.version,
    };
    await this.prisma.reworkIssue.upsert({
      where: { id: record.id },
      create: { id: record.id, ...data, createdAt: new Date(record.createdAt) },
      update: data,
    });
  }
}

function toReworkRecord(r: PrismaReworkIssue): ReworkIssueRecord {
  return {
    id: r.id,
    workOrderId: r.workOrderId,
    title: r.title,
    description: r.description,
    severity: r.severity,
    state: r.state,
    reportedBy: r.reportedBy,
    assignedTo: r.assignedTo ?? undefined,
    resolvedAt: r.resolvedAt?.toISOString(),
    correlationId: r.correlationId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

// ── FileAttachment ────────────────────────────────────────────────────────────

export interface FileAttachmentRecord {
  id: string;
  entityType: string;
  entityId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  s3Key: string;
  s3Bucket: string;
  uploadedBy: string;
  correlationId: string;
  createdAt: string;
  deletedAt?: string;
  version: number;
}

export interface FileAttachmentRepository {
  findById(id: string): Promise<FileAttachmentRecord | undefined>;
  listByEntity(entityType: string, entityId: string): Promise<FileAttachmentRecord[]>;
  save(record: FileAttachmentRecord): Promise<void>;
  softDelete(id: string): Promise<void>;
}

export class InMemoryFileAttachmentRepository implements FileAttachmentRepository {
  private readonly records = new Map<string, FileAttachmentRecord>();

  async findById(id: string): Promise<FileAttachmentRecord | undefined> {
    return this.records.get(id);
  }

  async listByEntity(entityType: string, entityId: string): Promise<FileAttachmentRecord[]> {
    return [...this.records.values()].filter(
      (r) => r.entityType === entityType && r.entityId === entityId && !r.deletedAt,
    );
  }

  async save(record: FileAttachmentRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async softDelete(id: string): Promise<void> {
    const r = this.records.get(id);
    if (r) this.records.set(id, { ...r, deletedAt: new Date().toISOString() });
  }
}

export class PrismaFileAttachmentRepository implements FileAttachmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<FileAttachmentRecord | undefined> {
    const r = await this.prisma.fileAttachment.findUnique({ where: { id } });
    return r ? toAttachmentRecord(r) : undefined;
  }

  async listByEntity(entityType: string, entityId: string): Promise<FileAttachmentRecord[]> {
    const records = await this.prisma.fileAttachment.findMany({
      where: { entityType, entityId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return records.map(toAttachmentRecord);
  }

  async save(record: FileAttachmentRecord): Promise<void> {
    const data = {
      entityType: record.entityType,
      entityId: record.entityId,
      fileName: record.fileName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      s3Key: record.s3Key,
      s3Bucket: record.s3Bucket,
      uploadedBy: record.uploadedBy,
      correlationId: record.correlationId,
      version: record.version,
    };
    await this.prisma.fileAttachment.upsert({
      where: { id: record.id },
      create: { id: record.id, ...data, createdAt: new Date(record.createdAt) },
      update: data,
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.fileAttachment.update({
      where: { id },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
  }
}

function toAttachmentRecord(r: PrismaFileAttachment): FileAttachmentRecord {
  return {
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    fileName: r.fileName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    s3Key: r.s3Key,
    s3Bucket: r.s3Bucket,
    uploadedBy: r.uploadedBy,
    correlationId: r.correlationId,
    createdAt: r.createdAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString(),
    version: r.version,
  };
}
