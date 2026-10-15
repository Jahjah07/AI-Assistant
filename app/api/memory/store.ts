import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type MemoryItem = {
  id: string;
  text: string;
  createdAt: string;
};

const LEGACY_MEMORY_PATH = join(process.cwd(), "storage", "johnny-memory.json");
const MEMORY_SECTION_START = "<!-- johnny-memory:start -->";
const MEMORY_SECTION_END = "<!-- johnny-memory:end -->";
const JSON_FENCE_START = "```json";
const JSON_FENCE_END = "```";
const DEFAULT_NOTE_PATH = "Jimmy.md";
const MAX_MEMORY_ITEMS = 500;

export class MemoryLimitError extends Error {
  constructor() {
    super(`Jimmy can store at most ${MAX_MEMORY_ITEMS} memories.`);
    this.name = "MemoryLimitError";
  }
}

let operationQueue: Promise<void> = Promise.resolve();

function isMemoryItem(value: unknown): value is MemoryItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeMemory = value as Partial<MemoryItem>;

  return (
    typeof maybeMemory.id === "string" &&
    typeof maybeMemory.text === "string" &&
    typeof maybeMemory.createdAt === "string"
  );
}

function parseMemoryJson(raw: string) {
  const parsed = JSON.parse(raw) as { memories?: unknown };

  if (!Array.isArray(parsed.memories) || !parsed.memories.every(isMemoryItem)) {
    throw new Error("Saved memory has an invalid format; the source was left untouched.");
  }
  return parsed.memories;
}

function getObsidianNotePath() {
  const configuredVaultPath = process.env.OBSIDIAN_VAULT_PATH?.trim();

  if (!configuredVaultPath) {
    return null;
  }

  if (!isAbsolute(configuredVaultPath)) {
    throw new Error("OBSIDIAN_VAULT_PATH must be an absolute path.");
  }

  const vaultPath = resolve(configuredVaultPath);
  const configuredNotePath =
    process.env.OBSIDIAN_MEMORY_NOTE?.trim() || DEFAULT_NOTE_PATH;

  if (isAbsolute(configuredNotePath)) {
    throw new Error("OBSIDIAN_MEMORY_NOTE must be relative to the vault.");
  }

  const notePath = resolve(vaultPath, configuredNotePath);
  const relativeNotePath = relative(vaultPath, notePath);

  if (
    !relativeNotePath ||
    relativeNotePath.startsWith("..") ||
    isAbsolute(relativeNotePath)
  ) {
    throw new Error("OBSIDIAN_MEMORY_NOTE must point to a file inside the vault.");
  }

  if (!notePath.toLowerCase().endsWith(".md")) {
    throw new Error("OBSIDIAN_MEMORY_NOTE must point to a Markdown file.");
  }

  return notePath;
}

async function readOptionalFile(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}

function readManagedMemories(note: string) {
  const sectionStart = note.indexOf(MEMORY_SECTION_START);
  const sectionEnd = note.indexOf(MEMORY_SECTION_END, sectionStart + 1);

  if (sectionStart === -1 || sectionEnd === -1) {
    return null;
  }

  const section = note.slice(sectionStart, sectionEnd);
  const fenceStart = section.indexOf(JSON_FENCE_START);
  const jsonStart = fenceStart + JSON_FENCE_START.length;
  const fenceEnd = section.indexOf(JSON_FENCE_END, jsonStart);

  if (fenceStart === -1 || fenceEnd === -1) {
    throw new Error("Jimmy.md has an invalid managed memory section.");
  }

  return parseMemoryJson(section.slice(jsonStart, fenceEnd).trim());
}

function renderManagedSection(memories: MemoryItem[]) {
  return [
    MEMORY_SECTION_START,
    "## Jimmy Memory",
    "",
    "> This section is managed by Jimmy. Each entry remains searchable in Obsidian.",
    "",
    JSON_FENCE_START,
    JSON.stringify({ memories }, null, 2),
    JSON_FENCE_END,
    MEMORY_SECTION_END,
  ].join("\n");
}

function updateManagedSection(note: string, memories: MemoryItem[]) {
  const nextSection = renderManagedSection(memories);
  const sectionStart = note.indexOf(MEMORY_SECTION_START);
  const sectionEnd = note.indexOf(MEMORY_SECTION_END, sectionStart + 1);

  if (sectionStart === -1 && sectionEnd === -1) {
    const separator = note.trimEnd() ? "\n\n" : "";

    return `${note.trimEnd()}${separator}${nextSection}\n`;
  }

  if (sectionStart === -1 || sectionEnd === -1) {
    throw new Error("Jimmy.md has incomplete managed memory markers.");
  }

  const afterSection = sectionEnd + MEMORY_SECTION_END.length;

  return `${note.slice(0, sectionStart)}${nextSection}${note.slice(afterSection)}`;
}

