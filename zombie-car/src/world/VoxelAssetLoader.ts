import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

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

async function loadTemplate(baseUrl: string): Promise<THREE.Group> {
  // A ".fbx" suffix selects the FBX path (used by the apocalypse prop pack,
  // which ships FBX-only); everything else is a MagicaVoxel OBJ/MTL pair
  // addressed by its extensionless base URL.
  const object = baseUrl.endsWith(".fbx")
    ? await loadFbxObject(baseUrl)
    : await loadObjObject(baseUrl);
  replaceMaterials(object);

  // MagicaVoxel exports are centered on all axes. Re-anchor them to the
  // middle of their footprint with their lowest voxel resting at y = 0.
  const bounds = new THREE.Box3().setFromObject(object);
  const center = bounds.getCenter(new THREE.Vector3());
  object.position.set(-center.x, -bounds.min.y, -center.z);

  const root = new THREE.Group();
  root.add(object);
  return root;
}

async function loadObjObject(baseUrl: string): Promise<THREE.Object3D> {
  const materials = await new MTLLoader().loadAsync(`${baseUrl}.mtl`);
  materials.preload();
  return new OBJLoader().setMaterials(materials).loadAsync(`${baseUrl}.obj`);
}

async function loadFbxObject(url: string): Promise<THREE.Object3D> {
  const object = await new FBXLoader().loadAsync(url);
  // These packs author in centimeters (a barricade measures ~200 units tall);
  // normalize to the meter-ish world scale the OBJ assets already use, so
  // placement `scale` values mean the same thing for both formats.
  object.scale.setScalar(0.01);
  return object;
}

function cloneMaterials(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => material.clone())
      : child.material.clone();
  });
}

/** Loads each OBJ/MTL pair once, then returns cheap geometry-sharing clones. */
export async function instantiateVoxelAsset(
  baseUrl: string,
  uniqueMaterials = false
): Promise<THREE.Group> {
  let pending = templates.get(baseUrl);
  if (!pending) {
    pending = loadTemplate(baseUrl);
    templates.set(baseUrl, pending);
  }

  const instance = (await pending).clone(true);
  if (uniqueMaterials) cloneMaterials(instance);
  return instance;
}

/**
 * Raw geometry/material/pivot for an asset that's a single mesh (e.g. one
 * MagicaVoxel "usemtl" group) — for callers tiling many copies of the same
 * asset via `THREE.InstancedMesh` instead of many separate cloned objects
 * (one draw call for the whole layer instead of one per placement). Not a
 * general replacement for `instantiateVoxelAsset`: it assumes exactly one
 * mesh in the template and throws otherwise.
 */
export async function loadVoxelInstanceSource(baseUrl: string): Promise<{
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  /** The pivot offset baked in by `loadTemplate`'s re-anchoring (bottom of
   *  the model at local y=0) — fold this into each instance's matrix. */
  readonly pivot: THREE.Vector3;
}> {
  let pending = templates.get(baseUrl);
  if (!pending) {
    pending = loadTemplate(baseUrl);
    templates.set(baseUrl, pending);
  }

  const root = await pending;
  const object = root.children[0];
  const meshes: THREE.Mesh[] = [];
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child);
  });
  if (meshes.length !== 1) {
    throw new Error(
      `loadVoxelInstanceSource: expected exactly one mesh in "${baseUrl}", found ${meshes.length}`
    );
  }

  return {
    geometry: meshes[0].geometry,
    material: meshes[0].material as THREE.Material,
    pivot: object.position.clone(),
  };
}

