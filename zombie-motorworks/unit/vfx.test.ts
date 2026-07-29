import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VfxSystem } from '../src/vfx/VfxSystem.ts';
import {
  defaultParticleSpec,
  VoxelParticles,
} from '../src/vfx/VoxelParticles.ts';
import {
  impactKindForShot,
  muzzleStyleForShot,
  tracerStyleForShot,
  type ShotAppearance,
} from '../src/vfx/shotVfx.ts';
import { FRAME_SPAWN_BUDGET, VFX_PALETTE } from '../src/vfx/vfxConfig.ts';

function spec(overrides: Partial<ReturnType<typeof defaultParticleSpec>> = {}) {
  return { ...defaultParticleSpec(), ...overrides };
}

describe('VoxelParticles pool', () => {
  it('retires particles when their life runs out', () => {
    const pool = new VoxelParticles('lit', 8);
    pool.spawn(spec({ lifeSeconds: 0.1 }));
    pool.spawn(spec({ lifeSeconds: 1 }));
    expect(pool.activeCount).toBe(2);

    pool.update(0.2);
    expect(pool.activeCount).toBe(1);
    pool.update(1);
    expect(pool.activeCount).toBe(0);
    expect(pool.mesh.count).toBe(0);
    expect(pool.mesh.visible).toBe(false);
    pool.dispose();
  });

  it('never exceeds capacity and recycles the particle closest to death', () => {
    const pool = new VoxelParticles('glow', 4);
    for (let i = 0; i < 4; i++) pool.spawn(spec({ lifeSeconds: 1 + i }));
    pool.spawn(spec({ lifeSeconds: 5 }));
    expect(pool.activeCount).toBe(4);

    // The 1s particle was the one recycled, so nothing expires before 2s.
    pool.update(1.5);
    expect(pool.activeCount).toBe(4);
    pool.dispose();
  });

  it('ignores a spec with no life, which is how the frame budget throttles', () => {
    const pool = new VoxelParticles('lit', 4);
    pool.spawn(spec({ lifeSeconds: 0 }));
    expect(pool.activeCount).toBe(0);
    pool.dispose();
  });

  it('settles a sticking particle flat on the ground and holds it there', () => {
    const pool = new VoxelParticles('lit', 4, 0);
    pool.spawn(
      spec({ y: 2, vy: -1, size: 0.2, endSize: 0.2, lifeSeconds: 10, bounce: 0, stick: true }),
    );
    for (let i = 0; i < 120; i++) pool.update(1 / 60);

    const matrix = new THREE.Matrix4();
    pool.mesh.getMatrixAt(0, matrix);
    const position = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect(position.y).toBeGreaterThan(0);
    expect(position.y).toBeLessThan(0.1);

    // A splat is squashed vertically and spread horizontally.
    const scale = new THREE.Vector3().setFromMatrixScale(matrix);
    expect(scale.y).toBeLessThan(scale.x);
    pool.dispose();
  });

  it('lets a particle fall through the ground when collision is disabled', () => {
    const pool = new VoxelParticles('lit', 4, 0);
    pool.spawn(spec({ y: 1, vy: -5, lifeSeconds: 10, bounce: -1 }));
    for (let i = 0; i < 60; i++) pool.update(1 / 60);

    const matrix = new THREE.Matrix4();
    pool.mesh.getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).y).toBeLessThan(0);
    pool.dispose();
  });

  it('removes its mesh from the scene on dispose', () => {
    const scene = new THREE.Scene();
    const pool = new VoxelParticles('lit', 4);
    scene.add(pool.mesh);
    pool.dispose();
    expect(scene.children).toHaveLength(0);
  });
});

