/**
 * Tiny self-contained spinning render of a single part, used by the first-run
 * weapon prompt so a new player can see what they're buying instead of
 * reading a name off a list. Each canvas gets its own renderer/scene — small
 * and short-lived, so no need to share a context with the main viewport.
 */
import * as THREE from 'three';
import type { PartDefinition, PlacedPart } from '../core/types.ts';
import { buildPartMesh } from './meshes.ts';

/** Mounts a spinning preview into `canvas`. Call the returned function to stop the loop and free the GL context — do this as soon as the canvas is hidden. */
export function mountSpinningPartPreview(
  canvas: HTMLCanvasElement,
  def: PartDefinition,
): () => void {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
  scene.add(new THREE.HemisphereLight(0xbfe0ff, 0x1a1410, 0.9));
  const key = new THREE.DirectionalLight(0xfff2df, 1.4);
  key.position.set(2, 3, 2.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fe3ff, 0.6);
  rim.position.set(-2.4, 1.6, -2);
  scene.add(rim);

  const placed: PlacedPart = {
    id: 'weapon-prompt-preview',
    defId: def.id,
    pos: { x: 0, y: 0, z: 0 },
    orient: 0,
    config: {},
  };
  const mesh = buildPartMesh(def, placed, 1);

  // Multi-cell parts (the Sawblade's 2x2 pad, say) build their footprint off
  // to one side of `pos`, not centred on it. Spinning `mesh` itself around
  // its own local origin would then orbit the whole part around empty space
  // instead of turning in place. A pivot fixes that: the mesh is shifted
  // *inside* the pivot so its true geometric centre sits at the pivot's
  // origin, and only the pivot rotates.
  const pivot = new THREE.Group();
  pivot.add(mesh);
  scene.add(pivot);

  const bounds = new THREE.Box3().setFromObject(mesh);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  mesh.position.sub(center);

  // Half the bounding box's diagonal, not half its longest axis: a sphere of
  // that radius contains the whole part from any viewing angle, so a 3/4
  // three-quarter camera can't clip a corner the way a straight-on fit would.
  const boundingRadius = Math.max(size.length() / 2, 0.2);
  const halfVFov = (camera.fov * Math.PI) / 360;
  const margin = 1.2;
  const distance = (boundingRadius / Math.sin(halfVFov)) * margin;
  const yaw = (32 * Math.PI) / 180;
  const pitch = (18 * Math.PI) / 180;
  camera.position.set(
    Math.sin(yaw) * Math.cos(pitch) * distance,
    Math.sin(pitch) * distance,
    Math.cos(yaw) * Math.cos(pitch) * distance,
  );
  camera.lookAt(0, 0, 0);

  let frame = 0;
  let disposed = false;
  const resize = (): void => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  const tick = (): void => {
    if (disposed) return;
    pivot.rotation.y += 0.016;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const material of materials) material.dispose();
    });
    renderer.dispose();
  };
}
