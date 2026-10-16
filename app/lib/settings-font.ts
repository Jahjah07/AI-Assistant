export const SETTINGS_FONT_STORAGE_KEY = "jimmy.settings-font";
export const MAX_FONT_BYTES = 1024 * 1024;
export const SETTINGS_FONTS = [
  { id: "system", label: "System default · recommended", family: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { id: "arial", label: "Arial", family: "Arial, Helvetica, sans-serif" },
  { id: "verdana", label: "Verdana", family: "Verdana, Geneva, sans-serif" },
  { id: "mono", label: "Monospace", family: "Consolas, monospace" },
  { id: "orbitron", label: "Orbitron · reactor style", family: "var(--font-orbitron), sans-serif" },
];
export type SettingsFont = { font: string; upload?: { name: string; data: string } };
const dataPrefix = "data:application/octet-stream;base64,";

export function savedSettingsFont(): string | null {
  try { return localStorage.getItem(SETTINGS_FONT_STORAGE_KEY); }
  catch { return null; }
}

export function parseSettingsFont(raw: string | null): SettingsFont {
  try {
    const value = JSON.parse(raw || "null");
    if (!value || !SETTINGS_FONTS.some(font => font.id === value.font) && value.font !== "custom") return { font: "system" };
    const upload = value.upload;
    const validUpload = upload && typeof upload.name === "string" && upload.name.length <= 200 &&
      typeof upload.data === "string" && upload.data.startsWith(dataPrefix) && upload.data.length <= dataPrefix.length + Math.ceil(MAX_FONT_BYTES / 3) * 4 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(upload.data.slice(dataPrefix.length));
    if (value.font === "custom" && !validUpload) return { font: "system" };
    return { font: value.font, ...(validUpload ? { upload: { name: upload.name, data: upload.data } } : {}) };
  } catch { return { font: "system" }; }
}

function save(settings: SettingsFont) {
  try { localStorage.setItem(SETTINGS_FONT_STORAGE_KEY, JSON.stringify(settings)); }
  catch { throw new Error("Could not save the font. Allow site storage or try a smaller font file."); }
  window.dispatchEvent(new Event("settings-font-changed"));
}

export function chooseSettingsFont(font: string) {
  const current = parseSettingsFont(savedSettingsFont());
  if (!SETTINGS_FONTS.some(item => item.id === font) && !(font === "custom" && current.upload)) throw new Error("Choose an available settings font.");
  save({ ...current, font });
}

export function removeUploadedSettingsFont() {
  const current = parseSettingsFont(savedSettingsFont());
  save({ font: current.font === "custom" ? "system" : current.font });
}

export async function uploadSettingsFont(file: File) {
  // shortcut: fonts are limited to 1 MiB for localStorage; use IndexedDB for larger uploads.
  if (!/\.(?:woff2?|ttf|otf)$/i.test(file.name)) throw new Error("Choose a WOFF, WOFF2, TTF or OTF font file.");
  if (!file.size || file.size > MAX_FONT_BYTES) throw new Error("Choose a non-empty font file up to 1 MiB.");
  const bytes = await file.arrayBuffer();
  try { await new FontFace("AssistantSettingsFont", bytes).load(); }
  catch { throw new Error("This file could not be loaded as a font. Try another font file."); }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the font file."));
    reader.readAsDataURL(new Blob([bytes], { type: "application/octet-stream" }));
  });
  save({ font: "custom", upload: { name: file.name.slice(0, 200), data } });
}