describe('VfxSystem emitters', () => {
  function system(): { scene: THREE.Scene; vfx: VfxSystem } {
    const scene = new THREE.Scene();
    const vfx = new VfxSystem(scene);
    vfx.setViewpoint({ x: 0, y: 0, z: 0 });
    return { scene, vfx };
  }

  it('adds exactly two instanced layers to the scene', () => {
    const { scene, vfx } = system();
    expect(scene.children).toHaveLength(2);
    for (const child of scene.children) {
      expect(child).toBeInstanceOf(THREE.InstancedMesh);
    }
    vfx.dispose();
  });

  it.each(['blade', 'spikes', 'drum', 'ram'] as const)(
    'emits particles for a %s contact',
    (kind) => {
      const { vfx } = system();
      vfx.meleeShred(kind, 0, 1, 0, 1, 0, 1);
      expect(vfx.particleCount).toBeGreaterThan(0);
      vfx.dispose();
    },
  );

  it('emits nothing past the cull distance', () => {
    const { vfx } = system();
    vfx.meleeShred('drum', 0, 1, 400, 0, 1, 1);
    expect(vfx.particleCount).toBe(0);
    vfx.dispose();
  });

  it('thins effects out with distance rather than dropping them', () => {
    const near = system();
    const far = system();
    near.vfx.meleeShred('drum', 0, 1, 2, 1, 0, 1);
    far.vfx.meleeShred('drum', 0, 1, 40, 1, 0, 1);
    expect(far.vfx.particleCount).toBeGreaterThan(0);
    expect(far.vfx.particleCount).toBeLessThan(near.vfx.particleCount);
    near.vfx.dispose();
    far.vfx.dispose();
  });

  it('honours the quality scale', () => {
    const { vfx } = system();
    vfx.setQuality(0);
    vfx.meleeShred('drum', 0, 1, 0, 1, 0, 1);
    vfx.zombieGib(0, 1, 0, VFX_PALETTE.flesh);
    expect(vfx.particleCount).toBe(0);
    vfx.dispose();
  });

  it('caps the number of particles spawned in a single frame', () => {
    const { vfx } = system();
    for (let i = 0; i < 200; i++) vfx.meleeShred('drum', 0, 1, 0, 1, 0, 1.5);
    expect(vfx.particleCount).toBeLessThanOrEqual(FRAME_SPAWN_BUDGET);
    vfx.dispose();
  });

  it('refills the budget on the next frame', () => {
    const { vfx } = system();
    for (let i = 0; i < 200; i++) vfx.meleeShred('drum', 0, 1, 0, 1, 0, 1.5);
    const afterFirstFrame = vfx.particleCount;
    vfx.update(1 / 60);
    vfx.meleeShred('drum', 0, 1, 0, 1, 0, 1);
    expect(vfx.particleCount).toBeGreaterThan(afterFirstFrame - 20);
    vfx.dispose();
  });

  it('builds a flame cone from licks, puffs, embers, and smoke', () => {
    const { vfx } = system();
    vfx.flameJet({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 7 });
    expect(vfx.particleCount).toBeGreaterThan(0);
    vfx.dispose();
  });

  it('ignores a zero-length flame ray', () => {
    const { vfx } = system();
    vfx.flameJet({ x: 2, y: 1, z: 2 }, { x: 2, y: 1, z: 2 });
    expect(vfx.particleCount).toBe(0);
    vfx.dispose();
  });

  it('throws more fire from an overcharged nozzle than a stock one', () => {
    const stock = system();
    const hell = system();
    stock.vfx.flameJet({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 7 });
    hell.vfx.flameJet({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 7 }, true);
    expect(hell.vfx.particleCount).toBeGreaterThan(stock.vfx.particleCount);
    stock.vfx.dispose();
    hell.vfx.dispose();
  });

  it('ignores a zero-length hellfire ray too', () => {
    const { vfx } = system();
    vfx.flameJet({ x: 2, y: 1, z: 2 }, { x: 2, y: 1, z: 2 }, true);
    expect(vfx.particleCount).toBe(0);
    vfx.dispose();
  });

  it('gives the hellfire muzzle and impact more presence than the stock ones', () => {
    const stock = system();
    const hell = system();
    stock.vfx.muzzleFlash({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 7 }, 'flame');
    hell.vfx.muzzleFlash({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 7 }, 'hellfire');
    expect(hell.vfx.particleCount).toBeGreaterThan(stock.vfx.particleCount);

    const stockBurn = system();
    const hellBurn = system();
    stockBurn.vfx.bulletImpact(0, 1, 3, 0, 0, 1, 'burn');
    hellBurn.vfx.bulletImpact(0, 1, 3, 0, 0, 1, 'hellburn');
    expect(hellBurn.vfx.particleCount).toBeGreaterThan(
      stockBurn.vfx.particleCount,
    );

    stock.vfx.dispose();
    hell.vfx.dispose();
    stockBurn.vfx.dispose();
    hellBurn.vfx.dispose();
  });

  it('plays a distinct nozzle burst for the flamethrower muzzle', () => {
    const { vfx } = system();
    vfx.muzzleFlash({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 7 }, 'flame');
    expect(vfx.particleCount).toBeGreaterThan(0);
    vfx.dispose();
  });

  it('sets a burn impact alight', () => {
    const { vfx } = system();
    vfx.bulletImpact(0, 1, 3, 0, 0, 1, 'burn');
    expect(vfx.particleCount).toBeGreaterThan(0);
    vfx.dispose();
  });

  it('detonates a shell burst sized to its blast radius', () => {
    const { vfx } = system();
    vfx.shellBurst(0, 0, 3, 4.5);
    expect(vfx.particleCount).toBeGreaterThan(0);
    vfx.dispose();
  });

  it('rolls a freeze burst out to the ability radius', () => {
    const { vfx } = system();
    vfx.freezeBurst(0, 0, 3, 8);
    expect(vfx.particleCount).toBeGreaterThan(0);
    vfx.dispose();
  });

  it('ignores a freeze burst with no radius to cover', () => {
    const { vfx } = system();
    vfx.freezeBurst(0, 0, 3, 0);
    expect(vfx.particleCount).toBe(0);
    vfx.dispose();
  });

  it('encases a caught zombie and shatters the ice again', () => {
    const { vfx } = system();
    vfx.freezeEncase(0, 1, 2);
    const afterEncase = vfx.particleCount;
    expect(afterEncase).toBeGreaterThan(0);

    vfx.frostShatter(0, 1, 2);
    expect(vfx.particleCount).toBeGreaterThan(afterEncase);
    vfx.dispose();
  });

  it('keeps freeze effects out of a scene the camera has left behind', () => {
    const { vfx } = system();
    vfx.freezeBurst(0, 0, 400, 8);
    vfx.freezeEncase(0, 1, 400);
    vfx.frostShatter(0, 1, 400);
    expect(vfx.particleCount).toBe(0);
    vfx.dispose();
  });

  it('gives the heavy muzzle more presence than the standard one', () => {
    const standard = system();
    const heavy = system();
    standard.vfx.muzzleFlash({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 5 }, 'standard');
    heavy.vfx.muzzleFlash({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 5 }, 'heavy');
    expect(heavy.vfx.particleCount).toBeGreaterThan(
      standard.vfx.particleCount,
    );
    standard.vfx.dispose();
    heavy.vfx.dispose();
  });

  it('emits a muzzle event, an impact, and a gib burst', () => {
    const { vfx } = system();
    vfx.muzzleFlash({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 5 }, 'heavy');
    const afterMuzzle = vfx.particleCount;
    expect(afterMuzzle).toBeGreaterThan(0);

    vfx.bulletImpact(0, 1, 5, 0, 0, 1, 'flesh');
    const afterImpact = vfx.particleCount;
    expect(afterImpact).toBeGreaterThan(afterMuzzle);

    vfx.zombieGib(0, 1, 5, VFX_PALETTE.flesh);
    expect(vfx.particleCount).toBeGreaterThan(afterImpact);
    vfx.dispose();
  });

  it('ignores a zero-length muzzle direction', () => {
    const { vfx } = system();
    vfx.muzzleFlash({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }, 'standard');
    expect(vfx.particleCount).toBe(0);
    vfx.dispose();
  });

  it('clears everything on reset', () => {
    const { vfx } = system();
    vfx.zombieGib(0, 1, 0, VFX_PALETTE.flesh);
    expect(vfx.particleCount).toBeGreaterThan(0);
    vfx.reset();
    expect(vfx.particleCount).toBe(0);
    vfx.dispose();
  });

  it('stops emitting once disposed', () => {
    const { vfx } = system();
    vfx.dispose();
    vfx.meleeShred('drum', 0, 1, 0, 1, 0, 1);
    expect(vfx.particleCount).toBe(0);
  });
});

