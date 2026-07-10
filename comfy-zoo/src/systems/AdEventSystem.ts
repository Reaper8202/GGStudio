/**
 * Rewarded-ad-gated encounters and buffs (plan §5). Legendary paw-print trails
 * (1–2×/session), mythic dino eggs in the Dino Grove, Sad-animal rescue offers,
 * and double-harvest buffs. Rewards are granted ONLY on adapter result 'completed'.
 * On platforms without rewarded ads (Playables softTimerFallback) the same content
 * arrives via a soft timer instead — emitting 'ad:unavailable' with a cooldown.
 */
import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import type { AdPlacement } from '../core/EventBus';
import type { SpawnSystem } from './SpawnSystem';
import type { HungerSystem } from './HungerSystem';
import { BALANCE, LEGENDARIES, MYTHICS, getAnimal } from '../core/data';
import { radialTexture } from '../entities/Fx';
import { DINO_GROVE } from '../world/layout';

interface SoftGrant {
  placement: AdPlacement;
  payload?: string;
  at: number;
}

export class AdEventSystem {
  private legendaryOffers = 0;
  private legendaryTimer = 75;
  private mythicTimer = 120;
  private doubleHarvestCooldown = 0;
  private softGrants: SoftGrant[] = [];
  private trail: THREE.Mesh[] = [];

  constructor(
    private ctx: GameContext,
    private spawner: SpawnSystem,
    private hunger: HungerSystem,
  ) {
    ctx.bus.on('ui:requestAd', (p) => this.handleRequest(p.placement, p.payload));

    ctx.bus.on('animal:sad', (p) => {
      const shelter = ctx.shelters.find((s) => s.uid === p.shelterUid);
      if (!shelter) return;
      // offer a rescue only if the player can't fix it themselves (lacks the food)
      const diets = new Set(shelter.def.species.map((id) => getAnimal(id).diet));
      const lacksFood = [...diets].every((k) => ctx.state.resources[k] <= 0);
      if (lacksFood) this.offer('rescue', p.shelterUid);
    });

    ctx.bus.on('resource:collected', () => {
      if (this.doubleHarvestCooldown > 0) return;
      if (Math.random() < 0.25) {
        this.doubleHarvestCooldown = 120;
        this.offer('doubleHarvest');
      }
    });

    ctx.bus.on('animal:captured', (p) => {
      if (p.tier === 'legendary' || p.tier === 'mythic') this.clearTrail();
    });
  }

  private offer(placement: AdPlacement, payload?: string): void {
    this.ctx.bus.emit('ad:offer', { placement, payload });
  }

  // ---- UI accepted an offer ----
  private handleRequest(placement: AdPlacement, payload?: string): void {
    this.ctx.bus.emit('ad:accepted', { placement });
    if (this.ctx.adapter.capabilities.rewardedAds) {
      void this.ctx.adapter.showRewarded(placement).then((result) => {
        if (result === 'completed') this.grant(placement, payload);
      });
    } else if (this.ctx.adapter.capabilities.softTimerFallback) {
      const cooldown = placement === 'rescue' ? 120 : 300;
      this.ctx.bus.emit('ad:unavailable', { placement, cooldownSeconds: cooldown });
      this.softGrants.push({ placement, payload, at: this.ctx.now + cooldown });
    } else {
      this.ctx.bus.emit('ad:unavailable', { placement, cooldownSeconds: 0 });
    }
  }

  private grant(placement: AdPlacement, payload?: string): void {
    switch (placement) {
      case 'legendary':
        this.grantLegendary(payload);
        break;
      case 'mythicEgg':
        this.grantMythic();
        break;
      case 'rescue':
        this.grantRescue(payload);
        break;
      case 'doubleHarvest':
        this.ctx.state.doubleHarvestUntil = this.ctx.now + BALANCE.doubleHarvestMinutes * 60;
        break;
      case 'skin':
        this.grantSkin(payload);
        break;
      case 'instantBuild':
        break;
    }
    this.ctx.bus.emit('ad:rewardGranted', { placement, payload });
    this.ctx.requestSave('ad');
  }

