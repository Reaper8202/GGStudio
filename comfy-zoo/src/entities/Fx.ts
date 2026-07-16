/**
 * Diegetic, in-world feedback (plan §6): billboarded thought-bubble sprites,
 * 3D progress rings, heart/poof particle puffs, and a soft interact-zone glow.
 * All drawn on small procedural canvases — no external textures, no DOM.
 */
import * as THREE from 'three';

export type BubbleKind =
  | 'hay'
  | 'berry'
  | 'forage'
  | 'water'
  | 'zzz'
  | 'spook'
  | 'heart'
  | 'wrongPen'
  | 'penFull';

const EMOJI: Record<BubbleKind, string> = {
  hay: '🌾',
  berry: '🍓',
  forage: '🍄',
  water: '💧',
  zzz: '💤',
  spook: '❗',
  heart: '💗',
  wrongPen: '🚫',
  penFull: '🔒',
};

/** Soft radial-gradient texture — used for blob shadows and interact glows. */
export function radialTexture(color = '#000000', alpha = 0.35): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, hexToRgba(color, alpha));
  g.addColorStop(0.7, hexToRgba(color, alpha * 0.5));
  g.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let sharedShadowTex: THREE.CanvasTexture | null = null;

/** One shared soft blob-shadow mesh factory (procedural, no shadow maps). */
export function makeBlobShadow(radius: number): THREE.Mesh {
  if (!sharedShadowTex) sharedShadowTex = radialTexture('#3a2e1f', 0.4);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({
      map: sharedShadowTex,
      transparent: true,
      depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  mesh.renderOrder = 1;
  return mesh;
}

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function emojiTexture(glyph: string): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  // soft cream bubble
  ctx.fillStyle = 'rgba(246,238,221,0.92)';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(138,107,77,0.9)';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.font = '64px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, size / 2, size / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A reusable floating indicator above an entity. */
export class Bubble {
  readonly sprite: THREE.Sprite;
  private current: BubbleKind | null = null;

  constructor(private fx: Fx) {
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ transparent: true, depthTest: false }),
    );
    this.sprite.scale.setScalar(0.7);
    this.sprite.visible = false;
    this.sprite.renderOrder = 10;
  }

  set(kind: BubbleKind | null): void {
    if (kind === this.current) return;
    this.current = kind;
    if (!kind) {
      this.sprite.visible = false;
      return;
    }
    this.sprite.material.map = this.fx.bubbleTexture(kind);
    this.sprite.material.needsUpdate = true;
    this.sprite.visible = true;
  }

  get kind(): BubbleKind | null {
    return this.current;
  }
}

interface Particle {
  sprite: THREE.Sprite;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  ttl: number;
}

interface Ring {
  mesh: THREE.Mesh;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
}

export class Fx {
  private bubbleTextures = new Map<BubbleKind, THREE.CanvasTexture>();
  private heartTex: THREE.CanvasTexture;
  private poofTex: THREE.CanvasTexture;
  private particles: Particle[] = [];
  private rings = new Map<string, Ring>();
  private glow: THREE.Mesh;

  constructor(private scene: THREE.Scene) {
    this.heartTex = emojiTexture('💗');
    this.poofTex = radialTexture('#F6EEDD', 0.8);
    const glowMat = new THREE.MeshBasicMaterial({
      map: radialTexture('#F2A65A', 0.4),
      transparent: true,
      depthWrite: false,
    });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), glowMat);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.03;
    this.glow.visible = false;
    this.scene.add(this.glow);
  }

  bubbleTexture(kind: BubbleKind): THREE.CanvasTexture {
    let t = this.bubbleTextures.get(kind);
    if (!t) {
      t = emojiTexture(EMOJI[kind]);
      this.bubbleTextures.set(kind, t);
    }
    return t;
  }

  makeBubble(): Bubble {
    return new Bubble(this);
  }

  private spawnParticle(
    tex: THREE.CanvasTexture,
    pos: THREE.Vector3,
    spread: number,
    up: number,
    ttl: number,
    scale: number,
  ): void {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
    );
    sprite.scale.setScalar(scale);
    sprite.position.copy(pos);
    sprite.renderOrder = 12;
    this.scene.add(sprite);
    this.particles.push({
      sprite,
      vx: (Math.random() - 0.5) * spread,
      vy: up + Math.random() * up * 0.5,
      vz: (Math.random() - 0.5) * spread,
      life: 0,
      ttl,
    });
  }

  heartBurst(pos: THREE.Vector3): void {
    for (let i = 0; i < 6; i++) {
      this.spawnParticle(this.heartTex, pos, 1.2, 1.4, 0.9, 0.5);
    }
  }

  poof(pos: THREE.Vector3): void {
    for (let i = 0; i < 8; i++) {
      this.spawnParticle(this.poofTex, pos, 2.0, 0.8, 0.6, 0.7);
    }
  }

  private makeRing(): Ring {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh);
    return { mesh, canvas, ctx, tex };
  }

  /** Draw / update a flat progress ring at a ground position. frac 0..1. */
  showRing(id: string, pos: THREE.Vector3, radius: number, frac: number): void {
    let ring = this.rings.get(id);
    if (!ring) {
      ring = this.makeRing();
      this.rings.set(id, ring);
    }
    ring.mesh.visible = true;
    ring.mesh.position.set(pos.x, 0.05, pos.z);
    ring.mesh.scale.setScalar(radius * 2.4);
    const { ctx } = ring;
    const s = 128;
    ctx.clearRect(0, 0, s, s);
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(138,107,77,0.25)';
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(127,176,105,0.95)';
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 12, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.stroke();
    ring.tex.needsUpdate = true;
  }

  hideRing(id: string): void {
    const ring = this.rings.get(id);
    if (ring) ring.mesh.visible = false;
  }

  showGlow(pos: THREE.Vector3): void {
    this.glow.visible = true;
    this.glow.position.set(pos.x, 0.03, pos.z);
  }

  hideGlow(): void {
    this.glow.visible = false;
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      const t = p.life / p.ttl;
      if (t >= 1) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      p.vy -= 1.5 * dt;
      p.sprite.material.opacity = 1 - t;
    }
  }
}
