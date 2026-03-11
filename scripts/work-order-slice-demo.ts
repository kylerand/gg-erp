import { createWorkOrderHandler, listWorkOrdersHandler } from '../apps/api/src/lambda/work-orders/handlers.js';

async function main(): Promise<void> {
  const now = Date.now();
  const workOrderNumber = `WO-${now}`;
  const correlationId = `slice-${now}`;

  const createResponse = await createWorkOrderHandler({
    headers: {
      'x-correlation-id': correlationId,
      'x-actor-id': 'local-dev',
    },
    body: JSON.stringify({
      workOrderNumber,
      vehicleId: `veh-${now}`,
      buildConfigurationId: `cfg-${now}`,
      bomId: `bom-${now}`,
    }),
  });

  const listResponse = await listWorkOrdersHandler({
    queryStringParameters: {
      limit: '10',
      offset: '0',
    },
  });

  console.log('Create response:');
  console.log(createResponse.body);
  console.log('\nList response:');
  console.log(listResponse.body);
}

void main();