describe('shot appearance rules', () => {
  function shot(overrides: Partial<ShotAppearance> = {}): ShotAppearance {
    return {
      damageType: 'hitscan',
      damage: 3,
      slowFactor: 0,
      hitZombieHandle: null,
      hitSurface: false,
      overcharged: false,
      ...overrides,
    };
  }

  it('maps each weapon class to its own muzzle', () => {
    expect(muzzleStyleForShot(shot())).toBe('standard');
    expect(muzzleStyleForShot(shot({ damage: 50 }))).toBe('sniper');
    expect(
      muzzleStyleForShot(shot({ damage: 40, damageType: 'projectile' })),
    ).toBe('heavy');
    expect(muzzleStyleForShot(shot({ damageType: 'aoe', damage: 9 }))).toBe(
      'flame',
    );
    // The same nozzle, overcharged by Hellfire, gets its own hotter muzzle.
    expect(
      muzzleStyleForShot(
        shot({ damageType: 'aoe', damage: 21, overcharged: true }),
      ),
    ).toBe('hellfire');
    expect(
      muzzleStyleForShot(
        shot({ damage: 6, damageType: 'projectile', slowFactor: 0.5 }),
      ),
    ).toBe('ice');
  });

  it('keeps a fully upgraded turret on the standard muzzle', () => {
    // Turret base damage 3, five upgrade steps at +12% each.
    expect(muzzleStyleForShot(shot({ damage: 3 * 1.12 ** 5 }))).toBe('standard');
  });

  it('sets flame hits alight whatever they landed on', () => {
    const flame = shot({ damageType: 'aoe', damage: 9 });
    expect(impactKindForShot({ ...flame, hitZombieHandle: 7 }, false)).toBe(
      'burn',
    );
    // Flame washes around the phone addict's bubble, so it still burns.
    expect(impactKindForShot({ ...flame, hitZombieHandle: 7 }, true)).toBe(
      'burn',
    );
    expect(impactKindForShot({ ...flame, hitSurface: true }, false)).toBe(
      'burn',
    );
    expect(impactKindForShot(flame, false)).toBeNull();

    // An overcharged ray lands as the hotter burn wherever it lands at all.
    const hell = shot({ damageType: 'aoe', damage: 50, overcharged: true });
    expect(impactKindForShot({ ...hell, hitZombieHandle: 7 }, false)).toBe(
      'hellburn',
    );
    expect(impactKindForShot({ ...hell, hitSurface: true }, false)).toBe(
      'hellburn',
    );
    expect(impactKindForShot(hell, false)).toBeNull();
  });

  it('classifies what the shot terminated against', () => {
    expect(impactKindForShot(shot({ hitZombieHandle: 4 }), false)).toBe('flesh');
    expect(impactKindForShot(shot({ hitZombieHandle: 4 }), true)).toBe('shield');
    expect(
      impactKindForShot(shot({ hitZombieHandle: 4, slowFactor: 0.5 }), false),
    ).toBe('ice');
    expect(impactKindForShot(shot({ hitSurface: true }), false)).toBe('hard');
  });

  it('leaves nothing behind for a round that ran out of range in mid-air', () => {
    expect(impactKindForShot(shot(), false)).toBeNull();
  });

  it('draws cryo fire turquoise and everything else in tracer gold', () => {
    expect(tracerStyleForShot(shot())).toBe('standard');
    expect(
      tracerStyleForShot(shot({ damageType: 'projectile', slowFactor: 0.5 })),
    ).toBe('ice');
    // The flamethrower renders its own cone; a line on top reads as a stray wire.
    expect(tracerStyleForShot(shot({ damageType: 'aoe', damage: 9 }))).toBeNull();
  });
});
