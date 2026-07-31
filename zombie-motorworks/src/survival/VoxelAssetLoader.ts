import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

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
    // Pipeline GLBs carry their paint in COLOR_0 rather than a texture, so the
    // flag has to survive the swap or the model comes through plain white.
    vertexColors: original.vertexColors,
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

/**
 * glTF declares COLOR_0 to be linear, but the voxel pipeline bakes the source
 * texture's sRGB texels straight into it. Three.js takes the spec at its word,
 * so every value is re-encoded on the way to the screen and the whole model
 * comes out pale and chalky — a 0.45 mid-tone displays as 0.70. Undoing that
 * encode is what puts the paint back.
 */
function srgbToLinear(channel: number): number {
  return channel < 0.04045
    ? channel * 0.0773993808
    : Math.pow(channel * 0.9478672986 + 0.0521327014, 2.4);
}

/**
 * Voxel bakes come back flatter than the art they were sampled from, so the
 * corrected colours get a deliberate push: saturation away from grey, and
 * contrast around a dark pivot, since these models are lit by a night
 * graveyard rather than a studio.
 */
const VERTEX_COLOR_SATURATION = 1.3;
const VERTEX_COLOR_CONTRAST = 1.2;
/** Linear-space mid-point the contrast stretch pivots around. */
const VERTEX_COLOR_PIVOT = 0.16;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Rewrite one mesh's baked colours in place; the template is loaded once. */
function correctVertexColors(object: THREE.Object3D): void {
  const corrected = new Set<
    THREE.BufferAttribute | THREE.InterleavedBufferAttribute
  >();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const colors = child.geometry.getAttribute('color');
    if (!colors || corrected.has(colors)) return;
    corrected.add(colors);
    for (let i = 0; i < colors.count; i++) {
      const r = srgbToLinear(colors.getX(i));
      const g = srgbToLinear(colors.getY(i));
      const b = srgbToLinear(colors.getZ(i));
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      colors.setXYZ(
        i,
        clamp01(
          VERTEX_COLOR_PIVOT +
            (luma + (r - luma) * VERTEX_COLOR_SATURATION - VERTEX_COLOR_PIVOT) *
              VERTEX_COLOR_CONTRAST,
        ),
        clamp01(
          VERTEX_COLOR_PIVOT +
            (luma + (g - luma) * VERTEX_COLOR_SATURATION - VERTEX_COLOR_PIVOT) *
              VERTEX_COLOR_CONTRAST,
        ),
        clamp01(
          VERTEX_COLOR_PIVOT +
            (luma + (b - luma) * VERTEX_COLOR_SATURATION - VERTEX_COLOR_PIVOT) *
              VERTEX_COLOR_CONTRAST,
        ),
      );
    }
    colors.needsUpdate = true;
  });
}

/**
 * Rigged characters out of `glb-rigger` arrive as a named node hierarchy — the
 * bones are plain Object3Ds, so a clone keeps the names and pose code can find
 * them with `getObjectByName`.
 */
/**
 * Only the glb-pipeline's plain (unrigged) output is meshopt-compressed —
 * the rigger writes its rigged exports uncompressed by design — but the
 * decoder is harmless to register unconditionally, so every `.glb` here
 * shares one loader instead of branching on which asset needs it.
 */
const glbLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

async function loadGlbObject(url: string): Promise<THREE.Object3D> {
  const scene = (await glbLoader.loadAsync(url)).scene;
  correctVertexColors(scene);
  return scene;
}

async function loadTemplate(baseUrl: string): Promise<THREE.Group> {
  const object = baseUrl.endsWith('.glb')
    ? await loadGlbObject(baseUrl)
    : baseUrl.endsWith('.fbx')
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

/**
 * Warm a model's template so a later `instantiateVoxelAsset` resolves from
 * cache instead of a fetch. Fire-and-forget: a failure here is not worth
 * surfacing, because the real load will report it.
 *
 * Worth doing for anything big that appears on a deadline. A boss's model is
 * several megabytes and is only requested at the instant it spawns, so without
 * this the boss stands there as the placeholder walker — fitted to its full
 * boss height, so unmistakably wrong — for as long as the download takes.
 */
export function preloadVoxelAsset(baseUrl: string): void {
  void templateFor(baseUrl).catch(() => undefined);
}

/** Loads each OBJ/MTL pair, FBX, or GLB once, then returns geometry-sharing clones. */
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