  private grantLegendary(payload?: string): void {
    const uncaught = LEGENDARIES.filter((a) => !this.ctx.zoopedia.get(a.id)?.caught);
    const def =
      (payload && LEGENDARIES.find((a) => a.id === payload)) ||
      uncaught[0] ||
      LEGENDARIES[0];
    if (!def) return;
    const ang = Math.random() * Math.PI * 2;
    const x = this.ctx.player.x + Math.cos(ang) * 6;
    const z = this.ctx.player.z + Math.sin(ang) * 6;
    this.spawner.spawn(def, x, z);
    this.ctx.fx.heartBurst(new THREE.Vector3(x, 1.2, z));
  }

  private grantMythic(): void {
    // next dino in unlock order that isn't caught yet
    const def = MYTHICS.find((a) => !this.ctx.zoopedia.get(a.id)?.caught) ?? MYTHICS[0];
    if (!def) return;
    const x = DINO_GROVE.minX + Math.random() * (DINO_GROVE.maxX - DINO_GROVE.minX);
    const z = DINO_GROVE.minZ + Math.random() * (DINO_GROVE.maxZ - DINO_GROVE.minZ);
    this.spawner.spawn(def, x, z);
    this.ctx.fx.heartBurst(new THREE.Vector3(x, 1.5, z));
  }

  private grantRescue(payload?: string): void {
    const shelter = this.ctx.shelters.find((s) => s.uid === payload);
    if (!shelter) return;
    shelter.food = shelter.foodMax;
    shelter.setFoodVisual();
    // the hunger update loop will detect the refilled trough and cheer occupants
    this.ctx.bus.emit('shelter:troughChanged', {
      shelterUid: shelter.uid,
      food: shelter.food,
      foodMax: shelter.foodMax,
    });
  }

  private grantSkin(payload?: string): void {
    if (!payload) return;
    // payload format "speciesId:skinId"
    const [speciesId, skinId] = payload.split(':');
    const rec = this.ctx.zoopedia.get(speciesId);
    if (rec && !rec.ownedSkins.includes(skinId)) {
      rec.ownedSkins.push(skinId);
      this.ctx.bus.emit('zoopedia:updated', { speciesId, caught: rec.caught });
    }
  }

  private spawnTrail(tx: number, tz: number): void {
    this.clearTrail();
    const tex = radialTexture('#F2A65A', 0.7);
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = this.ctx.player.x + (tx - this.ctx.player.x) * t;
      const z = this.ctx.player.z + (tz - this.ctx.player.z) * t;
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 0.6),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.04, z);
      this.ctx.scene.add(m);
      this.trail.push(m);
    }
  }

  private clearTrail(): void {
    for (const m of this.trail) this.ctx.scene.remove(m);
    this.trail.length = 0;
  }

  update(dt: number): void {
    if (this.doubleHarvestCooldown > 0) this.doubleHarvestCooldown -= dt;

    // soft-timer grants
    for (let i = this.softGrants.length - 1; i >= 0; i--) {
      if (this.ctx.now >= this.softGrants[i].at) {
        const g = this.softGrants[i];
        this.softGrants.splice(i, 1);
        this.grant(g.placement, g.payload);
      }
    }

    // legendary paw-trail offers, 1–2×/session
    if (this.legendaryOffers < BALANCE.legendaryEncountersPerSession) {
      this.legendaryTimer -= dt;
      if (this.legendaryTimer <= 0) {
        this.legendaryOffers++;
        this.legendaryTimer = 180;
        const def =
          LEGENDARIES.find((a) => !this.ctx.zoopedia.get(a.id)?.caught) ?? LEGENDARIES[0];
        if (def) {
          const ang = Math.random() * Math.PI * 2;
          this.spawnTrail(
            this.ctx.player.x + Math.cos(ang) * 6,
            this.ctx.player.z + Math.sin(ang) * 6,
          );
          this.ctx.bus.emit('encounter:legendary', { speciesId: def.id });
          this.offer('legendary', def.id);
        }
      }
    }

    // mythic egg offers (Dino Grove, only once palm oasis unlocked)
    if (this.ctx.state.unlockedZones.includes('palmOasis')) {
      this.mythicTimer -= dt;
      if (this.mythicTimer <= 0) {
        this.mythicTimer = 240;
        const def = MYTHICS.find((a) => !this.ctx.zoopedia.get(a.id)?.caught);
        if (def) {
          this.ctx.bus.emit('encounter:mythicEgg', { speciesId: def.id });
          this.offer('mythicEgg', def.id);
        }
      }
    }
  }
}
