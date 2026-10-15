// Opt-in: creates and leaves one inactive test workflow in the configured n8n.
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
nextEnv.loadEnvConfig(process.cwd(), false);
assert.equal(process.env.VERIFY_LIVE_N8N, '1', 'Set VERIFY_LIVE_N8N=1 to explicitly create an inactive test workflow.');
assert.ok(process.env.N8N_API_KEY, 'Configure N8N_API_KEY first.');
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--port', '3105'], { windowsHide: true, stdio: 'ignore' });
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    assert.equal(server.exitCode, null, 'Test server failed to start');
    try { if ((await fetch('http://localhost:3105')).status === 401) { ready = true; break; } } catch {}
    await delay(250);
  }
  assert.ok(ready);
  const auth = Buffer.from(`${process.env.JIMMY_AUTH_USERNAME || process.env.JOHNNY_AUTH_USERNAME}:${process.env.JIMMY_AUTH_PASSWORD || process.env.JOHNNY_AUTH_PASSWORD}`).toString('base64');
  const response = await fetch('http://localhost:3105/api/n8n-workflow', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({ confirmed: true, prompt: 'Create a simple n8n workflow named Jimmy API test with a Manual Trigger connected to Edit Fields. Edit Fields sets a string field named message to Hello from Jimmy. No external services.' }), signal: AbortSignal.timeout(210000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  await mkdir('.jimmy-runtime', { recursive: true });
  await writeFile('.jimmy-runtime/n8n-live-test.json', JSON.stringify(result, null, 2));
  const root = (process.env.N8N_URL || 'http://localhost:5678').replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
  const verify = await fetch(`${root}/api/v1/workflows/${encodeURIComponent(result.id)}`, { headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY }, signal: AbortSignal.timeout(10000) });
  assert.equal(verify.status, 200);
  const workflow = await verify.json();
  assert.equal(workflow.active, false);
  const trigger = workflow.nodes.find(node => node.type === 'n8n-nodes-base.manualTrigger');
  const fields = workflow.nodes.find(node => node.type === 'n8n-nodes-base.set');
  assert.ok(trigger && fields);
  assert.ok(fields.parameters.assignments.assignments.some(field => field.name === 'message' && field.value === 'Hello from Jimmy'));
  assert.ok(workflow.connections[trigger.name].main[0].some(connection => connection.node === fields.name));
  console.log(JSON.stringify({ verified: true, name: result.name, id: result.id, active: false, url: result.url }));
} finally { server.kill(); }
