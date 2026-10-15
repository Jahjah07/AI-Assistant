import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const file = path.join(process.cwd(), "storage", "model-settings.json");
export async function keepModelsLoaded(): Promise<boolean> {
  try { return JSON.parse(await readFile(file, "utf8")).keepLoaded === true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
export async function saveKeepModelsLoaded(keepLoaded: boolean) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify({ keepLoaded }));
  await rename(`${file}.tmp`, file);
}
