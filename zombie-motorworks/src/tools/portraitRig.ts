// Headless render rig for character portrait PNGs. Loaded via portrait.html
// with ?asset=/assets/zombies/<name> and driven by scripts/render-portraits.mjs.
import * as THREE from 'three';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

declare global {
  interface Window {
    __portraitReady?: boolean;
    __capturePortrait?: () => string;
  }
}

const params = new URLSearchParams(window.location.search);
const asset = params.get('asset');
if (!asset) throw new Error('portraitRig: missing ?asset= query param');

const width = Number(params.get('w') ?? 1600);
const height = Number(params.get('h') ?? 1600);
const yawDeg = Number(params.get('yaw') ?? 35);
const pitchDeg = Number(params.get('pitch') ?? 13);
const zoom = Number(params.get('zoom') ?? 1.0);

// Optional lunge pose: bends arm vertices (|x| beyond armX) forward/up about
// a shoulder pivot, and leans the whole body forward about the hip.
const pose = params.get('pose');
const armX = Number(params.get('armX') ?? 0.25);
const armMinY = Number(params.get('armMinY') ?? -1.2);
const armMaxY = Number(params.get('armMaxY') ?? 2.0);
const armPivotY = Number(params.get('armPivotY') ?? 1.7);
const armPivotZ = Number(params.get('armPivotZ') ?? 0);
const armAngleDeg = Number(params.get('armAngle') ?? -50);
const armSpreadDeg = Number(params.get('armSpread') ?? 25);
const leanDeg = Number(params.get('lean') ?? 8);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(width, height, false);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('stage')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, width / height, 0.05, 100);

const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x150a10, 0.6);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff2df, 1.9);
key.position.set(2.8, 4.4, 3.6);
scene.add(key);
const rim = new THREE.DirectionalLight(0x7fe3ff, 1.5);
rim.position.set(-3.4, 2.6, -2.8);
scene.add(rim);
const fill = new THREE.DirectionalLight(0x402838, 0.55);
fill.position.set(-2.2, 1.1, 3.2);
scene.add(fill);

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
  });
}

function makeContactShadowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(0.7, 'rgba(0,0,0,0.22)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Swings vertices with |x| > armX from their current (hanging) position
// forward and upward about a shoulder pivot, and spreads them slightly away
// from the body. Mutates geometry in place; flatShading re-derives normals
// from position in the fragment shader, so no normal recompute is needed.
//
// OBJLoader emits non-indexed triangle soup (each face owns 3 unique
// vertices), so classification and transform both operate per-triangle:
// moving individual vertices lets a boundary triangle straddle the cut,
// stretching it into a huge degenerate sliver with garbage UVs (renders as
// a flat black wing). Voting by majority keeps every triangle intact and
// only produces a jagged (not torn) seam, which reads fine on blocky voxels.
function applyLungeArms(object: THREE.Object3D): void {
  const angle = (armAngleDeg * Math.PI) / 180;
  const spread = (armSpreadDeg * Math.PI) / 180;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  const classifySide = (x: number, y: number): number => {
    if (y < armMinY || y > armMaxY) return 0;
    if (x < -armX) return -1;
    if (x > armX) return 1;
    return 0;
  };

  const transformVertex = (position: THREE.BufferAttribute, i: number, side: number): void => {
    const pivotX = side * armX;
    const dx0 = position.getX(i) - pivotX;
    const dy0 = position.getY(i) - armPivotY;
    const dz0 = position.getZ(i) - armPivotZ;

    const dy1 = dy0 * cosA - dz0 * sinA;
    const dz1 = dy0 * sinA + dz0 * cosA;

    const cosS = Math.cos(spread * side);
    const sinS = Math.sin(spread * side);
    const dx2 = dx0 * cosS - dy1 * sinS;
    const dy2 = dx0 * sinS + dy1 * cosS;

    position.setXYZ(i, pivotX + dx2, armPivotY + dy2, armPivotZ + dz1);
  };

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const position = child.geometry.attributes.position;
    for (let f = 0; f + 2 < position.count; f += 3) {
      const sides = [
        classifySide(position.getX(f), position.getY(f)),
        classifySide(position.getX(f + 1), position.getY(f + 1)),
        classifySide(position.getX(f + 2), position.getY(f + 2)),
      ];
      const left = sides.filter((s) => s === -1).length;
      const right = sides.filter((s) => s === 1).length;
      const faceSide = right >= 2 ? 1 : left >= 2 ? -1 : 0;
      if (faceSide === 0) continue;
      transformVertex(position, f, faceSide);
      transformVertex(position, f + 1, faceSide);
      transformVertex(position, f + 2, faceSide);
    }
    position.needsUpdate = true;
  });
}

// Diagnostic: tints vertices red where the arm classifier (armX/armMinY)
// would treat them as "arm", leaving the rest green. Used to calibrate the
// thresholds against each rig's actual geometry before posing for real.
function applyArmDebugColors(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const position = child.geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const isArm = y >= armMinY && y <= armMaxY && Math.abs(x) > armX;
      colors[i * 3] = isArm ? 1 : 0.12;
      colors[i * 3 + 1] = isArm ? 0 : 0.75;
      colors[i * 3 + 2] = isArm ? 0 : 0.12;
    }
    child.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    child.material = new THREE.MeshBasicMaterial({ vertexColors: true });
  });
}

async function run(): Promise<void> {
  const materials = await new MTLLoader().loadAsync(`${asset}.mtl`);
  materials.preload();
  const object = await new OBJLoader().setMaterials(materials).loadAsync(`${asset}.obj`);

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = Array.isArray(child.material)
      ? child.material.map(voxelMaterial)
      : voxelMaterial(child.material);
  });

  if (pose === 'debug') {
    applyArmDebugColors(object);
  } else if (pose === 'lunge') {
    applyLungeArms(object);
    object.rotation.x = (leanDeg * Math.PI) / 180;
  }

  const bounds = new THREE.Box3().setFromObject(object);
  const center = bounds.getCenter(new THREE.Vector3());
  object.position.set(-center.x, -bounds.min.y, -center.z);
  scene.add(object);

  const size = bounds.getSize(new THREE.Vector3());
  const midY = size.y / 2;

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(size.x, size.z) * 0.75, 48),
    new THREE.MeshBasicMaterial({
      map: makeContactShadowTexture(),
      transparent: true,
      depthWrite: false,
      color: 0x000000,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  scene.add(shadow);

  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;

  // Fit both the vertical extent and the worst-case horizontal footprint
  // (independent of yaw) inside the frustum at the render distance.
  const halfVFov = (camera.fov * Math.PI) / 360;
  const halfHFov = Math.atan(Math.tan(halfVFov) * camera.aspect);
  const footprint = Math.sqrt((size.x / 2) ** 2 + (size.z / 2) ** 2);
  const distanceForHeight = size.y / 2 / Math.tan(halfVFov);
  const distanceForWidth = footprint / Math.tan(halfHFov);
  const margin = 1.12;
  const distance = (Math.max(distanceForHeight, distanceForWidth) * margin) / zoom;
  camera.position.set(
    Math.sin(yaw) * Math.cos(pitch) * distance,
    midY + Math.sin(pitch) * distance,
    Math.cos(yaw) * Math.cos(pitch) * distance,
  );
  camera.lookAt(0, midY, 0);

  renderer.render(scene, camera);
  window.__capturePortrait = () => renderer.domElement.toDataURL('image/png');
  window.__portraitReady = true;
}

void run();
