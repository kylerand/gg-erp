import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiProvider } from '../../../../packages/ai/src/index.js';
import { InMemoryAuditSink } from '../audit/recorder.js';
import { AiService } from '../contexts/ai/ai.service.js';
import type { ObservabilityContext, ObservabilityHooks } from '../observability/hooks.js';

interface ObservabilityProbe {
  hooks: ObservabilityHooks;
  traces: string[];
  infos: string[];
  errors: string[];
  metrics: string[];
}

function createObservabilityProbe(): ObservabilityProbe {
  const traces: string[] = [];
  const infos: string[] = [];
  const errors: string[] = [];
  const metrics: string[] = [];

  const hooks: ObservabilityHooks = {
    logInfo(message: string, _context: ObservabilityContext) {
      infos.push(message);
    },
    logError(message: string, _context: ObservabilityContext) {
      errors.push(message);
    },
    metric(name: string, _value: number, _context: ObservabilityContext) {
      metrics.push(name);
    },
    trace(operation: string, _context: ObservabilityContext) {
      traces.push(operation);
    }
  };

  return { hooks, traces, infos, errors, metrics };
}

test('ai summary rejects missing workOrderId and records validation telemetry', async () => {
  let summarizeCalls = 0;
  const provider: AiProvider = {
    async summarize() {
      summarizeCalls += 1;
      return { content: 'unused', model: 'test-model' };
    }
  };
  const audit = new InMemoryAuditSink();
  const observability = createObservabilityProbe();
  const service = new AiService({
    provider,
    audit,
    observability: observability.hooks
  });
  const context = { correlationId: 'ai-1', actorId: 'tester', module: 'test' };

  await assert.rejects(
    service.summarizeWorkOrderNotes({ workOrderId: '', notes: 'Needs summary' }, context),
    /workOrderId is required/
  );

  assert.equal(summarizeCalls, 0);
  assert.equal(audit.list().length, 1);
  assert.equal(audit.list()[0]?.action, 'ai.request');
  assert.equal(audit.list()[0]?.entityId, 'unknown');
  assert.match(JSON.stringify(audit.list()[0]?.metadata), /"status":"rejected"/);
  assert.ok(observability.traces.includes('ai.summarize_work_order_notes'));
  assert.ok(observability.metrics.includes('ai.request.validation_error'));
  assert.equal(observability.errors.length, 1);
});

test('ai summary surfaces provider failure and records audit + observability', async () => {
  const provider: AiProvider = {
    async summarize() {
      throw new Error('provider unavailable');
    }
  };
  const audit = new InMemoryAuditSink();
  const observability = createObservabilityProbe();
  const service = new AiService({
    provider,
    audit,
    observability: observability.hooks
  });
  const context = { correlationId: 'ai-2', actorId: 'tester', module: 'test' };

  await assert.rejects(
    service.summarizeWorkOrderNotes(
      { workOrderId: 'wo-100', notes: 'Finalize calibration and verify harness routing.' },
      context
    ),
    /provider unavailable/
  );

  assert.equal(audit.list().length, 1);
  assert.equal(audit.list()[0]?.action, 'ai.request');
  assert.equal(audit.list()[0]?.entityId, 'wo-100');
  assert.match(JSON.stringify(audit.list()[0]?.metadata), /"status":"failed"/);
  assert.ok(observability.traces.includes('ai.summarize_work_order_notes'));
  assert.ok(observability.metrics.includes('ai.request.failure'));
  assert.equal(observability.errors.length, 1);
});
