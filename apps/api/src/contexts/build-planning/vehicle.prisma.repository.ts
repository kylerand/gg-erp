import { PrismaClient, CartVehicleStatus } from '@prisma/client';
import {
  CartVehicleState,
  type CartVehicle,
} from '../../../../../packages/domain/src/model/buildPlanning.js';
import type { VehicleRepository } from './vehicle.repository.js';

const domainStateByPrismaStatus: Record<CartVehicleStatus, CartVehicleState> = {
  REGISTERED: CartVehicleState.REGISTERED,
  IN_BUILD: CartVehicleState.IN_BUILD,
  QUALITY_HOLD: CartVehicleState.QUALITY_HOLD,
  COMPLETED: CartVehicleState.COMPLETED,
  RETIRED: CartVehicleState.RETIRED,
};

const prismaStatusByDomainState: Record<CartVehicleState, CartVehicleStatus> = {
  REGISTERED: 'REGISTERED',
  IN_BUILD: 'IN_BUILD',
  QUALITY_HOLD: 'QUALITY_HOLD',
  COMPLETED: 'COMPLETED',
  RETIRED: 'RETIRED',
};

export interface PrismaVehicleRepositoryOptions {
  prisma?: PrismaClient;
}

export class PrismaVehicleRepository implements VehicleRepository {
  private readonly prisma: PrismaClient;

  constructor(options: PrismaVehicleRepositoryOptions = {}) {
    this.prisma = options.prisma ?? new PrismaClient();
  }

  async findById(id: string): Promise<CartVehicle | undefined> {
    const record = await this.prisma.cartVehicle.findUnique({ where: { id } });
    return record ? toDomainVehicle(record) : undefined;
  }

  async findByVin(vin: string): Promise<CartVehicle | undefined> {
    const record = await this.prisma.cartVehicle.findUnique({ where: { vin } });
    return record ? toDomainVehicle(record) : undefined;
  }

  async findBySerialNumber(serialNumber: string): Promise<CartVehicle | undefined> {
    const record = await this.prisma.cartVehicle.findUnique({ where: { serialNumber } });
    return record ? toDomainVehicle(record) : undefined;
  }

  async save(vehicle: CartVehicle): Promise<CartVehicle> {
    const record = await this.prisma.cartVehicle.upsert({
      where: { id: vehicle.id },
      create: {
        id: vehicle.id,
        vin: vehicle.vin,
        serialNumber: vehicle.serialNumber,
        modelCode: vehicle.modelCode,
        modelYear: vehicle.modelYear,
        customerId: vehicle.customerId,
        state: prismaStatusByDomainState[vehicle.state],
      },
      update: {
        state: prismaStatusByDomainState[vehicle.state],
        updatedAt: new Date(),
      },
    });
    return toDomainVehicle(record);
  }

  async nextSequenceNumber(): Promise<number> {
    const row = await this.prisma.vinSequence.create({ data: {} });
    return row.id;
  }
}

function toDomainVehicle(record: {
  id: string;
  vin: string;
  serialNumber: string;
  modelCode: string;
  modelYear: number;
  customerId: string;
  state: CartVehicleStatus;
  createdAt: Date;
  updatedAt: Date;
}): CartVehicle {
  return {
    id: record.id,
    vin: record.vin,
    serialNumber: record.serialNumber,
    modelCode: record.modelCode,
    modelYear: record.modelYear,
    customerId: record.customerId,
    state: domainStateByPrismaStatus[record.state],
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
