import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const file = path.join(process.cwd(), "storage", "model-settings.json");
export type ModelSettings = { keepLoaded: boolean; model: string };
export async function readModelSettings(): Promise<ModelSettings> {
  const fallback = { keepLoaded: false, model: process.env.OLLAMA_MODEL || "qwen3:4b-instruct" };
  try {
    const saved = JSON.parse(await readFile(file, "utf8"));
    if (!saved || typeof saved !== "object" || Array.isArray(saved) || (saved.model !== undefined && (typeof saved.model !== "string" || !saved.model.trim()))) throw new Error("Saved model settings are invalid. No settings were overwritten.");
    return { keepLoaded: saved.keepLoaded === true, model: saved.model || fallback.model };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw error; }
}
export async function chatModel(): Promise<string> { return (await readModelSettings()).model; }
export async function keepModelsLoaded(): Promise<boolean> {
  return (await readModelSettings()).keepLoaded;
}
export async function saveModelSettings(settings: ModelSettings) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(settings));
  await rename(`${file}.tmp`, file);
}
export async function saveKeepModelsLoaded(keepLoaded: boolean) {
  await saveModelSettings({ ...await readModelSettings(), keepLoaded });
}
