"use client";

import { useEffect, useId, useRef, useState } from "react";
import { diagramLayout, type CanvasBlock, type CanvasDocument } from "../lib/canvas";
import { useAssistantName } from "../lib/assistant-name";
import "./data-canvas.css";
import LocalFiles from "./LocalFiles";


function Chart({ block }: { block: Extract<CanvasBlock, { type: "chart" }> }) {
  const minimum = Math.min(0, ...block.points.map(point => point.value));
  const maximum = Math.max(0, ...block.points.map(point => point.value));
  const range = maximum - minimum || 1;
  if (block.style === "bar") {
    const x = (value: number) => 180 + (value - minimum) / range * 600;
    return <svg className="canvas-chart" viewBox={`0 0 900 ${block.points.length * 44 + 45}`} role="img" aria-label={block.title || "Bar chart"}>
      <line x1={x(0)} x2={x(0)} y1="5" y2={block.points.length * 44 + 10} className="canvas-axis" />
      {block.points.map((point, index) => <g key={index}>
        <title>{`${point.label}: ${point.value}${block.unit ? ` ${block.unit}` : ""}`}</title>
        <text x="165" y={index * 44 + 28} textAnchor="end">{point.label.length > 22 ? point.label.slice(0, 21) + "…" : point.label}</text>
        <rect x={Math.min(x(0), x(point.value))} y={index * 44 + 10} width={Math.max(1, Math.abs(x(point.value) - x(0)))} height="27" rx="3" fill={point.value < 0 ? "#e6b37f" : "var(--ui-line)"} />
        <text x="800" y={index * 44 + 28}>{point.value.toLocaleString()}</text>
      </g>)}
      <text x="180" y={block.points.length * 44 + 35}>{minimum.toLocaleString()}</text><text x="780" textAnchor="end" y={block.points.length * 44 + 35}>{maximum.toLocaleString()} {block.unit}</text>
    </svg>;
  }
  const x = (index: number) => 90 + index / Math.max(1, block.points.length - 1) * 740;
  const y = (value: number) => 285 - (value - minimum) / range * 240;
  return <svg className="canvas-chart" viewBox="0 0 900 355" role="img" aria-label={block.title || "Line chart"}>
    <line x1="90" x2="830" y1={y(0)} y2={y(0)} className="canvas-axis" />
    <text x="75" y="50" textAnchor="end">{maximum.toLocaleString()}</text><text x="75" y="290" textAnchor="end">{minimum.toLocaleString()}</text>
    <polyline fill="none" stroke="var(--ui-line)" strokeWidth="3" points={block.points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ")} />
    {block.points.map((point, index) => <g key={index}><circle cx={x(index)} cy={y(point.value)} r="5" fill="var(--ui-line)"><title>{`${point.label}: ${point.value} ${block.unit || ""}`}</title></circle>
      {index % Math.ceil(block.points.length / 8) === 0 || index === block.points.length - 1 ? <text x={x(index)} y="320" textAnchor="middle">{point.label.slice(0, 16)}</text> : null}</g>)}
  </svg>;
}

function Diagram({ block }: { block: Extract<CanvasBlock, { type: "diagram" }> }) {
  const marker = useId().replace(/:/g, "");
  const layout = diagramLayout(block);
  return <><div className="canvas-diagram-scroll"><svg className="canvas-diagram" viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ minWidth: layout.width }} role="img" aria-label={block.title || "Relationship diagram"}>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="var(--ui-line)" /></marker></defs>
    {block.edges.map((edge, index) => {
      const from = layout.nodes.find(node => node.id === edge.from)!, to = layout.nodes.find(node => node.id === edge.to)!;
      const dx = to.x - from.x, dy = to.y - from.y;
      const inset = Math.min(90 / (Math.abs(dx) || 1), 34 / (Math.abs(dy) || 1));
      return <g key={index}><path d={from.id === to.id ? `M${from.x - 40} ${from.y - 34} C${from.x - 100} ${from.y - 100} ${from.x + 100} ${from.y - 100} ${from.x + 40} ${from.y - 34}` : `M${from.x + dx * inset} ${from.y + dy * inset} L${to.x - dx * inset} ${to.y - dy * inset}`} stroke="var(--ui-line)" strokeWidth="2" fill="none" markerEnd={`url(#${marker})`} />
        {edge.label && <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 10} textAnchor="middle">{edge.label.slice(0, 32)}</text>}</g>;
    })}
    {layout.nodes.map(node => <g key={node.id}><title>{node.label}</title><rect x={node.x - 90} y={node.y - 34} width="180" height="68" rx="8" fill="var(--ui-raised)" stroke="color-mix(in srgb, var(--ui-line) 50.2%, transparent)" />
      <text x={node.x} y={node.y - (node.label.length > 23 ? 6 : -5)} textAnchor="middle"><tspan x={node.x}>{node.label.slice(0, 23)}</tspan>{node.label.length > 23 && <tspan x={node.x} dy="21">{node.label.slice(23, 45)}{node.label.length > 45 ? "…" : ""}</tspan>}</text></g>)}
  </svg></div><details><summary>Read diagram relationships</summary><ul>{block.nodes.map(node => <li key={node.id}>{node.label}</li>)}</ul><ul>{block.edges.map((edge, index) => <li key={index}>{block.nodes.find(node => node.id === edge.from)!.label} → {block.nodes.find(node => node.id === edge.to)!.label}{edge.label ? ` (${edge.label})` : ""}</li>)}</ul></details></>;
}

