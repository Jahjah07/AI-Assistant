export type DesktopState = {
  expanded: boolean;
  muted: boolean;
  awake: boolean;
  phase: string;
  error: string;
};

declare global {
  interface Window {
    jimmyDesktop?: {
      getState(): Promise<DesktopState>;
      expand(value: boolean): Promise<DesktopState>;
      mute(value: boolean): Promise<DesktopState>;
      hide(): Promise<void>;
      captureScreen(): Promise<string>;
      wake(): Promise<DesktopState>;
      shutdown(): Promise<boolean>;
      openCanvas(session: string): Promise<void>;
      closeCanvas(): Promise<void>;
      setAssistantName(name: string): Promise<void>;
      onState(callback: (state: DesktopState) => void): () => void;
    };
  }
}

export function isJimmyShutdown(input: string): boolean {
  const text = input.toLowerCase().trim()
    .replace(/^(?:hey\s+)?jimmy[\s,.:!-]*/, '')
    .replace(/^please\s+/, '').replace(/[.!?,]+$/, '').trim();
  return /^(?:shut\s*down(?:\s+(?:jimmy|yourself))?|turn\s+yourself\s+off)$/.test(text);
}

export async function requestLocalApp(command: { action: string; [key: string]: unknown }) {
  if (["open", "open-link", "search", "open-youtube"].includes(command.action)) {
    await window.jimmyDesktop?.expand(false);
  }
  return fetch("/api/local-app", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
}
