import { readJsonObject } from "../_limits";
import { protectApiRequest } from "../_security";
import type { CanvasContent } from "../../lib/canvas";
import { fileSize, LOCAL_FILES_SOURCE } from "../../lib/local-files";
import { driveSpace, FileAccessError, laptopRoots, previewTokens, readModelToken, scanFiles, selectRoots } from "./scan";
import { interpretFileRequest, validateFileContext } from "./intent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let scanning = false;
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const denied = protectApiRequest(request, { scope: "local-files", limit: 30, loopbackOnly: true });
  if (denied) return denied;
  const body = await readJsonObject(request, 12000);
  if (!body.ok) return body.response;
  const { action, scope = "computer", query, token } = body.value;
  try {
    if (action === "interpret") {
      const { text, previous } = body.value;
      if (typeof text !== "string" || !text.trim() || text.length > 4000 || !validateFileContext(previous)) throw new FileAccessError("Provide a short laptop request and valid conversation context.");
      try { return Response.json(await interpretFileRequest(text, previous, request.signal), { headers }); }
      catch {
        if (request.signal.aborted) throw new Error("Cancelled");
        return Response.json({ error: "I couldn't interpret that laptop request. Check that the local Ollama model is available, then try again. Nothing was scanned or changed." }, { status: 503, headers });
      }
    }
    if (action === "model") {
      if (typeof token !== "string" || !/^[a-f0-9-]{36}$/.test(token)) throw new FileAccessError("Invalid model preview.");
      const bytes = await readModelToken(token);
      return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff" } });
    }
    if (action !== "search" && action !== "storage") throw new FileAccessError("Choose file search or storage analysis.");
    if (typeof scope !== "string" || !scope.trim() || scope.length > 1000) throw new FileAccessError("Choose a local folder to scan.");
    if (action === "search" && (typeof query !== "string" || !query.trim() || query.length > 200)) throw new FileAccessError("Give a filename of 1–200 characters.");
    if (scanning) return Response.json({ error: "A laptop scan is already running. Wait for it to finish or cancel it." }, { status: 409, headers });
    scanning = true;
    try {
      const roots = await selectRoots(scope, await laptopRoots());
      const result = await scanFiles(roots, action === "search" ? query as string : undefined, request.signal);
      const note = [
        `Scanned ${result.visited.toLocaleString()} entries in ${(result.milliseconds / 1000).toFixed(1)} seconds.`,
        result.partial ? "Partial scan: the 20-second or 150,000-entry limit was reached. Scan a specific folder for more detail." : "Finished scanning the selected folders.",
        result.skipped ? `${result.skipped.toLocaleString()} inaccessible entries, links, or special files were skipped.` : "",
        "Read-only metadata scan; no files were changed. File contents and paths are not sent to an AI model.",
      ].filter(Boolean).join(" ");
      let canvas: CanvasContent, reply: string;
      if (action === "search") {
        const entries = previewTokens(result.files);
        canvas = { title: `${result.suggested ? "Possible matches for" : "Files matching"} ${query}`.slice(0, 200), source: LOCAL_FILES_SOURCE, note: `${note}${result.suggested ? " No exact filename match; these suggestions share part of the requested name. Check the filenames before choosing a preview." : ""}${result.matches > entries.length ? ` Showing ${entries.length} of ${result.matches} matches.` : ""}`, blocks: [{ type: "files", entries, autoPreview: !result.suggested && entries.length === 1 && result.matches === 1 && !result.partial }] };
        reply = result.suggested ? `No exact filename match, but I found ${result.matches} possible match${result.matches === 1 ? "" : "es"} sharing part of that name. Check the filenames on your canvas and choose Show model for the one you want.`
          : result.matches ? `Found ${result.matches}${result.partial ? " so far" : ""} matching file${result.matches === 1 ? "" : "s"}. ${entries.length === 1 && entries[0].modelToken && !result.partial ? "Your model is opening in the dashboard." : "The results are on your canvas."}`
          : `No matching files were found${result.partial ? " in the part I could scan" : " in the selected folders"}. ${result.partial ? "Try a more specific folder." : "Try a shorter filename or a different folder."}`;
        if (result.partial || result.skipped) reply += " Some locations were not scanned; see the coverage note on the canvas.";
      } else {
        const disks = await driveSpace(roots);
        canvas = { title: "Laptop storage", source: LOCAL_FILES_SOURCE, note: `${note} Folder totals and file sizes are logical sizes, not allocated disk usage; cloud, sparse and hard-linked files can differ. Folder rows group the scanned files under each selected root's immediate subfolders. System files, backups and reserved space may explain additional used space.`, blocks: [
          { type: "table", title: "Disk capacity for selected locations", columns: ["Location", "Capacity", "Used", "Available"], rows: disks.map(disk => [disk.root, disk.total === null ? "Unavailable" : fileSize(disk.total), disk.total === null || disk.free === null ? "Unavailable" : fileSize(disk.total - disk.free), disk.free === null ? "Unavailable" : fileSize(disk.free)]) },
          { type: "table", title: "Largest folders in scanned area", columns: ["Folder", "Scanned file sizes"], rows: result.folders.map(([folder, bytes]) => [folder, fileSize(bytes)]) },
          { type: "files", title: "Largest files in scanned area", entries: previewTokens(result.largest) },
        ] };
        const largest = result.folders[0];
        reply = `${result.partial ? "This is a partial storage scan." : "Storage scan finished."} ${largest ? `The largest folder in the scanned area contains ${fileSize(largest[1])} of files.` : "No accessible files were counted."} The largest folders and files are on your canvas. ${result.skipped ? "Some entries were inaccessible or skipped." : ""} Nothing was deleted.`;
      }
      return Response.json({ canvas, reply }, { headers });
    } finally { scanning = false; }
  } catch (error) {
    if (request.signal.aborted) return Response.json({ error: "Laptop scan cancelled." }, { status: 499, headers });
    return Response.json({ error: error instanceof FileAccessError ? error.message : "Could not access that local file or folder. It may have moved or require permission." }, { status: error instanceof FileAccessError ? error.status : 500, headers });
  }
}