export default function DataCanvas({ document, onClose, onSeparate, onModel }: { document: CanvasDocument | null; onClose?: () => void; onSeparate?: () => void; onModel: (file: File) => void | Promise<void> }) {
  const name = useAssistantName();
  const picker = useRef<HTMLInputElement>(null);
  const [modelError, setModelError] = useState("");
  return <section className="data-canvas" aria-label={`${name} data canvas`}>
    <header className="canvas-header"><div className="canvas-heading"><div className="canvas-identity"><span className="canvas-reactor" aria-hidden="true" /><span className="canvas-brand">{name.toUpperCase()} / CANVAS</span></div><h1>{document?.title || "Space to see the whole picture."}</h1></div><div className="canvas-actions"><button type="button" onClick={() => picker.current?.click()}>Open 3D model</button>{onSeparate && <button onClick={onSeparate} type="button">Open separate window</button>}{onClose && <button onClick={onClose} type="button">Close canvas</button>}</div></header>
    <input ref={picker} type="file" accept=".3mf,.glb,.stl" className="canvas-sr-only" tabIndex={-1} aria-label="Choose a 3D model" onChange={async event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!file) return;
      try {
        const { validateModelFile } = await import("../lib/model-viewer");
        validateModelFile(file);
        setModelError("");
        await onModel(file);
      } catch (error) { setModelError(error instanceof Error ? error.message : "Could not open model."); }
    }} />
    {modelError && <p role="alert" className="canvas-note">{modelError}</p>}
    {!document ? <div className="canvas-empty"><span>YOUR DATA, WITH ROOM TO BREATHE</span><h2>Ask {name} to show it here.</h2><p>Lists and records become readable tables. Numbers become charts. Connections become diagrams. Open a .3mf, .glb, or .stl file to view a model on the dashboard (up to 50 MB).</p><div><p>“Check my emails.”</p><p>“Graph these monthly expenses.”</p><p>“Show a diagram of this process.”</p></div></div> : <>
      <div className="canvas-meta"><span>{document.source || `${name}'s response · check model-generated facts`}</span><time dateTime={document.createdAt}>{new Date(document.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
      {document.note && <p className="canvas-note" role="status">{document.note}</p>}
      <div className="canvas-blocks">{document.blocks.map((block, index) => <article className="canvas-block" key={index} aria-label={block.title || block.type}>
        <div className="canvas-block-heading"><span>{String(index + 1).padStart(2, "0")} / {block.type}</span>{block.title && <h2>{block.title}</h2>}</div>
        {block.type === "files" ? <LocalFiles key={document.id} block={block} onPreview={onModel} /> : block.type === "table" ? <div className="canvas-table-scroll" tabIndex={0} role="region" aria-label={block.title || "Data table"}><table><caption className="canvas-sr-only">{block.title || document.title}</caption><thead><tr>{block.columns.map((column, columnIndex) => <th scope="col" key={columnIndex}>{column}</th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{value === null ? "—" : String(value)}</td>)}</tr>)}</tbody></table>{!block.rows.length && <p className="canvas-no-data">No matching records.</p>}</div>
          : block.type === "list" ? block.items.length ? <ol className="canvas-list">{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ol> : <p className="canvas-no-data">No items.</p>
          : block.type === "chart" ? <><div className="canvas-chart-scroll"><Chart block={block} /></div><details><summary>View chart data</summary><table><thead><tr><th scope="col">Label</th><th scope="col">Value {block.unit}</th></tr></thead><tbody>{block.points.map((point, pointIndex) => <tr key={pointIndex}><td>{point.label}</td><td>{point.value}</td></tr>)}</tbody></table></details></>
          : block.type === "diagram" ? <Diagram block={block} /> : <pre className="canvas-text">{block.text}</pre>}
      </article>)}</div>
    </>}
  </section>;
}

export function CanvasOverlay({ document, onClose, onSeparate, onModel }: { document: CanvasDocument | null; onClose: () => void; onSeparate: () => void; onModel: (file: File) => void | Promise<void> }) {
  const name = useAssistantName();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="canvas-overlay" aria-label={`${name} data canvas`} onCancel={event => { event.preventDefault(); onClose(); }}><DataCanvas document={document} onClose={onClose} onSeparate={onSeparate} onModel={onModel} /></dialog>;
}