async function writeFileAtomically(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, contents, "utf8");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(temporaryPath, path);
        return;
      } catch (error) {
        const canRetry =
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error.code === "EPERM" || error.code === "EBUSY");

        if (!canRetry || attempt === 4) throw error;

        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, 50 * (attempt + 1)),
        );
      }
    }

  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function readLegacyMemories() {
  const raw = await readOptionalFile(LEGACY_MEMORY_PATH);

  return raw ? parseMemoryJson(raw) : [];
}

async function openDatabase() {
  const path = join(process.cwd(), "storage", "jimmy-memory.sqlite");
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, text TEXT NOT NULL, createdAt TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY);");
    if (!database.prepare("SELECT key FROM metadata WHERE key = 'legacy-imported'").get()) {
      const memories = await readLegacyMemories();
      database.exec("BEGIN IMMEDIATE");
      const insert = database.prepare("INSERT OR IGNORE INTO memories VALUES (?, ?, ?)");
      for (const memory of memories) insert.run(memory.id, memory.text, memory.createdAt);
      database.exec("INSERT OR IGNORE INTO metadata VALUES ('legacy-imported'); COMMIT");
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

async function readMemoryState() {
  const obsidianNotePath = getObsidianNotePath();

  if (!obsidianNotePath) {
    return { path: "", document: "", obsidian: false, memories: await readSqliteMemories() };
  }

  const document = (await readOptionalFile(obsidianNotePath)) || "";
  const managedMemories = readManagedMemories(document);

  return {
    path: obsidianNotePath,
    document,
    memories: managedMemories ?? (await readSqliteMemories()),
    obsidian: true,
    needsMigration: managedMemories === null,
  };
}

async function persistMemoryState(
  state: Awaited<ReturnType<typeof readMemoryState>>,
  memories: MemoryItem[],
) {
  if (state.obsidian) {
    await writeFileAtomically(
      state.path,
      updateManagedSection(state.document, memories),
    );
    return;
  }

  const database = await openDatabase();
  try {
    database.exec("BEGIN IMMEDIATE; DELETE FROM memories");
    const insert = database.prepare("INSERT INTO memories VALUES (?, ?, ?)");
    for (const memory of memories) insert.run(memory.id, memory.text, memory.createdAt);
    database.exec("COMMIT");
  } finally { database.close(); }
}

async function readSqliteMemories() {
  const database = await openDatabase();
  try {
    return database.prepare("SELECT id, text, createdAt FROM memories ORDER BY rowid").all() as MemoryItem[];
  } finally { database.close(); }
}

function runExclusively<T>(operation: () => Promise<T>) {
  // shortcut: one Jimmy server writes memory, use database-level mutations before running multiple servers.
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );

  return result;
}

export function getMemoryBackend() {
  return getObsidianNotePath() ? "obsidian" : "sqlite";
}

export function getMemories() {
  return runExclusively(async () => {
    const state = await readMemoryState();

    if (state.obsidian && state.needsMigration && state.memories.length > 0) {
      await persistMemoryState(state, state.memories);
    }

    return state.memories;
  });
}

export function addMemory(text: string) {
  return runExclusively(async () => {
    const state = await readMemoryState();

    if (state.memories.length >= MAX_MEMORY_ITEMS) {
      throw new MemoryLimitError();
    }

    const memory: MemoryItem = {
      id: randomUUID(),
      text,
      createdAt: new Date().toISOString(),
    };

    const memories = [...state.memories, memory];
    await persistMemoryState(state, memories);

    return memory;
  });
}

export function clearMemories() {
  return runExclusively(async () => {
    const state = await readMemoryState();
    await persistMemoryState(state, []);
  });
}

export function forgetMemory(query: string) {
  return runExclusively(async () => {
    const state = await readMemoryState();
    const normalizedQuery = query.toLowerCase();
    const kept = state.memories.filter(
      (memory) => !memory.text.toLowerCase().includes(normalizedQuery),
    );

    await persistMemoryState(state, kept);

    return state.memories.length - kept.length;
  });
}
