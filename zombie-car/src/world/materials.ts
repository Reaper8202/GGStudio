/**
 * Shared low-poly, flat-shaded material palette for the construction site.
 * Materials are created once and reused across meshes (no per-mesh
 * allocation, no per-frame allocation) — muted dirt/concrete/rust tones.
 */
import * as THREE from "three";

export const Palette = {
  dirt: 0x6b5a45,
  dirtDark: 0x594935,
  concrete: 0x8d8d86,
  concreteLight: 0x9fa09a,
  concreteDark: 0x6c6c66,
  metal: 0x5c6066,
  metalDark: 0x40444a,
  rust: 0x8a5a3c,
  wood: 0x8a6a45,
  caution: 0xd9a441,
  containerBlue: 0x3d6e79,
  containerRust: 0x8a4a34,
  fence: 0x848f96,
} as const;

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

export const Materials = {
  dirt: lambert(Palette.dirt),
  dirtDark: lambert(Palette.dirtDark),
  concrete: lambert(Palette.concrete),
  concreteLight: lambert(Palette.concreteLight),
  concreteDark: lambert(Palette.concreteDark),
  metal: lambert(Palette.metal),
  metalDark: lambert(Palette.metalDark),
  rust: lambert(Palette.rust),
  wood: lambert(Palette.wood),
  caution: lambert(Palette.caution),
  containerBlue: lambert(Palette.containerBlue),
  containerRust: lambert(Palette.containerRust),
  fence: lambert(Palette.fence),
} as const;
