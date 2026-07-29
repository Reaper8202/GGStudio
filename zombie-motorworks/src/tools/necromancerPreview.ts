// Standalone preview for the rigid-chunk character rigs. Loaded via
// necromancer.html; run `npm run dev` and open /necromancer.html.
//
// Each rig is a plain node hierarchy — no skinning — so animating it is just
// assigning Euler angles from a pose module onto nodes looked up by name. Every
// rig shares the bone vocabulary in `rigPose`, but the clips differ per
// character: the Necromancer casts, the Gunslinger shoots.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { castPose, walkPose } from './necromancerPose';
import { shootPose, walkPose as gunWalkPose } from './gunslingerPose';
import { BONE_NAMES, type BoneName, type CharacterPose } from './rigPose';

/**
 * A one-shot clip needs a period so it reads as a repeating action; a cycling
 * clip like a walk is driven by raw elapsed time instead.
 */
interface ClipDef {
  readonly pose: (t: number) => CharacterPose;
  readonly period?: number;
}

const MODELS = {
  textured: {
    file: 'necromancer.rigged.glb',
    clips: { walk: { pose: walkPose }, cast: { pose: castPose, period: 2.4 } },
  },
  // Same bone names and the same pose curves as the textured Necromancer — only
  // the geometry differs, which is the whole point of keeping the names aligned.
  voxel: {
    file: 'necromancer-voxel.rigged.glb',
    clips: { walk: { pose: walkPose }, cast: { pose: castPose, period: 2.4 } },
  },
  gunslinger: {
    file: 'gunslinger.rigged.glb',
    clips: { walk: { pose: gunWalkPose }, shoot: { pose: shootPose, period: 2.0 } },
  },
} as const satisfies Record<string, { file: string; clips: Record<string, ClipDef> }>;

type ModelKey = keyof typeof MODELS;
const MODEL_KEYS = Object.keys(MODELS) as ModelKey[];

const clipNames = (key: ModelKey): string[] => Object.keys(MODELS[key].clips);
const clipDef = (key: ModelKey, name: string): ClipDef | undefined =>
  (MODELS[key].clips as Record<string, ClipDef>)[name];

const params = new URLSearchParams(window.location.search);
const stage = document.getElementById('stage') as HTMLDivElement;
const status = document.getElementById('status') as HTMLDivElement;
const speedInput = document.getElementById('speed') as HTMLInputElement;
const speedLabel = document.getElementById('speedLabel') as HTMLSpanElement;
const showParts = document.getElementById('showParts') as HTMLInputElement;
const clipRow = document.getElementById('clips') as HTMLDivElement;
const modelRow = document.getElementById('models') as HTMLDivElement;

let speed = Number(params.get('speed') ?? 1);
let model: ModelKey = MODEL_KEYS.includes(params.get('model') as ModelKey)
  ? (params.get('model') as ModelKey)
  : 'textured';
// A clip only exists on some models, so fall back to the walk every rig has.
let clip: string = clipNames(model).includes(params.get('clip') ?? '')
  ? params.get('clip')!
  : 'walk';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16171d);

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
camera.position.set(2.1, 1.0, 2.8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.15, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a2620, 1.5));
const key = new THREE.DirectionalLight(0xfff2e0, 2.4);
key.position.set(2.5, 4, 3);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.top = 2;
key.shadow.camera.bottom = -2;
key.shadow.camera.left = -2;
key.shadow.camera.right = 2;
scene.add(key);
const rim = new THREE.DirectionalLight(0x9fb4ff, 0.9);
rim.position.set(-2, 1.6, -2.5);
scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(3.2, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x24262e, roughness: 1 }),
);
ground.position.y = -1;
ground.receiveShadow = true;
scene.add(ground);
scene.add(new THREE.GridHelper(6, 24, 0x3a3d47, 0x2b2e36).translateY(-0.999));

/** Wrapper so the walk bob can lift the whole rig without touching hip offsets. */
const rigRoot = new THREE.Group();
scene.add(rigRoot);

const bones = new Map<BoneName, THREE.Object3D>();
const restRotation = new Map<BoneName, THREE.Euler>();
const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
const debugMaterials = new Map<THREE.Mesh, THREE.Material>();

function applyPose(pose: CharacterPose): void {
  rigRoot.position.y = pose.rootLift;
  for (const name of BONE_NAMES) {
    const node = bones.get(name);
    if (!node) continue;
    const rest = restRotation.get(name)!;
    const delta = pose.bones[name];
    node.rotation.set(
      rest.x + (delta?.rx ?? 0),
      rest.y + (delta?.ry ?? 0),
      rest.z + (delta?.rz ?? 0),
    );
  }
}

