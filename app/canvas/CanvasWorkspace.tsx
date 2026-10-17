"use client";

import { useEffect, useRef, useState } from "react";
import DataCanvas from "../components/DataCanvas";
import { validCanvasDocument, type CanvasDocument } from "../lib/canvas";
import { useAssistantName } from "../lib/assistant-name";

export default function CanvasWorkspace({ session }: { session: string | null }) {
  const name = useAssistantName();
  useEffect(() => { window.document.title = `${name} | Data Canvas`; }, [name]);
  const [document, setDocument] = useState<CanvasDocument | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (!session) return;
    const channel = new BroadcastChannel(`jimmy-canvas:${session}`);
    channelRef.current = channel;
    channel.onmessage = event => {
      if (event.data?.type === "document" && (event.data.document === null || validCanvasDocument(event.data.document))) setDocument(event.data.document);
    };
    channel.postMessage({ type: "ready" });
    return () => { channel.close(); channelRef.current = null; };
  }, [session]);
  return <DataCanvas document={document} onClose={() => window.close()} onModel={file => {
    if (!channelRef.current) throw new Error("Open the canvas from Jimmy's dashboard to display a model.");
    channelRef.current.postMessage({ type: "model", file });
  }} />;
}
