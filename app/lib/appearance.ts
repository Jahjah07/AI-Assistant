export const DEFAULT_UI_COLOR = "#79e0e5";
export const UI_COLOR_STORAGE_KEY = "jimmy.ui-color";

export function validUiColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function savedUiColor() {
  try {
    const color = localStorage.getItem(UI_COLOR_STORAGE_KEY);
    return validUiColor(color) ? color : DEFAULT_UI_COLOR;
  } catch { return DEFAULT_UI_COLOR; }
}

export function saveUiColor(color: string) {
  if (!validUiColor(color)) throw new Error("Choose a valid UI color.");
  localStorage.setItem(UI_COLOR_STORAGE_KEY, color.toLowerCase());
  window.dispatchEvent(new Event("ui-color-changed"));
}
