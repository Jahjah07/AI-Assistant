"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { disposeModel, parseModel } from "../lib/model-viewer";

export default function ModelViewer({ file, onError }: { file: File; onError: (message: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const reset = useRef<() => void>(() => {});
  const navigate = useRef<(action: "left" | "right" | "in" | "out") => void>(() => {});
  const [status, setStatus] = useState("Loading model…");
  const reportError = useEffectEvent(onError);

  useEffect(() => {
    const element = host.current!;
    let cancelled = false;
    let renderer: THREE.WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;
    let observer: ResizeObserver | undefined;
    let model: THREE.Object3D | undefined;
    let frame = 0;
    const contextLost = (event: Event) => {
      event.preventDefault();
      reportError("The graphics device became unavailable. Reopen the model to try again.");
    };
    async function open() {
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.8;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.domElement.tabIndex = 0;
        renderer.setClearColor(0x000000, 0);
        renderer.domElement.setAttribute("aria-label", `3D preview of ${file.name}. Drag to rotate, scroll to zoom, right-drag to pan. Arrow keys rotate, plus and minus zoom, Home resets. Escape returns to the dashboard.`);
        renderer.domElement.addEventListener("webglcontextlost", contextLost);
        element.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x405060, 1.5));
        const light = new THREE.DirectionalLight(0xffffff, 2);
        light.position.set(4, 6, 5);
        scene.add(light);
        controls = new OrbitControls(camera, renderer.domElement);
        const render = () => {
          if (frame || cancelled) return;
          frame = requestAnimationFrame(() => { frame = 0; renderer?.render(scene, camera); });
        };
        controls.addEventListener("change", render);
        observer = new ResizeObserver(() => {
          const width = element.clientWidth, height = element.clientHeight;
          if (!width || !height) return;
          renderer!.setSize(width, height);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          reset.current();
          render();
        });
        observer.observe(element);
        model = await parseModel(await file.arrayBuffer(), file.name, render);
        if (cancelled) { disposeModel(model); model = undefined; return; }
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const extent = Math.max(size.x, size.y, size.z);
        if (bounds.isEmpty() || !Number.isFinite(extent) || extent <= 0) throw new Error("This file has no visible 3D geometry.");
        const center = bounds.getCenter(new THREE.Vector3());
        const group = new THREE.Group();
        group.add(model);
        group.scale.setScalar(2 / extent);
        group.position.copy(center).multiplyScalar(-2 / extent);
        scene.add(group);
        controls.minDistance = 0.2;
        controls.maxDistance = 30;
        navigate.current = action => {
          const offset = camera.position.clone().sub(controls!.target);
          const spherical = new THREE.Spherical().setFromVector3(offset);
          if (action === "left" || action === "right") spherical.theta += action === "left" ? 0.25 : -0.25;
          else spherical.radius = THREE.MathUtils.clamp(spherical.radius * (action === "in" ? 0.8 : 1.25), 0.2, 30);
          camera.position.copy(controls!.target).add(offset.setFromSpherical(spherical));
          controls!.update();
        };
        reset.current = () => {
          camera.position.set(3, 2, 3).multiplyScalar(Math.max(1, 1 / camera.aspect));
          controls!.target.set(0, 0, 0);
          controls!.update();
          render();
        };
        reset.current();
        renderer.domElement.focus();
        setStatus("Drag to rotate · Scroll to zoom · Right-drag to pan");
      } catch (cause) {
        if (!cancelled) {
          reportError(cause instanceof Error ? cause.message : "Unable to display this model.");
        }
      }
    }
    void open();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      reset.current = () => {};
      navigate.current = () => {};
      observer?.disconnect();
      controls?.dispose();
      if (model) disposeModel(model);
      renderer?.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
    };
  }, [file]);

  return <div className="model-viewer" aria-label={`3D model: ${file.name}`} onKeyDown={event => {
    const action = { ArrowLeft: "left", ArrowRight: "right", "+": "in", "=": "in", "-": "out" }[event.key] as "left" | "right" | "in" | "out" | undefined;
    if (action) { event.preventDefault(); navigate.current(action); }
    if (event.key === "Home") { event.preventDefault(); reset.current(); }
  }}>
    <div className="model-viewport" ref={host} />
    <p className="canvas-sr-only" role="status">{status}</p>
  </div>;
}
