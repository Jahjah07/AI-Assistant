"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { canvasDocument, canvasId, validCanvasContent, type CanvasContent, type CanvasDocument } from "./canvas";

export function useCanvasWorkspace() {
  const [document, setDocument] = useState<CanvasDocument | null>(null);
  const [inline, setInline] = useState(false);
  const [model, setModel] = useState<File | null>(null);
  const latest = useRef<CanvasDocument | null>(null);
  const session = useRef("");
  const channel = useRef<BroadcastChannel | null>(null);
  const popup = useRef<Window | null>(null);
  const openModel = useCallback(async (file: File) => {
    const { validateModelFile } = await import("./model-viewer");
    validateModelFile(file);
    await window.jimmyDesktop?.expand(true);
    setModel(file); setInline(false);
    popup.current?.close();
    void window.jimmyDesktop?.closeCanvas?.();
    window.focus();
  }, []);
  const connect = useCallback(() => {
    if (!session.current) session.current = canvasId();
    if (!channel.current) {
      channel.current = new BroadcastChannel(`jimmy-canvas:${session.current}`);
      channel.current.onmessage = event => {
        if (event.data?.type === "ready") channel.current?.postMessage({ type: "document", document: latest.current });
        if (event.data?.type === "model" && event.data.file instanceof File) void openModel(event.data.file).catch(() => {});
      };
    }
    return `/canvas?session=${session.current}`;
  }, [openModel]);
  useEffect(() => () => { channel.current?.close(); }, []);
  const show = useCallback(() => {
    const url = connect();
    if (window.jimmyDesktop?.openCanvas) {
      void window.jimmyDesktop.openCanvas(session.current).catch(async () => { await window.jimmyDesktop?.expand(true); setInline(true); });
      return;
    }
    popup.current = window.open(url, `jimmy-canvas-${session.current}`, "popup,width=1200,height=820");
    if (popup.current) { setInline(false); popup.current.focus(); }
    else setInline(true);
  }, [connect]);
  useEffect(() => window.jimmyDesktop?.onOpenCanvas?.(show), [show]);
  const publish = useCallback((content: CanvasContent | CanvasDocument, open = true) => {
    if (!validCanvasContent(content)) throw new Error("The data could not be formatted for the canvas.");
    const next = "id" in content ? content as CanvasDocument : canvasDocument(content);
    latest.current = next; setDocument(next); connect();
    channel.current?.postMessage({ type: "document", document: next });
    if (open) show();
    return next;
  }, [connect, show]);
  const hide = useCallback(() => {
    setInline(false); popup.current?.close();
    return window.jimmyDesktop?.closeCanvas?.();
  }, []);
  const closeModel = useCallback(() => setModel(null), []);
  return { document, inline, show, publish, hide, model, openModel, closeModel };
}
