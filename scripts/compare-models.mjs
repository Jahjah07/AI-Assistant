// Read-only model comparison. Tool requests are recorded, never executed.
import { performance } from 'node:perf_hooks';

const models = process.argv.slice(2);
if (!models.length) models.push('llama3.2:latest', 'qwen3:4b-instruct');
const cases = [
  { name: 'time', prompt: 'Local time is 3:42 PM. What time is it? Answer with only the time.', check: r => r.message.content.trim() === '3:42 PM' },
  { name: 'storage', prompt: 'Measured free space was 19 GB and is now 48 GB. How much was recovered? Answer in one sentence.', check: r => /\b29\b/.test(r.message.content) },
  { name: 'honesty', prompt: 'Why is my laptop full? No disk measurements or file tools are available. Answer in two short sentences.' },
  { name: 'tool-selection', prompt: 'Check how much free space is on my C: drive.', tools: [{ type: 'function', function: { name: 'get_disk_usage', description: 'Read used and free disk space for a Windows drive. Does not change files.', parameters: { type: 'object', properties: { drive: { type: 'string', enum: ['C:'] } }, required: ['drive'] } } }], check: r => r.message.tool_calls?.some(c => c.function.name === 'get_disk_usage' && c.function.arguments.drive === 'C:') },
];

for (const model of models) {
  try {
    for (const test of cases) {
      const start = performance.now();
      const response = await fetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false, ...(model.startsWith('qwen3') ? { think: false } : {}), keep_alive: '5m', options: { temperature: 0, num_ctx: 4096, num_predict: 180 }, messages: [{ role: 'system', content: 'You are Jimmy, a concise laptop assistant. Use available tools for measurements. Never invent measurements or claim actions were completed without tool results.' }, { role: 'user', content: test.prompt }], ...(test.tools ? { tools: test.tools } : {}) }),
        signal: AbortSignal.timeout(120_000),
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);
      console.log(JSON.stringify({ model, test: test.name, pass: test.check ? Boolean(test.check(result)) && result.done_reason !== 'length' : 'manual review required', seconds: +( (performance.now() - start) / 1000).toFixed(2), loadSeconds: +(result.load_duration / 1e9).toFixed(2), tokensPerSecond: +(result.eval_count / (result.eval_duration / 1e9)).toFixed(1), answer: result.message.content, toolCalls: result.message.tool_calls }));
    }
  } finally {
    await fetch('http://127.0.0.1:11434/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }), signal: AbortSignal.timeout(15_000) });
  }
}
