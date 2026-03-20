import type { CartVehicle } from '../../../../../packages/domain/src/model/buildPlanning.js';

export interface VehicleRepository {
  findById(id: string): Promise<CartVehicle | undefined>;
  findByVin(vin: string): Promise<CartVehicle | undefined>;
  findBySerialNumber(serialNumber: string): Promise<CartVehicle | undefined>;
  save(vehicle: CartVehicle): Promise<CartVehicle>;
  /** Inserts a VinSequence row and returns its auto-incremented id. */
  nextSequenceNumber(): Promise<number>;
}
