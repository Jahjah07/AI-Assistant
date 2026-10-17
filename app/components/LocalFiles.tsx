"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasBlock } from "../lib/canvas";
import { fileSize, loadLocalModel } from "../lib/local-files";
type FileEntry = Extract<CanvasBlock, { type: "files" }>["entries"][number];

export default function LocalFiles({ block, onPreview }: { block: Extract<CanvasBlock, { type: "files" }>; onPreview: (file: File) => void | Promise<void> }) {
  const [loading, setLoading] = useState(block.autoPreview ? block.entries[0]?.modelToken || "" : "");
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const preview = useCallback((entry: FileEntry) => {
    if (!entry.modelToken) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    return loadLocalModel(entry, controller.signal).then(async file => {
      if (!controller.signal.aborted) await onPreview(file);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not read this model.");
    }).finally(() => { if (active.current === controller) setLoading(""); });
  }, [onPreview]);
  useEffect(() => {
    if (block.autoPreview && block.entries.length === 1) void preview(block.entries[0]);
    return () => { active.current?.abort(); };
  }, [block, preview]);
  return <>
    <div className="canvas-table-scroll" tabIndex={0} role="region" aria-label={block.title || "Local files"}>
      <table><thead><tr><th scope="col">File</th><th scope="col">Location</th><th scope="col">Size</th><th scope="col">3D preview</th></tr></thead>
        <tbody>{block.entries.map((entry, index) => <tr key={index}><td>{entry.name}</td><td>{entry.path}</td><td>{fileSize(entry.bytes)}</td><td>{entry.modelToken ? <button className="canvas-launch" type="button" disabled={!!loading} onClick={() => { setLoading(entry.modelToken!); setError(""); void preview(entry); }} aria-label={`Preview ${entry.name}`}>{loading === entry.modelToken ? "Opening…" : "Show model"}</button> : "—"}</td></tr>)}</tbody>
      </table>{!block.entries.length && <p className="canvas-no-data">No matching files in the scanned area.</p>}
    </div>
    {loading && <p role="status">Opening model…</p>}
    {error && <p className="canvas-note" role="alert">{error}</p>}
  </>;
}
