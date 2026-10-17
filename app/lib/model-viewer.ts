import * as THREE from "three";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

// shortcut: compressed file size cannot bound model complexity, use a worker if large models become necessary.
export const MAX_MODEL_BYTES = 50 * 1024 * 1024;

export function validateModelFile(file: { name: string; size: number }) {
  if (!/\.(3mf|glb|stl)$/i.test(file.name)) throw new Error("Choose a .3mf, .glb, or .stl file.");
  if (!file.size || file.size > MAX_MODEL_BYTES) throw new Error("Choose a non-empty model smaller than 50 MB.");
}

export async function parseModel(data: ArrayBuffer, name: string, onLoad = () => {}) {
  const manager = new THREE.LoadingManager();
  manager.onLoad = onLoad;
  manager.setURLModifier(url => {
    if (!url.startsWith("blob:") && !url.startsWith("data:")) throw new Error("Use a self-contained model with embedded textures.");
    return url;
  });
  let model: THREE.Object3D;
  if (/\.3mf$/i.test(name)) {
    model = new ThreeMFLoader(manager).parse(data);
    model.rotation.x = -Math.PI / 2;
  } else if (/\.stl$/i.test(name)) {
    model = new THREE.Mesh(new STLLoader(manager).parse(data), new THREE.MeshStandardMaterial({ color: 0x96cdd4, roughness: 0.65 }));
    model.rotation.x = -Math.PI / 2;
  } else {
    model = (await new GLTFLoader(manager).parseAsync(data, "")).scene;
  }
  return model;
}

export function disposeModel(model: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    }
  });
  for (const texture of textures) {
    if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) texture.image.close();
    texture.dispose();
  }
}
