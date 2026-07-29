/**
 * Onion-skin after-images left behind by the Phase ability.
 *
 * A blink is instantaneous, so without a trail the rig simply is somewhere
 * else and the player has no idea what happened. This draws the frames the
 * teleport skipped: a handful of copies of the vehicle strung along the path it
 * jumped, each a flat, unlit silhouette that fades out back-to-front so the
 * trail reads as being pulled forward into the destination.
 *
 * Presentation only. The clones share the live vehicle's geometry (cloning a
 * Three.js mesh reuses its buffers) and carry one throwaway material each, so a
 * blink costs a shallow object-graph copy rather than a rebuild — and only the
 * materials this file made are ever disposed.
 */

import * as THREE from 'three';

/** Layers a blink leaves behind, spaced evenly along the jump. */
const GHOST_LAYERS = 7;
/** Seconds the first (oldest) layer takes to fade out. */
const GHOST_LIFE_SECONDS = 0.42;
/**
 * Extra seconds each successive layer waits before it starts fading. The
 * nearest ghost outlives the furthest, so the trail collapses toward where the
 * rig actually is.
 */
const GHOST_STAGGER_SECONDS = 0.035;
/** Opacity of the freshest layer; earlier ones scale down from here. */
const GHOST_PEAK_OPACITY = 0.5;
/** Displacement-coil cyan, matched to the shield bubble's blue-white. */
const GHOST_COLOR = 0x8ff2ff;

interface Ghost {
  readonly root: THREE.Group;
  readonly material: THREE.MeshBasicMaterial;
  /** Opacity this layer starts at once its delay has run out. */
  readonly peakOpacity: number;
  /** Seconds still to wait before it begins fading. */
  delaySeconds: number;
  /** Seconds of fade left. */
  remainingSeconds: number;
  readonly lifeSeconds: number;
}

export class PhaseGhosts {
  private readonly ghosts: Ghost[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  /**
   * Strew after-images between `from` and `to`. `sources` are the live vehicle
   * visuals — the chassis group and every wheel — read in their current world
   * placement; each layer is a clone of all of them shifted back along the jump.
   */
  spawn(
    sources: readonly THREE.Object3D[],
    from: THREE.Vector3,
    to: THREE.Vector3,
  ): void {
    if (sources.length === 0) return;
    for (let layer = 0; layer < GHOST_LAYERS; layer++) {
      // t = 0 is the departure point, t = 1 the arrival: the last layer is
      // skipped because the real vehicle already stands there.
      const t = layer / GHOST_LAYERS;
      const material = new THREE.MeshBasicMaterial({
        color: GHOST_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const root = new THREE.Group();
      // Clones keep their own world transforms, so the group only carries the
      // offset from where the rig stood to where this layer belongs.
      root.position.set(
        (to.x - from.x) * t,
        (to.y - from.y) * t,
        (to.z - from.z) * t,
      );
      for (const source of sources) {
        if (!source.visible) continue;
        const clone = source.clone(true);
        clone.traverse((object) => {
          if ((object as THREE.Mesh).isMesh) {
            (object as THREE.Mesh).material = material;
          }
          // Silhouettes only: a part mesh's contour lines keep the original's
          // dark, opaque material, which would draw a solid wireframe over the
          // fading shell. Anything already hidden — a part a zombie tore off —
          // stays hidden.
          if ((object as THREE.LineSegments).isLineSegments) {
            object.visible = false;
          }
        });
        root.add(clone);
      }
      this.scene.add(root);
      this.ghosts.push({
        root,
        material,
        // The trail thins out toward the departure point, so the eye is led the
        // way the rig went.
        peakOpacity: GHOST_PEAK_OPACITY * (0.35 + 0.65 * t),
        delaySeconds: layer * GHOST_STAGGER_SECONDS,
        remainingSeconds: GHOST_LIFE_SECONDS,
        lifeSeconds: GHOST_LIFE_SECONDS,
      });
    }
  }

  /** Advance every live after-image and retire the ones that have faded out. */
  update(frameDt: number): void {
    for (let index = this.ghosts.length - 1; index >= 0; index--) {
      const ghost = this.ghosts[index];
      if (ghost.delaySeconds > 0) {
        ghost.delaySeconds -= frameDt;
        ghost.material.opacity = ghost.peakOpacity;
        continue;
      }
      ghost.remainingSeconds -= frameDt;
      if (ghost.remainingSeconds <= 0) {
        this.retire(ghost);
        this.ghosts.splice(index, 1);
        continue;
      }
      ghost.material.opacity =
        ghost.peakOpacity * (ghost.remainingSeconds / ghost.lifeSeconds);
    }
  }

  /** Drop every after-image at once — used when a wave or the run ends. */
  clear(): void {
    for (const ghost of this.ghosts) this.retire(ghost);
    this.ghosts.length = 0;
  }

  dispose(): void {
    this.clear();
  }

  private retire(ghost: Ghost): void {
    this.scene.remove(ghost.root);
    // Geometry is shared with the still-living vehicle; only the ghost material
    // was made here, so it is the only thing safe to dispose.
    ghost.material.dispose();
  }
}
