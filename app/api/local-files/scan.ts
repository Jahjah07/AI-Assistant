import { opendir, lstat, realpath, statfs, open } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { modelFilename } from "../../lib/local-files";

export type FoundFile = { name: string; path: string; bytes: number; modelToken?: string };
type Laptop = { home: string; folders: Record<string, string>; drives: string[] };
const tokens = new Map<string, { path: string; expires: number }>();
const MAX_MODEL_BYTES = 50 * 1024 * 1024;
export class FileAccessError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function laptopRoots(): Promise<Laptop> {
  const home = os.homedir();
  const folders: Record<string, string> = Object.fromEntries(["Downloads", "Documents", "Desktop", "Pictures", "Videos", "Music"].map(name => [name.toLowerCase(), path.join(/* turbopackIgnore: true */ home, name)]));
  if (process.platform !== "win32") return { home, folders, drives: [home] };
  const script = "$f=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders'; $folders=@{}; @{downloads='{374DE290-123F-4565-9164-39C4925E467B}';documents='Personal';desktop='Desktop';pictures='My Pictures';videos='My Video';music='My Music'}.GetEnumerator() | ForEach-Object { $v=$f.($_.Value); if($v){$folders[$_.Key]=[Environment]::ExpandEnvironmentVariables($v)} }; @{folders=$folders;drives=@([IO.DriveInfo]::GetDrives() | Where-Object {$_.IsReady -and $_.DriveType -eq 'Fixed'} | ForEach-Object {$_.RootDirectory.FullName})} | ConvertTo-Json -Compress";
  const { stdout } = await promisify(execFile)(path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 5000, maxBuffer: 16384 });
  const result = JSON.parse(stdout);
  if (!Array.isArray(result.drives) || !result.drives.length) throw new FileAccessError("No local fixed drives were found.", 503);
  return { home, folders: { ...folders, ...result.folders }, drives: result.drives };
}

