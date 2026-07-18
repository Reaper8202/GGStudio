import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

const templates = new Map<string, Promise<THREE.Group>>();

function configureTexture(texture: THREE.Texture | null): void {
  if (!texture) return;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
}

function voxelMaterial(source: THREE.Material): THREE.MeshLambertMaterial {
  const original = source as THREE.MeshPhongMaterial;
  configureTexture(original.map);
  return new THREE.MeshLambertMaterial({
    color: original.color?.clone() ?? new THREE.Color(0xffffff),
    map: original.map ?? null,
    emissive: 0x000000,
    flatShading: true,
    side: original.side,
    transparent: original.transparent,
    opacity: original.opacity,
    alphaTest: original.alphaTest,
  });
}

function replaceMaterials(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = Array.isArray(child.material)
      ? child.material.map(voxelMaterial)
      : voxelMaterial(child.material);
    child.castShadow = true;
    child.receiveShadow = true;
  });
}

async function loadObjObject(baseUrl: string): Promise<THREE.Object3D> {
  const materials = await new MTLLoader().loadAsync(`${baseUrl}.mtl`);
  materials.preload();
  return new OBJLoader().setMaterials(materials).loadAsync(`${baseUrl}.obj`);
}

async function loadFbxObject(url: string): Promise<THREE.Object3D> {
  const object = await new FBXLoader().loadAsync(url);
  object.scale.setScalar(0.01);
  return object;
}

async function loadTemplate(baseUrl: string): Promise<THREE.Group> {
  const object = baseUrl.endsWith('.fbx')
    ? await loadFbxObject(baseUrl)
    : await loadObjObject(baseUrl);
  replaceMaterials(object);

  const bounds = new THREE.Box3().setFromObject(object);
  const center = bounds.getCenter(new THREE.Vector3());
  object.position.set(-center.x, -bounds.min.y, -center.z);

  const root = new THREE.Group();
  root.add(object);
  return root;
}

function templateFor(baseUrl: string): Promise<THREE.Group> {
  let pending = templates.get(baseUrl);
  if (!pending) {
    pending = loadTemplate(baseUrl);
    templates.set(baseUrl, pending);
  }
  return pending;
}

function cloneMaterials(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => material.clone())
      : child.material.clone();
  });
}

/** Loads each OBJ/MTL pair or FBX once, then returns geometry-sharing clones. */
export async function instantiateVoxelAsset(
  baseUrl: string,
  uniqueMaterials = false,
): Promise<THREE.Group> {
  const instance = (await templateFor(baseUrl)).clone(true);
  if (uniqueMaterials) cloneMaterials(instance);
  return instance;
}

/** Geometry/material/pivot source for batching a single-mesh asset. */
export async function loadVoxelInstanceSource(baseUrl: string): Promise<{
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly pivot: THREE.Vector3;
}> {
  const root = await templateFor(baseUrl);
  const object = root.children[0];
  const meshes: THREE.Mesh[] = [];
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child);
  });
  if (meshes.length !== 1) {
    throw new Error(
      `loadVoxelInstanceSource: expected exactly one mesh in "${baseUrl}", found ${meshes.length}`,
    );
  }
  return {
    geometry: meshes[0].geometry,
    material: meshes[0].material as THREE.Material,
    pivot: object.position.clone(),
  };
}

/** Dispose and forget cached templates after a survival scene is torn down. */
export function clearVoxelAssetCache(): void {
  const pendingTemplates = [...templates.values()];
  templates.clear();
  for (const pending of pendingTemplates) {
    void pending.then(disposeTemplate).catch(() => undefined);
  }
}

function disposeTemplate(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    if (Array.isArray(child.material)) {
      for (const material of child.material) materials.add(material);
    } else {
      materials.add(child.material);
    }
  });
  for (const material of materials) {
    const mapped = material as THREE.Material & { map?: THREE.Texture | null };
    if (mapped.map) textures.add(mapped.map);
    material.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
}
