import type { MemoryItem } from "../api/memory/store";

const STOP_WORDS = new Set("a an the and or but if to of in on at for from with by as is are was were be been being do does did have has had can could would should will may might i me my mine you your yours we us our they them their it its this that these those what which who when where why how about please tell explain know remember saved memory memories jimmy s t".split(" "));

function terms(text: string) {
  return new Set((text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter(word => word.length > 1 && !STOP_WORDS.has(word)));
}

export function selectRelevantMemories(memories: MemoryItem[], messages: { role: string; content: string }[], includeRecent = true): MemoryItem[] {
  const users = messages.filter(message => message.role === "user");
  const latest = users.at(-1)?.content || "";
  const query = new Map([...terms(latest)].map(term => [term, 3]));
  // shortcut: keyword matching misses synonyms; add semantic retrieval if recall needs it.
  if (/\b(?:it|its|that|those|them|this)\b|^(?:and|also|continue|why|how so|what about|how about|tell me more)\b/i.test(latest.trim())) {
    for (const term of terms(users.at(-2)?.content || "")) {
      if (!query.has(term)) query.set(term, 1);
    }
  }
  const documents = memories.map(memory => terms(memory.text));
  const weights = new Map([...query].map(([term, weight]) => [term,
    weight * (1 + Math.log((memories.length + 1) / (1 + documents.filter(document => document.has(term)).length))),
  ]));
  const ranked = memories.map((memory, index) => ({
    memory, index,
    score: [...weights].reduce((sum, [term, weight]) => sum + (documents[index].has(term) ? weight : 0), 0)
      / Math.sqrt(Math.max(1, documents[index].size)),
  })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.index - a.index);
  const relevant = ranked.slice(0, 25).map(item => item.memory);
  const selected = new Set(relevant.map(memory => memory.id));
  return includeRecent ? [...relevant, ...memories.slice(-5).reverse().filter(memory => !selected.has(memory.id))] : relevant;
}
