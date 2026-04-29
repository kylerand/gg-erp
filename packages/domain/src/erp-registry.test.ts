import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ERP_OBJECTS,
  getErpCommandDestinations,
  getErpQuickCreateDestinations,
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
