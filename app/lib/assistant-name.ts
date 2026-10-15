"use client";

import { useSyncExternalStore } from "react";
import { ASSISTANT_NAME_STORAGE_KEY, DEFAULT_ASSISTANT_NAME, savedAssistantName, validAssistantName } from "./assistant";

function subscribe(changed: () => void) {
  window.addEventListener("storage", changed);
  window.addEventListener("assistant-name-changed", changed);
  return () => {
    window.removeEventListener("storage", changed);
    window.removeEventListener("assistant-name-changed", changed);
  };
}

export function useAssistantName() {
  return useSyncExternalStore(subscribe, savedAssistantName, () => DEFAULT_ASSISTANT_NAME);
}

export function saveAssistantName(value: string) {
  const name = value.trim().replace(/\s+/g, " ");
  if (!validAssistantName(name)) throw new Error("Use 1–24 characters: start with a letter, then letters, numbers, spaces, apostrophes or hyphens.");
  localStorage.setItem(ASSISTANT_NAME_STORAGE_KEY, name);
  window.dispatchEvent(new Event("assistant-name-changed"));
  return name;
}
