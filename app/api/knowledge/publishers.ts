export type Publisher = { name: string; aliases: string[]; docs: string; evidence: string; website?: string };
const sources: [string, string[], string][] = [
  ["Python", ["python"], "https://docs.python.org/3/"],
  ["React", ["react", "reactjs", "react.js"], "https://react.dev/"],
  ["Next.js", ["next.js", "nextjs", "next js"], "https://nextjs.org/docs"],
  ["Node.js", ["node.js", "nodejs", "node js"], "https://nodejs.org/api/"],
  ["TypeScript", ["typescript"], "https://www.typescriptlang.org/docs/"],
  ["JavaScript", ["javascript"], "https://developer.mozilla.org/en-US/docs/Web/JavaScript"],
  ["Docker", ["docker"], "https://docs.docker.com/"],
  ["Git", ["git"], "https://git-scm.com/docs"],
  ["n8n", ["n8n"], "https://docs.n8n.io/"],
  ["PostgreSQL", ["postgresql", "postgres"], "https://www.postgresql.org/docs/"],
  ["FastAPI", ["fastapi"], "https://fastapi.tiangolo.com/"],
  ["Django", ["django"], "https://docs.djangoproject.com/"],
  ["Flask", ["flask"], "https://flask.palletsprojects.com/"],
  ["SQLite", ["sqlite"], "https://www.sqlite.org/docs.html"],
  ["Ollama", ["ollama"], "https://docs.ollama.com/"],
  ["Obsidian", ["obsidian"], "https://help.obsidian.md/"],
  ["Google Sheets", ["google sheets", "sheets api"], "https://developers.google.com/workspace/sheets/api"],
  ["Gmail", ["gmail"], "https://developers.google.com/workspace/gmail/api"],
  ["GitHub", ["github"], "https://docs.github.com/"],
  ["Supabase", ["supabase"], "https://supabase.com/docs"],
  ["Vite", ["vite"], "https://vite.dev/guide/"],
  ["Tailwind CSS", ["tailwind", "tailwindcss"], "https://tailwindcss.com/docs"],
  ["Slack", ["slack"], "https://docs.slack.dev/"],
  ["Telegram", ["telegram"], "https://core.telegram.org/bots/api"],
  ["Shopify", ["shopify"], "https://shopify.dev/docs"],
];
export const publishers: Publisher[] = sources.map(([name, aliases, docs]) => ({ name, aliases, docs, evidence: "Maintained publisher documentation directory" }));
export function mentionedPublishers(text: string) {
  return publishers.filter(item => item.aliases.some(alias => new RegExp(`(?:^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`, "i").test(text)));
}
export function publisherForUrl(input: string): Publisher | undefined {
  const url = new URL(input);
  return publishers.find(item => {
    const docs = new URL(item.docs);
    return url.hostname === docs.hostname && (url.pathname === docs.pathname.replace(/\/$/, "") || url.pathname.startsWith(docs.pathname.endsWith("/") ? docs.pathname : docs.pathname + "/"));
  });
}
