import { createInterface } from 'node:readline';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const home = process.env.CODEX_HOME;
const accountPath = join(home, 'test-account.json');
const mode = process.env.JIMMY_CODEX_TEST_MODE;
const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  const { id, method, params } = JSON.parse(line);
  const reply = result => send({ id, result });
  try {
    if (method === 'initialize') {
      assert.equal(params.clientInfo.name, 'jimmy');
      assert.equal(process.env.OPENAI_API_KEY, undefined);
      for (const flag of ['features.shell_tool=false', 'features.apps=false', 'features.plugins=false', 'features.multi_agent=false']) assert.ok(process.argv.includes(flag));
      reply({});
    }
    if (method === 'account/read') reply({ account: existsSync(accountPath) && JSON.parse(readFileSync(accountPath, 'utf8')).signedIn ? { type: 'chatgpt', planType: 'plus' } : null });
    if (method === 'account/login/start') {
      reply({ authUrl: mode === 'bad-url' ? 'https://evil.example/login' : 'https://auth.openai.com/oauth/authorize?test=1' });
      if (mode !== 'bad-url') setTimeout(() => {
        writeFileSync(accountPath, '{"signedIn":true}');
        send({ method: 'account/login/completed', params: { success: true } });
      }, 150);
    }
    if (method === 'account/logout') {
      // Clearing the mock login uses a file operation only inside the test home.
      writeFileSync(accountPath, '{"signedIn":false}');
      reply({});
    }
    if (method === 'thread/start') {
      assert.equal(params.sandbox, 'read-only');
      assert.equal(params.approvalPolicy, 'never');
      assert.equal(params.ephemeral, true);
      assert.match(params.baseInstructions, /First/);
      assert.ok(!params.baseInstructions.includes('PRIVATEJOURNALSENTINEL'), 'Journal lookup must not attach entries to Codex');
      if (process.env.JIMMY_EXPECT_PERSONALITY) assert.ok(params.baseInstructions.includes(process.env.JIMMY_EXPECT_PERSONALITY));
        if (process.env.JIMMY_EXPECT_NAME) assert.match(params.baseInstructions, new RegExp(`^You are ${process.env.JIMMY_EXPECT_NAME},`));
      reply({ thread: { id: 'test-thread', model: 'account-default' } });
    }
    if (method === 'turn/start') {
      assert.equal(params.sandboxPolicy.type, 'readOnly');
      assert.equal(params.sandboxPolicy.access.includePlatformDefaults, false);
      assert.equal(JSON.parse(params.input[0].text).conversation[0].role, 'user');
      reply({ turn: { id: 'turn' } });
      if (mode === 'crash') { process.exit(1); }
      if (mode === 'hang') return;
      if (mode === 'fail') { send({ method: 'turn/completed', params: { threadId: 'test-thread', turn: { status: 'failed', error: { message: 'Test failure' } } } }); return; }
      const bytes = Buffer.from(`${JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'test-thread', delta: mode === 'oversize' ? 'x'.repeat(100_001) : 'Hello 🌏' } })}\n`);
      for (let offset = 0; offset < bytes.length; offset += 127) process.stdout.write(bytes.subarray(offset, offset + 127));
      send({ method: 'turn/completed', params: { threadId: 'test-thread', turn: { status: 'completed' } } });
    }
  } catch (error) { send({ id, error: { message: error.message } }); }
});
lines.on('close', () => process.exit(0));
