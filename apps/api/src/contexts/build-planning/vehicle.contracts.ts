import type { CartVehicle, CartVehicleState } from '../../../../../packages/domain/src/model/buildPlanning.js';
import type { EventEnvelope } from '../../events/publisher.js';

export interface RegisterVehicleRequest {
  customerId: string;
  serialNumber: string;
  modelCode: string;
  modelYear: number;
}

export interface VehicleResponse {
  id: string;
  vin: string;
  serialNumber: string;
  modelCode: string;
  modelYear: number;
  customerId: string;
  state: CartVehicleState;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleRegisteredPayload {
  vehicleId: string;
  vin: string;
  serialNumber: string;
  modelCode: string;
  modelYear: number;
  customerId: string;
}

export function toVehicleResponse(vehicle: CartVehicle): VehicleResponse {
  return {
    id: vehicle.id,
    vin: vehicle.vin,
    serialNumber: vehicle.serialNumber,
    modelCode: vehicle.modelCode,
    modelYear: vehicle.modelYear,
    customerId: vehicle.customerId,
    state: vehicle.state,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
  };
}

export function toVehicleRegisteredEvent(
  vehicle: CartVehicle,
  correlationId: string,
): EventEnvelope<VehicleRegisteredPayload> {
  return {
    name: 'cart.vehicle.registered',
    correlationId,
    emittedAt: new Date().toISOString(),
    payload: {
      vehicleId: vehicle.id,
      vin: vehicle.vin,
      serialNumber: vehicle.serialNumber,
      modelCode: vehicle.modelCode,
      modelYear: vehicle.modelYear,
      customerId: vehicle.customerId,
    },
  };
}
