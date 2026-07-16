import * as THREE from "three";
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
  const materials = await new MTLLoader().loadAsync(`${baseUrl}.mtl`);
  materials.preload();

  const object = await new OBJLoader().setMaterials(materials).loadAsync(`${baseUrl}.obj`);
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

