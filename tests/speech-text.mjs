import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile('app/lib/speech-text.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { speechText, nextSpeechChunk } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

assert.equal(speechText('### 📨 Gmail Workflow: **Auto-Label New Emails**\n1. **Trigger**:\n- Use the `Gmail` node. ✅'), 'Gmail Workflow: Auto-Label New Emails Trigger: Use the Gmail node.');
assert.equal(speechText('Read [Gmail documentation](https://docs.n8n.io/integrations/gmail) or https://docs.python.org/3/library/json.html.'), 'Read Gmail documentation or python.');
assert.equal(speechText('Visit www.github.com/example/repo?token=private#section!'), 'Visit github!');
assert.equal(speechText('[https://n8n.io/docs](https://n8n.io/docs)'), 'n8n');
assert.equal(speechText('👩🏽‍💻 🇵🇭 1️⃣ ✅ 😊'), '');
assert.equal(speechText('Email updates@company.com. RAM is 16 GB, 2 + 2 = 4, and 50% is half.'), 'Email updates@company.com. RAM is 16 GB, 2 + 2 = 4, and 50% is half.');
assert.equal(speechText('Use [Python](https://example.com/docs/example_(python)).'), 'Use Python.');
assert.equal(speechText("Here's your list. It’s ready, and you’re welcome. Don't worry; we can't lose it."), 'here is your list. it is ready, and you are welcome. do not worry; we cannot lose it.');
assert.equal(speechText("Here\\'s Jimmyʼs list. That＇s O’Connor's task."), "here is Jimmy's list. that is O'Connor's task.");
assert.equal(speechText("**Here's** [what’s new](https://example.com)."), 'here is what is new.');

function streamed(parts) {
  let pending = '', started = false;
  const spoken = [];
  function drain(final) {
    while (pending) {
      const chunk = nextSpeechChunk(pending, final, started);
      if (!chunk) break;
      assert.ok(chunk.rest.length < pending.length, 'Each chunk consumes input');
      pending = chunk.rest;
      const cleaned = speechText(chunk.text);
      if (cleaned) { spoken.push(cleaned); started = true; }
    }
  }
  for (const part of parts) { pending += part; drain(false); }
  drain(true); assert.equal(pending, '');
  return spoken.join(' ');
}
const example = '### 📨 Gmail Workflow\n1. **Trigger**: Use the Gmail node. Read [the official Gmail documentation](https://docs.n8n.io/integrations/builtin/app-nodes/gmail) for details. Visit https://docs.python.org/3/library/json.html. ✅ Done!';
for (let cut = 0; cut <= example.length; cut++) {
  const spoken = streamed([example.slice(0, cut), example.slice(cut)]);
  assert.ok(spoken.includes('the official Gmail documentation'), `Link label survives split ${cut}`);
  assert.ok(spoken.includes('python'), `Site name survives split ${cut}`);
  assert.doesNotMatch(spoken, /https|integrations|builtin|json\.html|[\[\]#*_`]|📨|✅/);
}
const characters = streamed([...example]);
assert.doesNotMatch(characters, /https|integrations|builtin|json\.html|[\[\]#*_`]|📨|✅/);
assert.ok(characters.includes('official Gmail documentation'));
assert.equal(nextSpeechChunk('Read https://docs.python.org/', false, false), null);
assert.equal(nextSpeechChunk('1.', false, false), null);
assert.equal(streamed(['✅']), '');
for (const sentence of ["Here's your list. Don't forget Jimmy's task.", 'Here’s your list. You’re ready.']) {
  for (let cut = 0; cut <= sentence.length; cut++) {
    assert.equal(streamed([sentence.slice(0, cut), sentence.slice(cut)]), speechText(sentence), `Contraction survives split ${cut}`);
  }
  assert.equal(streamed([...sentence]), speechText(sentence));
}
console.log('Passed: spoken Markdown/emoji cleanup, link titles, bare URL site names, preserved email/numbers, and links split at every streaming boundary.');
