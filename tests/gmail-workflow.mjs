import assert from 'node:assert/strict';
import { buildGmailWorkflow } from '../scripts/update-gmail-workflow.mjs';

const existing = { name: 'Gmail test', nodes: [
  { id: 'webhook', name: 'Webhook Trigger', type: 'n8n-nodes-base.webhook', typeVersion: 2, webhookId: 'existing-path', parameters: { path: 'gmail/messages', authentication: 'headerAuth' }, credentials: { httpHeaderAuth: { id: 'existing-auth' } } },
  { type: 'n8n-nodes-base.gmail', credentials: { gmailOAuth2: { id: 'existing-oauth' } } },
] };
const workflow = buildGmailWorkflow(existing);
assert.equal(workflow.nodes[0].webhookId, 'existing-path');
assert.equal(workflow.nodes[0].parameters.responseData, 'firstEntryJson');
assert.equal(workflow.nodes[0].credentials.httpHeaderAuth.id, 'existing-auth');
const list = workflow.nodes.find(node => node.name === 'List Gmail Page');
assert.equal(list.credentials.gmailOAuth2.id, 'existing-oauth');
assert.equal(list.parameters.authentication, 'predefinedCredentialType');
assert.equal(list.parameters.options.pagination, undefined, 'Exactly one list page per execution');
assert.ok(list.parameters.queryParameters.parameters.some(parameter => parameter.name === 'pageToken'));
const get = workflow.nodes.find(node => node.type === 'n8n-nodes-base.gmail');
assert.equal(get.parameters.operation, 'get'); assert.equal(get.parameters.simple, true);
assert.equal(workflow.connections['Has Messages'].main[1][0].node, 'Return Email Page');
assert.equal(workflow.settings.executionTimeout, 90);
const prepare = new Function('$input', workflow.nodes.find(node => node.name === 'Prepare Message IDs').parameters.jsCode);
assert.deepEqual(prepare({ first: () => ({ json: {} }) }), [{ json: { id: '' } }]);
assert.deepEqual(prepare({ first: () => ({ json: { messages: [{ id: 'one' }] } }) }), [{ json: { id: 'one' } }]);
const finish = new Function('$input', '$', '$now', workflow.nodes.find(node => node.name === 'Return Email Page').parameters.jsCode);
const source = name => ({ first: () => ({ json: name === 'List Gmail Page' ? { nextPageToken: 'second', resultSizeEstimate: 90 } : { query: { query: '' } } }) });
const page = finish({ all: () => [{ json: { id: 'one', From: 'sender', Subject: 'subject', snippet: 'preview', labels: [{ id: 'UNREAD', name: 'UNREAD' }] } }] }, source)[0].json;
assert.equal(page.query, ''); assert.equal(page.nextPageToken, 'second'); assert.equal(page.count, 1); assert.equal(page.messages[0].unread, true);
const empty = finish({ all: () => [{ json: { id: '' } }] }, name => ({ first: () => ({ json: name === 'List Gmail Page' ? {} : { query: { query: 'is:unread' } } }) }))[0].json;
assert.equal(empty.count, 0); assert.equal(empty.nextPageToken, ''); assert.equal(empty.hasMore, false);
assert.throws(() => buildGmailWorkflow({ ...existing, nodes: [] }), /Expected/);
console.log('Passed: authenticated Gmail workflow preserves credentials/path, requests one page, reads previews only, returns cursors and handles zero matches. No network requests.');
