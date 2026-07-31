/** High-resolution product thumbnails rendered from the garage's real part meshes. */

import * as THREE from 'three';
import type { PartDefinition, PlacedPart } from '../core/types.ts';
import { buildPartMesh } from './meshes.ts';

const ICON_SIZE = 256;
const ICON_PADDING = 1.18;
const CAMERA_DIRECTION = new THREE.Vector3(4, 3.1, 5).normalize();
const iconCache = new WeakMap<
  THREE.WebGLRenderer,
  ReadonlyMap<string, string>
>();

function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.Line ||
      object instanceof THREE.Points
    ) {
      geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of objectMaterials) materials.add(material);
    }
  });

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

function framePart(
  camera: THREE.OrthographicCamera,
  part: THREE.Object3D,
): boolean {
  part.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(part);
  if (bounds.isEmpty()) return false;

  const centre = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  if (
    !Number.isFinite(size.x) ||
    !Number.isFinite(size.y) ||
    !Number.isFinite(size.z)
  ) {
    return false;
  }

  part.position.sub(centre);
  part.updateMatrixWorld(true);
  bounds.setFromObject(part);

  const diagonal = Math.max(size.length(), 0.1);
  const cameraDistance = Math.max(4, diagonal * 3.5);
  camera.position.copy(CAMERA_DIRECTION).multiplyScalar(cameraDistance);
  camera.near = Math.max(0.01, cameraDistance - diagonal * 2);
  camera.far = cameraDistance + diagonal * 2;
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  let halfWidth = 0;
  let halfHeight = 0;
  const corner = new THREE.Vector3();
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
        halfWidth = Math.max(halfWidth, Math.abs(corner.x));
        halfHeight = Math.max(halfHeight, Math.abs(corner.y));
      }
    }
  }

  const halfExtent = Math.max(halfWidth, halfHeight, 0.05) * ICON_PADDING;
  camera.left = -halfExtent;
  camera.right = halfExtent;
  camera.top = halfExtent;
  camera.bottom = -halfExtent;
  camera.updateProjectionMatrix();
  return true;
}

function iconPart(definition: PartDefinition): PlacedPart {
  return {
    id: `icon:${definition.id}`,
    defId: definition.id,
    pos: { x: 0, y: 0, z: 0 },
    orient: 0,
    config: {},
  };
}

/** Reject incomplete output and the exact repeated-placeholder regression. */
export function isCompleteDistinctIconSet(
  partIds: readonly string[],
  icons: ReadonlyMap<string, string>,
): boolean {
  const uniqueIds = new Set(partIds);
  if (icons.size !== uniqueIds.size) return false;

  const urls = new Set<string>();
  for (const id of uniqueIds) {
    const url = icons.get(id);
    if (!url?.startsWith('data:image/png;base64,')) return false;
    urls.add(url);
  }
  return urls.size === uniqueIds.size;
}

/**
 * Render catalog icons with one short-lived, isolated WebGL canvas. Capturing
 * that canvas directly avoids multisampled render-target readback, which is
 * not portable across all browser/GPU combinations. Any unavailable rendering
 * API yields an empty map so the garage can retain its lightweight fallback.
 */
export function renderPartIconUrls(
  renderer: THREE.WebGLRenderer,
  definitions: readonly PartDefinition[],
): ReadonlyMap<string, string> {
  if (typeof document === 'undefined') return new Map();
  const cached = iconCache.get(renderer);
  if (cached && definitions.every((definition) => cached.has(definition.id))) {
    return cached;
  }

  const result = new Map<string, string>();
  let thumbnailRenderer: THREE.WebGLRenderer | null = null;

  try {
    const canvas = document.createElement('canvas');
    thumbnailRenderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    thumbnailRenderer.setPixelRatio(1);
    thumbnailRenderer.setSize(ICON_SIZE, ICON_SIZE, false);
    thumbnailRenderer.outputColorSpace = THREE.SRGBColorSpace;
    thumbnailRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    thumbnailRenderer.toneMappingExposure = 1.15;
    thumbnailRenderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    const hemisphere = new THREE.HemisphereLight(0xc9dded, 0x352a1f, 1.45);
    const warmKey = new THREE.DirectionalLight(0xffd6a1, 2.35);
    warmKey.position.set(4, 6, 4);
    const coolRim = new THREE.DirectionalLight(0x79aeff, 1.25);
    coolRim.position.set(-5, 2.5, -4);
    scene.add(hemisphere, warmKey, coolRim);

    for (const definition of definitions) {
      const part = buildPartMesh(definition, iconPart(definition));
      scene.add(part);
      try {
        if (!framePart(camera, part))
          throw new Error('Part has no render bounds');
        thumbnailRenderer.clear(true, true, true);
        thumbnailRenderer.render(scene, camera);
        result.set(definition.id, canvas.toDataURL('image/png'));
      } finally {
        scene.remove(part);
        disposeObject(part);
      }
    }

    const ids = definitions.map(({ id }) => id);
    if (!isCompleteDistinctIconSet(ids, result)) return new Map();
    iconCache.set(renderer, result);
    return result;
  } catch {
    return new Map();
  } finally {
    thumbnailRenderer?.dispose();
    thumbnailRenderer?.forceContextLoss();
  }
}