/** Rebuilt on every model switch, because the clip set is per character. */
function buildClipButtons(): void {
  clipRow.replaceChildren();
  if (!clipNames(model).includes(clip)) clip = 'walk';
  for (const name of clipNames(model)) {
    const button = document.createElement('button');
    button.textContent = name;
    button.setAttribute('aria-pressed', String(name === clip));
    button.addEventListener('click', () => {
      clip = name;
      elapsed = 0;
      for (const child of clipRow.children) {
        child.setAttribute('aria-pressed', String(child.textContent === clip));
      }
    });
    clipRow.appendChild(button);
  }
}

function buildModelButtons(): void {
  for (const key of MODEL_KEYS) {
    const button = document.createElement('button');
    button.textContent = key;
    button.setAttribute('aria-pressed', String(key === model));
    button.addEventListener('click', () => {
      if (key === model) return;
      model = key;
      for (const child of modelRow.children) {
        child.setAttribute('aria-pressed', String(child.textContent === model));
      }
      buildClipButtons();
      void loadModel(model).catch(reportFailure);
    });
    modelRow.appendChild(button);
  }
}

function reportFailure(error: unknown): void {
  status.textContent = `failed: ${String(error)}`;
  status.style.color = '#ff8787';
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

/** Free the GPU resources of whichever rig is currently mounted. */
function unload(): void {
  for (const child of [...rigRoot.children]) {
    child.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        (material as THREE.MeshStandardMaterial).map?.dispose();
        material.dispose();
      }
    });
    rigRoot.remove(child);
  }
  for (const material of debugMaterials.values()) material.dispose();
  bones.clear();
  restRotation.clear();
  originalMaterials.clear();
  debugMaterials.clear();
}

async function loadModel(key: ModelKey): Promise<void> {
  status.style.color = '';
  status.textContent = `loading ${key}…`;
  unload();

  const gltf = await new GLTFLoader().loadAsync(
    `${import.meta.env.BASE_URL}assets/zombies/${MODELS[key].file}`,
  );
  const scene = gltf.scene;
  rigRoot.add(scene);

  const missing: BoneName[] = [];
  for (const name of BONE_NAMES) {
    const node = scene.getObjectByName(name);
    if (!node) {
      missing.push(name);
      continue;
    }
    bones.set(name, node);
    restRotation.set(name, node.rotation.clone());
  }

  let hue = 0;
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const material = child.material as THREE.MeshStandardMaterial;
    // Nearest filtering keeps the voxel texel edges crisp, matching how the
    // rest of the game's voxel assets are sampled in VoxelAssetLoader.
    if (material.map) {
      material.map.magFilter = THREE.NearestFilter;
      material.map.minFilter = THREE.NearestFilter;
      material.map.generateMipmaps = false;
      material.map.needsUpdate = true;
    }
    originalMaterials.set(child, child.material);
    debugMaterials.set(
      child,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL((hue = (hue + 0.618) % 1), 0.6, 0.6),
        roughness: 0.9,
      }),
    );
  });

  let triangles = 0;
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) triangles += (child.geometry.getIndex()?.count ?? 0) / 3;
  });

  status.textContent = missing.length
    ? `missing bones: ${missing.join(', ')}`
    : `${key} · ${bones.size} parts · ${triangles.toLocaleString('en-US')} tris`;
  if (missing.length) status.style.color = '#ff8787';

  // A freshly loaded rig starts at its bind pose; re-apply the debug palette if
  // the toggle was left on.
  if (showParts.checked) showParts.dispatchEvent(new Event('change'));
}

showParts.addEventListener('change', () => {
  for (const [mesh, debug] of debugMaterials) {
    mesh.material = showParts.checked ? debug : originalMaterials.get(mesh)!;
  }
});

speedInput.addEventListener('input', () => {
  speed = Number(speedInput.value) / 100;
  speedLabel.textContent = `${speed.toFixed(2)}x`;
});
speedInput.value = String(Math.round(speed * 100));
speedLabel.textContent = `${speed.toFixed(2)}x`;

buildClipButtons();
buildModelButtons();
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let elapsed = 0;

renderer.setAnimationLoop(() => {
  elapsed += clock.getDelta() * speed;
  const active = clipDef(model, clip);
  if (active) {
    // A periodic clip runs 0..1 across its period; a cycle takes elapsed time.
    applyPose(active.pose(active.period ? (elapsed % active.period) / active.period : elapsed));
  }
  controls.update();
  renderer.render(scene, camera);
});

void loadModel(model).catch(reportFailure);
