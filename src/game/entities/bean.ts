import * as THREE from 'three';
import { Palette } from '../../config/constants';

/**
 * Procedural "bean astronaut" builder — our own original character design
 * (deliberately distinct from any existing IP: taller proportions, offset
 * oval visor, antenna, separate boot-legs). Shared by the player crewmate
 * and the impostor obstacle variant.
 */
export interface BeanParts {
  group: THREE.Group;
  body: THREE.Mesh;
  visor: THREE.Mesh;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  /** Exposed so callers (e.g. the color picker) can recolor after creation. */
  bodyMat: THREE.MeshLambertMaterial;
  darkMat: THREE.MeshLambertMaterial;
}

const bodyGeo = new THREE.CapsuleGeometry(0.42, 0.6, 6, 14);
const visorGeo = new THREE.SphereGeometry(0.24, 14, 10);
const packGeo = new THREE.BoxGeometry(0.5, 0.62, 0.26);
const legGeo = new THREE.CylinderGeometry(0.13, 0.15, 0.34, 10);
const antennaGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.26, 6);
const antennaTipGeo = new THREE.SphereGeometry(0.055, 8, 6);
const spikeGeo = new THREE.ConeGeometry(0.09, 0.28, 8);

export interface BeanOptions {
  color: number;
  darkColor: number;
  visorColor: number;
  visorEmissive?: number;
  /** Impostor styling: narrow angry visor, head spikes, no antenna. */
  menacing?: boolean;
}

export function makeBean(opts: BeanOptions): BeanParts {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshLambertMaterial({
    color: opts.color,
  });
  const darkMat = new THREE.MeshLambertMaterial({
    color: opts.darkColor,
  });
  const visorMat = new THREE.MeshLambertMaterial({
    color: opts.visorColor,
    emissive: opts.visorEmissive ?? 0x000000,
    emissiveIntensity: 0.7,
  });

  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.95;
  group.add(body);

  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.scale.set(1, opts.menacing ? 0.42 : 0.72, 0.55);
  visor.position.set(0, 1.18, -0.33);
  group.add(visor);

  const pack = new THREE.Mesh(packGeo, darkMat);
  pack.position.set(0, 0.95, 0.42);
  group.add(pack);

  const legL = new THREE.Mesh(legGeo, darkMat);
  legL.position.set(-0.19, 0.17, 0);
  group.add(legL);
  const legR = new THREE.Mesh(legGeo, darkMat);
  legR.position.set(0.19, 0.17, 0);
  group.add(legR);

  if (opts.menacing) {
    for (const [x, z] of [
      [-0.16, 0.05],
      [0.02, -0.02],
      [0.19, 0.06],
    ]) {
      const spike = new THREE.Mesh(spikeGeo, darkMat);
      spike.position.set(x, 1.62, z);
      spike.rotation.z = -x * 0.9;
      group.add(spike);
    }
  } else {
    const antenna = new THREE.Mesh(antennaGeo, darkMat);
    antenna.position.set(0, 1.68, 0);
    group.add(antenna);
    const tip = new THREE.Mesh(antennaTipGeo, visorMat);
    tip.position.set(0, 1.82, 0);
    group.add(tip);
  }

  return { group, body, visor, legL, legR, bodyMat, darkMat };
}

/** Flat dark disc used as a cheap blob shadow (no shadow-mapping needed). */
const shadowGeo = new THREE.CircleGeometry(0.55, 20);
const shadowMat = new THREE.MeshBasicMaterial({
  color: Palette.bg,
  transparent: true,
  opacity: 0.5,
});

export function makeBlobShadow(): THREE.Mesh {
  const m = new THREE.Mesh(shadowGeo, shadowMat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  return m;
}
