import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ERP_OBJECTS,
  getErpCommandDestinations,
  getErpQuickCreateDestinations,
  getRequiredErpRecordRoute,
  getErpWorkspaceNavigationItems,
  getRequiredErpRoute,
  getLiveErpWorkspaceLinks,
  getLiveErpWorkspaces,
  normalizeErpRoute,
  type ErpObjectDescriptor,
} from './index.js';

function assertUnique(values: readonly string[], label: string): void {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  assert.deepEqual([...new Set(duplicates)], [], `${label} must be unique`);
}

test('ERP object registry exposes unique live route metadata', () => {
  const allObjects: readonly ErpObjectDescriptor[] = ERP_OBJECTS;

  assertUnique(
    allObjects.map((object) => object.key),
    'object keys',
  );

  for (const object of allObjects) {
    assert.ok(object.route.startsWith('/'), `${object.key} route should be app-relative`);
    assert.notEqual(object.label.trim(), '', `${object.key} label should be present`);
    assert.notEqual(object.ownerContext.trim(), '', `${object.key} owner should be present`);
  }
});

test('registry route helper resolves module links and filtered routes', () => {
  assert.equal(getRequiredErpRoute('work-order'), '/work-orders');
  assert.equal(getRequiredErpRoute('create-work-order'), '/work-orders/new');
  assert.equal(getRequiredErpRoute('create-sales-opportunity'), '/sales/opportunities/new');
  assert.equal(getRequiredErpRoute('quickbooks-customer'), '/accounting/quickbooks/customers');
  assert.equal(
    getRequiredErpRoute('accounting-sync', { view: 'queue' }),
    '/accounting/sync?view=queue',
  );
  assert.equal(
    getRequiredErpRoute('accounting-sync', {
      view: 'invoices',
      state: 'SYNCED',
      period: 'today',
    }),
    '/accounting/sync?view=invoices&state=SYNCED&period=today',
  );
  assert.equal(getRequiredErpRecordRoute('work-order', 'wo-1'), '/work-orders/wo-1');
  assert.equal(
    getRequiredErpRecordRoute('sales-opportunity', 'opp 1'),
    '/sales/opportunities/opp%201',
  );
  assert.equal(
    getRequiredErpRecordRoute('quote', 'qt-1', { tab: 'lines' }),
    '/sales/quotes/qt-1?tab=lines',
  );
});

test('workspace navigation items include live links and quick actions', () => {
  const workOrderItems = getErpWorkspaceNavigationItems('work-orders');
  const salesItems = getErpWorkspaceNavigationItems('sales');
  const accountingItems = getErpWorkspaceNavigationItems('accounting');
  const trainingItems = getErpWorkspaceNavigationItems('training');

  assert.ok(workOrderItems.some((item) => item.key === 'create-work-order'));
  assert.ok(salesItems.some((item) => item.key === 'create-sales-opportunity'));
  assert.ok(
    getErpWorkspaceNavigationItems('customers').some((item) => item.key === 'create-customer'),
  );
  assert.ok(accountingItems.some((item) => item.key === 'quickbooks-customer'));
  assert.ok(accountingItems.some((item) => item.key === 'quickbooks-invoice'));
  assert.ok(accountingItems.some((item) => item.key === 'quickbooks-chart-of-accounts'));
  assert.ok(trainingItems.some((item) => item.key === 'training-admin'));
});

test('live workspace links reference live registry objects', () => {
  const allObjects: readonly ErpObjectDescriptor[] = ERP_OBJECTS;
  const liveObjectsByKey = new Map<string, ErpObjectDescriptor>(
    allObjects.filter((object) => object.status === 'live').map((object) => [object.key, object]),
  );

  for (const workspace of getLiveErpWorkspaces()) {
    assert.ok(workspace.route.startsWith('/'), `${workspace.key} route should be app-relative`);

    for (const link of workspace.links.filter((item) => item.status === 'live')) {
      assert.ok(link.route.startsWith('/'), `${link.key} route should be app-relative`);
      if (!link.objectKey) continue;

      const object = liveObjectsByKey.get(link.objectKey);
      assert.ok(object, `${link.key} should reference a live object`);
      assert.equal(
        normalizeErpRoute(link.route),
        normalizeErpRoute(object.route),
        `${link.key} route should match its registry object`,
      );
    }
  }
});

test('command palette and quick-create entries are live app routes', () => {
  const commands = getErpCommandDestinations();
  const quickCreates = getErpQuickCreateDestinations();
  const allObjects: readonly ErpObjectDescriptor[] = ERP_OBJECTS;
  const liveQuickActionRoutes = new Set(
    allObjects.flatMap((object) =>
      (object.quickActions ?? [])
        .filter((action) => action.status === 'live')
        .map((action) => action.route),
    ),
  );

  assertUnique(
    commands.map((destination) => destination.key),
    'command destination keys',
  );
  assert.ok(commands.length > getLiveErpWorkspaceLinks().length);
  assert.ok(quickCreates.length > 0);

  for (const destination of commands) {
    assert.equal(destination.status, 'live');
    assert.ok(destination.route.startsWith('/'), `${destination.key} route should be app-relative`);
  }

  for (const quickCreate of quickCreates) {
    assert.equal(quickCreate.group, 'Create');
    assert.ok(
      liveQuickActionRoutes.has(quickCreate.route),
      `${quickCreate.key} should map to a live registry quick action`,
    );
  }
});
