import { protectApiRequest } from "../_security";
import { readJsonObject } from "../_limits";
import { activitySettings, journalDays, localDay, readJournal, recordActivity, saveActivitySettings, validateSettings } from "./store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = protectApiRequest(request, { scope: "activity-read", limit: 90, loopbackOnly: true });
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const settings = await activitySettings();
    if (url.searchParams.get("config") === "1") return Response.json({ settings }, { headers: { "Cache-Control": "no-store" } });
    const day = url.searchParams.get("day") || localDay();
    return Response.json({ settings, days: await journalDays(), day, journal: await readJournal(day) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Could not read the activity journal." }, { status: 400 }); }
}

export async function POST(request: Request) {
  const denied = protectApiRequest(request, { scope: "activity-write", limit: 180, loopbackOnly: true, allowExtensionOrigin: true });
  if (denied) return denied;
  const body = await readJsonObject(request, 8192);
  if (!body.ok) return body.response;
  const value = body.value;
  try {
    if (value.action === "settings" && !request.headers.get("origin")?.startsWith("chrome-extension:")) {
      const settings = validateSettings(value);
      await saveActivitySettings(settings);
      return Response.json({ settings });
    }
    if (value.action !== "record" || !["window", "file", "git", "browser"].includes(String(value.kind)) ||
      typeof value.text !== "string" || !value.text.trim() || value.text.length > 4000) throw new Error("Invalid activity entry.");
    if (request.headers.get("origin")?.startsWith("chrome-extension:") && value.kind !== "browser") throw new Error("Browser extensions may only record browser activity.");
    if (value.kind === "browser") {
      if (typeof value.url !== "string" || value.url.length > 2048) throw new Error("Invalid page URL.");
      const url = new URL(value.url);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid page URL.");
      url.search = ""; url.hash = "";
      value.text = `${value.text} — ${url.href}`;
    }
    const settings = await activitySettings();
    return Response.json({ recorded: await recordActivity(String(value.kind), value.text as string), enabled: settings.enabled && (value.kind !== "browser" || settings.browser) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Activity failed." }, { status: 400 }); }
}
