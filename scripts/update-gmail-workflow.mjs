import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';

export const defaultQuery = "'is:unread after:' + Math.floor($now.setZone('Asia/Manila').startOf('week').toSeconds())";
const params = "($('Webhook Trigger').first().json.query || $('Webhook Trigger').first().json.body || {})";
const query = `${params}.query ?? (${defaultQuery})`;

export function buildGmailWorkflow(existing) {
  const webhook = structuredClone(existing.nodes.find(node => node.type === 'n8n-nodes-base.webhook'));
  const gmail = existing.nodes.find(node => node.type === 'n8n-nodes-base.gmail');
  if (!webhook || webhook.parameters.path !== 'gmail/messages' || webhook.parameters.authentication !== 'headerAuth' || !webhook.credentials?.httpHeaderAuth || !gmail?.credentials?.gmailOAuth2) throw new Error('Expected the authenticated gmail/messages workflow with connected Gmail credentials. No changes made.');
  webhook.name = 'Webhook Trigger';
  webhook.parameters.responseMode = 'lastNode';
  webhook.parameters.responseData = 'firstEntryJson';
  webhook.position = [0, 0];
  const node = (name, type, typeVersion, position, parameters, extra = {}) => ({ id: randomUUID(), name, type: `n8n-nodes-base.${type}`, typeVersion, position, parameters, ...extra });
  const nodes = [webhook,
    node('List Gmail Page', 'httpRequest', 4.2, [240, 0], {
      method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages',
      authentication: 'predefinedCredentialType', nodeCredentialType: 'gmailOAuth2',
      sendQuery: true, queryParameters: { parameters: [
        { name: 'q', value: `={{ ${query} }}` },
        { name: 'maxResults', value: `={{ Math.min(20, Math.max(1, Number(${params}.pageSize) || 20)) }}` },
        { name: 'pageToken', value: `={{ ${params}.pageToken || '' }}` },
        { name: 'includeSpamTrash', value: 'false' },
      ] }, options: { timeout: 30000 },
    }, { credentials: structuredClone(gmail.credentials), notes: 'One Gmail API page per request. Keep the nextPageToken for continuation; never crawl the whole mailbox in this node.' }),
    node('Prepare Message IDs', 'code', 2, [480, 0], {
      mode: 'runOnceForAllItems', jsCode: "const page = $input.first().json;\nreturn page.messages?.length ? page.messages.map(message => ({ json: { id: message.id } })) : [{ json: { id: '' } }];",
    }),
    node('Has Messages', 'if', 2.2, [720, 0], { conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ id: randomUUID(), leftValue: '={{ Boolean($json.id) }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and',
    }, options: {} }),
    node('Get Gmail Previews', 'gmail', 2.1, [960, -80], { resource: 'message', operation: 'get', messageId: '={{ $json.id }}', simple: true, options: {} }, { credentials: structuredClone(gmail.credentials), notes: 'Read metadata and snippet only. Does not mark messages read or download attachments.' }),
    node('Return Email Page', 'code', 2, [1200, 0], {
      mode: 'runOnceForAllItems', jsCode: `const page = $('List Gmail Page').first().json;
const request = $('Webhook Trigger').first().json;
const parameters = request.query || request.body || {};
const messages = $input.all().filter(item => item.json.id).map(({ json: message }) => ({
  id: message.id, sender: message.From || message.from || '', subject: message.Subject || message.subject || '',
  preview: String(message.snippet || '').slice(0, 300), unread: (message.labelIds || []).includes('UNREAD') || (message.labels || []).some(label => label.id === 'UNREAD'),
  date: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : '',
}));
return [{ json: { query: parameters.query ?? (${defaultQuery}), count: messages.length, messages, nextPageToken: page.nextPageToken || '', hasMore: Boolean(page.nextPageToken), resultSizeEstimate: page.resultSizeEstimate ?? null, scope: 'One page; spam and trash excluded. Previews only.' } }];`,
    }),
  ];
  const connections = {};
  const edge = (from, to, output = 0) => {
    const main = (connections[from] ??= { main: [] }).main;
    while (main.length <= output) main.push([]);
    main[output].push({ node: to, type: 'main', index: 0 });
  };
  edge('Webhook Trigger', 'List Gmail Page'); edge('List Gmail Page', 'Prepare Message IDs');
  edge('Prepare Message IDs', 'Has Messages'); edge('Has Messages', 'Get Gmail Previews');
  edge('Has Messages', 'Return Email Page', 1); edge('Get Gmail Previews', 'Return Email Page');
  return { name: existing.name, nodes, connections, settings: { executionOrder: 'v1', timezone: 'Asia/Manila', executionTimeout: 90 } };
}

if (process.argv.includes('--apply')) {
  loadEnvFile('.env.local');
  const base = (process.env.N8N_URL || 'http://localhost:5678').replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
  const headers = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Content-Type': 'application/json' };
  const id = 'gTCt0OBxzCOl68ND';
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(`${base}/api/v1/${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`n8n ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  };
  const existing = await call(`workflows/${id}`);
  const updated = buildGmailWorkflow(existing);
  await mkdir('storage', { recursive: true });
  await writeFile(`storage/gmail-workflow-backup-${Date.now()}.json`, JSON.stringify(existing, null, 2), { flag: 'wx' });
  const current = await call(`workflows/${id}`);
  if (current.versionId !== existing.versionId) throw new Error('The workflow changed during preparation. No update applied.');
  const saved = await call(`workflows/${id}`, 'PUT', updated);
  if (existing.active) await call(`workflows/${id}/activate`, 'POST', { versionId: saved.versionId });
  const confirmed = await call(`workflows/${id}`);
  console.log(JSON.stringify({ id: confirmed.id, name: confirmed.name, active: confirmed.active, nodes: confirmed.nodes.map(node => node.name), versionId: confirmed.versionId, activeVersionId: confirmed.activeVersionId }));
}
