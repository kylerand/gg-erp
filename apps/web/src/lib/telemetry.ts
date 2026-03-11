export interface TelemetryEvent {
  name: string;
  payload: Record<string, unknown>;
}

export function emitTelemetry(event: TelemetryEvent): void {
  console.info('web.telemetry', event);
}
