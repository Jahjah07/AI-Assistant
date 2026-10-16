"use client";

import "./arc-reactor.css";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAssistantName } from "../lib/assistant-name";

export default function ArcReactor({ speaking, busy, status }: { speaking: boolean; busy: boolean; status: string }) {
  const name = useAssistantName();
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const element = heading.current;
    if (!element) return;
    let disposed = false;
    const fit = () => {
      if (disposed) return;
      element.style.fontSize = "";
      const size = parseFloat(getComputedStyle(element).fontSize);
      if (element.clientWidth && element.scrollWidth > element.clientWidth) {
        element.style.fontSize = `${size * (element.clientWidth - 1) / element.scrollWidth}px`;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element.parentElement!);
    window.addEventListener("resize", fit);
    void document.fonts.ready.then(fit);
    return () => { disposed = true; observer.disconnect(); window.removeEventListener("resize", fit); };
  }, [name, speaking, busy]);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    const initial = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 1000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, []);
  const time = now?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) ?? "--:--";
  return (
    <section className={`arc-reactor ${speaking ? "reactor-speaking" : busy ? "reactor-busy" : ""}`} aria-label={`${name} arc reactor`}>
      <div className="reactor-face">
        <svg viewBox="0 0 600 600" fill="none" aria-hidden="true" className="reactor-dial">
          <circle cx="300" cy="300" r="286" stroke="currentColor" opacity=".15" />
          <circle cx="300" cy="300" r="275" stroke="currentColor" strokeWidth="2" strokeDasharray="2 12" opacity=".45" />
          <g className="reactor-rotor">
            <circle cx="300" cy="300" r="260" stroke="currentColor" strokeWidth="5" strokeDasharray="325 70 140 50 370 70 120 489" />
            <circle cx="300" cy="300" r="252" stroke="currentColor" strokeWidth="1" strokeDasharray="240 100 600 644" opacity=".5" />
          </g>
          {Array.from({ length: 120 }, (_, i) => (
            <line key={i} x1="300" y1={i % 5 === 0 ? 61 : 68} x2="300" y2="78" transform={`rotate(${i * 3} 300 300)`} stroke="currentColor" strokeWidth={i % 5 === 0 ? 2 : 1} opacity={i % 5 === 0 ? .85 : .3} />
          ))}
          <circle cx="300" cy="300" r="208" stroke="currentColor" strokeWidth="23" opacity=".13" />
          <circle cx="300" cy="300" r="208" stroke="currentColor" strokeWidth="23" strokeDasharray="2 9" opacity=".35" />
          <circle cx="300" cy="300" r="190" stroke="currentColor" opacity=".65" />
          <g className="reactor-inner-rotor">
            <circle cx="300" cy="300" r="182" stroke="currentColor" strokeWidth="4" strokeDasharray="500 45 250 348" />
            <circle cx="300" cy="300" r="195" stroke="var(--ui-line)" strokeWidth="3" strokeDasharray="110 1115" transform="rotate(190 300 300)" />
          </g>
          <circle cx="300" cy="300" r="170" stroke="currentColor" opacity=".18" />
          <path d="M280 22h40M280 578h40M22 280v40M578 280v40" stroke="currentColor" opacity=".55" />
          <path d="M293 112l7 9 7-9M293 488l7-9 7 9" fill="currentColor" />
        </svg>
        <div className="reactor-core">
          <span className="reactor-eyebrow">{speaking ? "VOICE OUTPUT" : busy ? "PROCESSING" : "LOCAL TIME"}</span>
          {speaking || busy ? <h1 ref={heading} className="reactor-name" title={name}>{name.toUpperCase()}</h1> : <div className="reactor-clock" aria-label={`Local time ${time}`}>{time}<span>{now?.getSeconds().toString().padStart(2, "0") ?? "--"}</span></div>}
          <div className="reactor-divider" />
          <span className="reactor-status">{status}</span>
          <span className="reactor-date">{now?.toLocaleDateString([], { weekday: "short", month: "short", day: "2-digit" }) ?? "LOCAL SYSTEM"}</span>
        </div>
      </div>
    </section>
  );
}