function within(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === "" || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

export async function selectRoots(scope: string, laptop: Laptop) {
  const key = scope.toLowerCase().trim().replace(/^(?:my|the)\s+/, "").replace(/\s+folder$/, "");
  if (["computer", "laptop", "pc", "all drives", "storage"].includes(key)) return laptop.drives;
  const drive = key.match(/^([a-z])(?::| drive)?$/i);
  const requested = ["home", "user", "user folder"].includes(key) ? laptop.home
    : laptop.folders[key === "download" ? "downloads" : key] || (drive ? `${drive[1].toUpperCase()}:\\` : scope);
  if (!path.isAbsolute(requested) || requested.startsWith("\\\\")) throw new FileAccessError("Choose Downloads, Documents, Desktop, Pictures, Videos, Music, laptop, or a full local folder path.");
  let resolved: string;
  try { resolved = await realpath(requested); }
  catch { throw new FileAccessError("That folder was not found or is not accessible.", 404); }
  if (!laptop.drives.some(drive => within(drive, resolved))) throw new FileAccessError("Only local fixed drives can be scanned.", 403);
  if (!(await lstat(resolved)).isDirectory()) throw new FileAccessError("Choose a folder to scan.");
  return [resolved];
}

const normalized = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
export async function scanFiles(roots: string[], query: string | undefined, signal: AbortSignal, limits = { entries: 150000, milliseconds: 20000 }) {
  const started = Date.now();
  const files: FoundFile[] = [], largest: FoundFile[] = [];
  const suggestions: FoundFile[] = [];
  let suggestedMatches = 0;
  const folders = new Map<string, number>();
  let visited = 0, skipped = 0, totalBytes = 0, matches = 0, partial = false;
  const needle = query === undefined ? "" : normalized(query);
  const words = (query?.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(word => word.length >= 4 && !["file", "files", "model", "models", "folder", "please", "called", "named", "find", "show"].includes(word));
  if (query !== undefined && !needle) throw new FileAccessError("Give a filename containing letters or numbers.");
  const pending = [...roots].reverse().map(root => ({ directory: root, group: "" }));
  outer: while (pending.length) {
    signal.throwIfAborted();
    if (visited >= limits.entries || Date.now() - started >= limits.milliseconds) { partial = true; break; }
    const { directory, group } = pending.pop()!;
    try {
      const children: typeof pending = [];
      const handle = await opendir(directory);
      for await (const entry of handle) {
        signal.throwIfAborted();
        if (++visited > limits.entries || Date.now() - started >= limits.milliseconds) { partial = true; break outer; }
        const filename = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) { skipped++; continue; }
        if (entry.isDirectory()) { children.push({ directory: filename, group: group || filename }); continue; }
        if (!entry.isFile()) { skipped++; continue; }
        const exact = query !== undefined && normalized(entry.name).includes(needle);
        if (query !== undefined && !exact && !words.some(word => normalized(entry.name).includes(word))) continue;
        try {
          const info = await lstat(filename);
          if (!info.isFile() || info.isSymbolicLink()) { skipped++; continue; }
          const file = { name: entry.name, path: filename, bytes: info.size };
          if (query !== undefined) {
            if (exact) { matches++; if (files.length < 100) files.push(file); }
            else { suggestedMatches++; if (suggestions.length < 20) suggestions.push(file); }
          } else {
            totalBytes += info.size;
            const folder = group || directory;
            folders.set(folder, (folders.get(folder) || 0) + info.size);
            largest.push(file);
            largest.sort((a, b) => b.bytes - a.bytes);
            if (largest.length > 30) largest.pop();
          }
        } catch { skipped++; }
      }
      const priority = (directory: string) => ["users", path.basename(os.homedir()).toLowerCase(), "downloads", "documents", "desktop"].includes(path.basename(directory).toLowerCase()) ? 1 : 0;
      pending.push(...children.sort((a, b) => priority(a.directory) - priority(b.directory)));
    } catch (error) {
      if (signal.aborted) throw error;
      skipped++;
    }
  }
  const suggested = query !== undefined && matches === 0 && suggestedMatches > 0;
  return { files: suggested ? suggestions : files, largest, folders: [...folders].sort((a, b) => b[1] - a[1]).slice(0, 30), visited, skipped, totalBytes, matches: suggested ? suggestedMatches : matches, suggested, partial, milliseconds: Date.now() - started };
}

export async function driveSpace(roots: string[]) {
  return Promise.all(roots.map(async root => {
    try {
      const stats = await statfs(root);
      return { root, total: stats.blocks * stats.bsize, free: stats.bavail * stats.bsize };
    } catch { return { root, total: null, free: null }; }
  }));
}

export function previewTokens(files: FoundFile[]) {
  const now = Date.now();
  for (const [token, file] of tokens) if (file.expires < now) tokens.delete(token);
  return files.map(file => {
    if (!modelFilename(file.name) || file.bytes <= 0 || file.bytes > MAX_MODEL_BYTES) return file;
    while (tokens.size >= 1000) tokens.delete(tokens.keys().next().value!);
    const token = randomUUID();
    tokens.set(token, { path: file.path, expires: now + 15 * 60000 });
    return { ...file, modelToken: token };
  });
}

export async function readModelToken(token: string) {
  const entry = tokens.get(token);
  if (!entry || entry.expires < Date.now()) throw new FileAccessError("This preview expired. Find the file again.", 404);
  const resolved = await realpath(entry.path);
  if (resolved !== entry.path || !modelFilename(resolved)) throw new FileAccessError("The file moved or changed. Find it again.", 409);
  const file = await open(resolved, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size <= 0 || info.size > MAX_MODEL_BYTES) throw new FileAccessError("Choose a non-empty 3D model up to 50 MB.", 413);
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new FileAccessError("The model changed while being read. Try again.", 409);
      offset += bytesRead;
    }
    return bytes;
  } finally { await file.close(); }
}
