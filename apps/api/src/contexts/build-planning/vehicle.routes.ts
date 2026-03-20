import type { RegisterVehicleInput, VehicleService } from './vehicle.service.js';

export interface VehicleRoutes {
  registerVehicle(
    input: RegisterVehicleInput,
    correlationId: string,
    actorId?: string,
  ): ReturnType<VehicleService['registerVehicle']>;
  findVehicleById(id: string): Promise<Awaited<ReturnType<VehicleService['registerVehicle']>> | undefined>;
}

export function createVehicleRoutes(service: VehicleService, repository: import('./vehicle.repository.js').VehicleRepository): VehicleRoutes {
  return {
    registerVehicle(input, correlationId, actorId) {
      return service.registerVehicle(input, {
        correlationId,
        actorId,
        module: 'build-planning',
      });
    },
    findVehicleById(id) {
      return repository.findById(id);
    },
  };
}
