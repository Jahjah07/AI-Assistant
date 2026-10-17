// Run with node tests/model-viewer.cjs; Electron supplies the real browser XML and WebGL APIs.
/* eslint-disable @typescript-eslint/no-require-imports -- This test is also an Electron CommonJS entrypoint. */
const fs = require("node:fs/promises");
const path = require("node:path");

async function check() {
  const THREE = await import("three");
  const { zipSync, strToU8 } = await import("three/addons/libs/fflate.module.js");
  const { validateModelFile, parseModel, disposeModel } = await import("./model-viewer.mjs");
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const rejects = async (run, message) => {
    let failed = false;
    try { await run(); } catch { failed = true; }
    assert(failed, message);
  };
  for (const name of ["part.3mf", "part.GLB", "part.stl"]) validateModelFile({ name, size: 100 });
  for (const file of [{ name: "a.obj", size: 1 }, { name: "a.glb", size: 0 }, { name: "a.3mf", size: 51 * 1024 * 1024 }]) {
    await rejects(() => validateModelFile(file), "Invalid files must be rejected");
  }
  const xml = '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="2" y="0" z="0"/><vertex x="0" y="0" z="2"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>';
  const archive = zipSync({
    "_rels/.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="r1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    "3D/3dmodel.model": strToU8(xml),
  });
  const stl = new TextEncoder().encode("solid triangle\nfacet normal 0 -1 0\nouter loop\nvertex 0 0 0\nvertex 2 0 0\nvertex 0 0 2\nendloop\nendfacet\nendsolid triangle");
  const gltf = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [2, 2, 0] }], bufferViews: [{ buffer: 0, byteLength: 36 }], buffers: [{ byteLength: 36 }] };
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const padded = Math.ceil(json.length / 4) * 4;
  const glb = new ArrayBuffer(12 + 8 + padded + 8 + 36);
  const view = new DataView(glb);
  [0x46546c67, 2, glb.byteLength, padded, 0x4e4f534a].forEach((value, index) => view.setUint32(index * 4, value, true));
  new Uint8Array(glb, 20, padded).fill(32);
  new Uint8Array(glb, 20, json.length).set(json);
  view.setUint32(20 + padded, 36, true);
  view.setUint32(24 + padded, 0x004e4942, true);
  new Float32Array(glb, 28 + padded).set([0, 0, 0, 2, 0, 0, 0, 2, 0]);
  const renderer = new THREE.WebGLRenderer();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 6);
  for (const [name, data] of [["triangle.3mf", archive.buffer], ["triangle.stl", stl.buffer], ["triangle.glb", glb]]) {
    const model = await parseModel(data, name);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    assert(Math.abs(size.x - 2) < 0.001 && Math.abs(size.y - 2) < 0.001, `${name}: geometry must load upright`);
    scene.add(model);
    renderer.render(scene, camera);
    assert(renderer.info.render.triangles > 0, `${name}: must render a triangle`);
    let disposed = false;
    model.traverse(object => { if (object.isMesh) object.geometry.addEventListener("dispose", () => { disposed = true; }); });
    disposeModel(model);
    assert(disposed, `${name}: geometry must be released`);
    scene.remove(model);
  }
  await rejects(() => parseModel(new ArrayBuffer(8), "broken.glb"), "Malformed GLB must fail");
  const external = { asset: { version: "2.0" }, buffers: [{ uri: "https://example.com/model.bin", byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
  await rejects(() => parseModel(new TextEncoder().encode(JSON.stringify(external)).buffer, "external.glb"), "External resources must be blocked");
  renderer.dispose();
  renderer.forceContextLoss();
  return "PASS: 3MF, GLB, STL loading and WebGL rendering; validation, external URL blocking, disposal";
}

if (process.versions.electron) {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", path.join(path.dirname(process.argv[2]), "profile"));
  app.whenReady().then(async () => {
    // Only generated test fixtures are loaded; file modules need file-origin access in Chromium.
    const window = new BrowserWindow({ show: false, webPreferences: { webSecurity: false, nodeIntegration: false, contextIsolation: true } });
    try {
      await window.loadURL(require("node:url").pathToFileURL(process.argv[2]).href);
      console.log(await window.webContents.executeJavaScript("window.checkPromise"));
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
} else {
  (async () => {
    const { pathToFileURL } = require("node:url");
    const { spawn } = require("node:child_process");
    const ts = require("typescript");
    const directory = await fs.mkdtemp(path.join(__dirname, ".model-viewer-"));
    try {
      const source = await fs.readFile(path.join(__dirname, "../app/lib/model-viewer.ts"), "utf8");
      await fs.writeFile(path.join(directory, "model-viewer.mjs"), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText);
      const three = pathToFileURL(path.join(__dirname, "../node_modules/three/")).href;
      const html = `<script type="importmap">${JSON.stringify({ imports: { three: `${three}build/three.module.js`, "three/addons/": `${three}examples/jsm/` } })}</script><script type="module">window.checkPromise = (${check.toString()})();</script>`;
      const entry = path.join(directory, "test.html");
      await fs.writeFile(entry, html);
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require("electron"), [__filename, entry], { env, stdio: "inherit", windowsHide: true });
      const timeout = setTimeout(() => child.kill(), 30000);
      process.exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => resolve(code ?? 1)); });
      clearTimeout(timeout);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
