/**
 * Tile-based building. On ui:requestBuild a translucent ghost follows the pointer,
 * snaps to the grid and tints green/red by validity. ui:confirmBuild places it if
 * affordable and valid. Placing a species' first shelter unlocks that species'
 * wild spawning (plan §4). Also handles ui:requestUpgrade.
 */
import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import type { ShelterDef, ZoneId } from '../data/types';
import type { EconomySystem } from './EconomySystem';
import { Shelter } from '../entities/Shelter';
import { getShelter, getAnimal } from '../core/data';
import { makeUid } from '../core/GameContext';

export class BuildSystem {
  active = false;
  private def: ShelterDef | null = null;
  private ghost: THREE.Mesh | null = null;
  private ndc = new THREE.Vector2();
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private lastValid = false;
  private ghostY = 0.6;

  constructor(
    private ctx: GameContext,
    private economy: EconomySystem,
  ) {
    window.addEventListener('pointermove', this.onPointer);
    // double-clicking a valid spot places the shelter directly
    ctx.renderer.domElement.addEventListener('dblclick', (e) => {
      if (!this.active) return;
      this.onPointer(e as unknown as PointerEvent);
      this.confirm();
    });

    ctx.bus.on('ui:requestBuild', (p) => this.enter(p.shelterId));
    ctx.bus.on('ui:confirmBuild', () => this.confirm());
    ctx.bus.on('ui:cancelBuild', () => this.exit());
    ctx.bus.on('ui:requestUpgrade', (p) => this.upgrade(p.shelterUid));
  }

  private onPointer = (e: PointerEvent): void => {
    const el = this.ctx.renderer.domElement;
    const rect = el.getBoundingClientRect();
    this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  };

  private enter(shelterId: string): void {
    this.def = getShelter(shelterId);
    this.active = true;
    const { w, h } = this.def.footprint;
    const cs = this.ctx.grid.cellSize;
    // pens (no building model) preview as a low fence-height slab, buildings as a tall block
    const isPen = this.def.levels[0].model === null;
    const height = isPen ? 0.7 : 1.2;
    this.ghostY = height / 2;
    const geo = new THREE.BoxGeometry(w * cs * (isPen ? 1 : 0.9), height, h * cs * (isPen ? 1 : 0.9));
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7fb069,
      transparent: true,
      opacity: 0.45,
    });
    this.ghost = new THREE.Mesh(geo, mat);
    this.ghost.position.y = this.ghostY;
    this.ctx.scene.add(this.ghost);
    this.ctx.bus.emit('build:mode', { active: true, shelterId });
  }

  private exit(): void {
    this.active = false;
    this.def = null;
    if (this.ghost) {
      this.ctx.scene.remove(this.ghost);
      this.ghost.geometry.dispose();
      (this.ghost.material as THREE.Material).dispose();
      this.ghost = null;
    }
    this.ctx.bus.emit('build:mode', { active: false, shelterId: null });
  }

  private currentAnchor(): { cx: number; cz: number; valid: boolean; zone: ZoneId } | null {
    if (!this.def) return null;
    this.ray.setFromCamera(this.ndc, this.ctx.camera);
    if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return null;
    const { w, h } = this.def.footprint;
    const { cx, cz } = this.ctx.grid.snapFootprint(this.hit.x, this.hit.z, w, h);
    const center = this.ctx.grid.footprintCenter(cx, cz, w, h);
    const zone = this.ctx.grid.zoneAt(center.x, center.z);
    const valid =
      this.ctx.grid.footprintValid(cx, cz, w, h) &&
      this.ctx.state.unlockedZones.includes(zone);
    return { cx, cz, valid, zone };
  }

  update(): void {
    if (!this.active || !this.def || !this.ghost) return;
    const a = this.currentAnchor();
    if (!a) return;
    const center = this.ctx.grid.footprintCenter(a.cx, a.cz, this.def.footprint.w, this.def.footprint.h);
    this.ghost.position.set(center.x, this.ghostY, center.z);
    const affordable = this.economy.canAfford(this.def.levels[0].cost);
    const valid = a.valid && affordable;
    (this.ghost.material as THREE.MeshBasicMaterial).color.setHex(
      valid ? 0x7fb069 : 0xc96f6f,
    );
    if (valid !== this.lastValid) {
      this.lastValid = valid;
      this.ctx.bus.emit('build:ghostValidity', { valid });
    }
  }

  private confirm(): void {
    if (!this.active || !this.def) return;
    const a = this.currentAnchor();
    const cost = this.def.levels[0].cost;
    if (!a || !a.valid) return;
    if (!this.economy.spend(cost, 'build')) return;
    this.place(this.def, a.cx, a.cz, cost);
    this.exit();
  }

  /** Place a shelter (also used for the tutorial's free pre-placed barn). */
  place(def: ShelterDef, cx: number, cz: number, cost: number): Shelter {
    const shelter = new Shelter(makeUid(this.ctx, 'shelter'), def, 0, cx, cz, this.ctx);
    this.ctx.scene.add(shelter.group);
    this.ctx.shelters.push(shelter);
    this.ctx.bus.emit('shelter:placed', {
      shelterUid: shelter.uid,
      shelterId: def.id,
      cost,
    });
    this.unlockSpecies(def);
    this.ctx.fx.poof(new THREE.Vector3(shelter.centerX, 1, shelter.centerZ));
    this.ctx.adapter.happyTime();
    this.ctx.requestSave('build');
    return shelter;
  }

  private unlockSpecies(def: ShelterDef): void {
    for (const speciesId of def.species) {
      const a = getAnimal(speciesId);
      if (a.adGated) continue;
      if (!this.ctx.state.unlockedSpecies.includes(speciesId)) {
        this.ctx.state.unlockedSpecies.push(speciesId);
        this.ctx.bus.emit('species:unlocked', { speciesId });
      }
    }
  }

  upgrade(shelterUid: string): void {
    const shelter = this.ctx.shelters.find((s) => s.uid === shelterUid);
    if (!shelter) return;
    const nextLevel = shelter.level + 1;
    if (nextLevel >= shelter.def.levels.length) return;
    const cost = shelter.def.levels[nextLevel].cost;
    if (!this.economy.spend(cost, 'upgrade')) return;
    shelter.upgrade();
    this.ctx.bus.emit('shelter:upgraded', {
      shelterUid,
      shelterId: shelter.def.id,
      newLevel: shelter.level,
      cost,
    });
    this.ctx.fx.poof(new THREE.Vector3(shelter.centerX, 1.2, shelter.centerZ));
    this.ctx.adapter.happyTime();
    this.ctx.requestSave('upgrade');
  }
}
