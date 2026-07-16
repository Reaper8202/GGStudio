/**
 * RuntimeVehicle: owns the assembled body plus engine/fuel/ammo/power state,
 * and coordinates drivetrain → wheels → weapons each step. The test chamber
 * owns the Rapier world/step loop; it calls preStep() before world.step()
 * and feeds contact-force events to onContactForce()/finishStep() after.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import type { PartDefinition, StructuralConnection, VehicleBlueprint } from '../core/types.ts';
import type { AssembledVehicle, GetDef, RuntimeWheel } from './assembler.ts';
import { assembleVehicle } from './assembler.ts';
import type { AckermannGeometry, WheelTelemetry } from './wheels.ts';
import { computeAckermann, stepWheels } from './wheels.ts';
import type { EngineOutput, GearboxState } from './drivetrain.ts';
import { distributeTorque, engineStep, updateGearbox } from './drivetrain.ts';
import type { RuntimeWeapon, TracerShot } from './weapons.ts';
import { createWeapon, stepWeapons } from './weapons.ts';
import { applyImpactDamage, resolveStructure, type DetachedIsland } from './damage.ts';
import type { SurfaceKind } from './surfaces.ts';

export interface VehicleControls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1
  fire: boolean;
  aimYawWorld: number; // rad
}

export interface VehicleTelemetry {
  speedKmh: number;
  rpm: number;
  gear: number;
  fuel: number;
  fuelCapacity: number;
  ammo: number;
  power: number;
  groundedWheels: number;
  totalWheels: number;
  overloadedWheels: string[];
  aliveParts: number;
  detachedParts: number;
  shotsThisStep: TracerShot[];
}

interface RuntimeEngine {
  partId: string;
  def: NonNullable<PartDefinition['engine']>;
  gearbox: GearboxState;
  rpm: number;
}

const POWER_RECHARGE_PER_S = 15;

export class RuntimeVehicle {
  readonly assembled: AssembledVehicle;
  readonly colliderToPart = new Map<number, string>();
  private readonly weapons: RuntimeWeapon[] = [];
  private readonly engines: RuntimeEngine[] = [];
  private geom: AckermannGeometry;
  private fuel = 0;
  private fuelCapacity = 0;
  private ammo = 0;
  private power = 0;
  private powerCapacity = 0;
  private lastWheelTelemetry: WheelTelemetry = { groundedCount: 0, meanDrivenOmega: 0, overloadedWheels: [] };
  private lastShots: TracerShot[] = [];
  private lastRpm = 0;
  private lastGear = 0;
  islands: DetachedIsland[] = [];

  constructor(
    private readonly world: RAPIER.World,
    bp: VehicleBlueprint,
    getDef: GetDef,
    connections: StructuralConnection[],
    spawn: { translation: { x: number; y: number; z: number }; yawRad?: number },
  ) {
    this.assembled = assembleVehicle(world, bp, getDef, connections, spawn);
    for (const [id, part] of this.assembled.parts) {
      for (const h of part.colliderHandles) this.colliderToPart.set(h, id);
      if (part.def.engine) {
        this.engines.push({ partId: id, def: part.def.engine, gearbox: { gear: 0, shiftCooldown: 0 }, rpm: part.def.engine.idleRpm });
      }
      if (part.def.weapon) this.weapons.push(createWeapon(part.placed, part.def.weapon));
      this.fuelCapacity += part.def.fuelCapacity ?? 0;
      this.powerCapacity += part.def.batteryCapacity ?? 0;
      this.ammo += part.def.ammoCapacity ?? 0;
    }
    this.fuel = this.fuelCapacity;
    this.power = this.powerCapacity;
    this.geom = computeAckermann(this.assembled.wheels);
  }

  get body(): RAPIER.RigidBody {
    return this.assembled.body;
  }

  private attachedAliveIds(): Set<string> {
    const out = new Set<string>();
    for (const [id, p] of this.assembled.parts) if (p.alive && !p.detached) out.add(id);
    return out;
  }

  private hasControl(attached: Set<string>): boolean {
    for (const id of attached) {
      if (this.assembled.parts.get(id)!.def.providesControl) return true;
    }
    return false;
  }

  preStep(dt: number, controls: VehicleControls, surfaceOf: (colliderHandle: number) => SurfaceKind): void {
    const attached = this.attachedAliveIds();
    const controllable = this.hasControl(attached);
    const throttle = controllable ? controls.throttle : 0;
    const brake = controllable ? controls.brake : 0;
    const steer = controllable ? controls.steer : 0;

    // Live drivetrain: engines attached+alive with fuel; wheels attached+driven.
    const liveEngines = this.engines.filter((e) => attached.has(e.partId) && this.fuel > 0);
    const drivenWheels = this.assembled.wheels.filter((w) => !w.broken && attached.has(w.partId) && w.driven);

    let totalTorque = 0;
    let rpmDisplay = 0;
    for (const eng of liveEngines) {
      const out: EngineOutput = engineStep(eng.def, eng.gearbox, throttle, this.lastWheelTelemetry.meanDrivenOmega, dt);
      eng.gearbox = updateGearbox(eng.gearbox, out.rpm, eng.def, dt);
      eng.rpm = out.rpm;
      totalTorque += drivenWheels.length > 0 ? out.wheelTorqueTotal : 0;
      this.fuel = Math.max(0, this.fuel - out.fuelUsed);
      rpmDisplay = Math.max(rpmDisplay, out.rpm);
    }
    this.lastRpm = rpmDisplay;
    this.lastGear = liveEngines[0]?.gearbox.gear ?? 0;

    const torques = distributeTorque(totalTorque, drivenWheels.map((w) => w.wheelDef.driveTorqueLimit));
    const driveTorques = new Map<string, number>();
    drivenWheels.forEach((w, i) => driveTorques.set(w.partId, torques[i]));

    this.lastWheelTelemetry = stepWheels(
      this.world,
      this.assembled.body,
      this.assembled.wheels,
      this.geom,
      { throttle, brake, steer, driveTorques },
      dt,
      surfaceOf,
    );

    // Battery recharges while an engine runs.
    if (liveEngines.length > 0) this.power = Math.min(this.powerCapacity, this.power + POWER_RECHARGE_PER_S * dt);

    const weaponResult = stepWeapons(
      this.world,
      this.assembled,
      this.weapons,
      attached,
      { fire: controllable && controls.fire, aimYawWorld: controls.aimYawWorld },
      this.ammo,
      this.power,
      dt,
    );
    this.ammo -= weaponResult.ammoUsed;
    this.power -= weaponResult.powerUsed;
    this.lastShots = weaponResult.shots;
  }

  onContactForce(colliderHandle: number, forceMagnitude: number): void {
    applyImpactDamage(this.assembled, this.colliderToPart, colliderHandle, forceMagnitude);
  }

  /** After event drain: resolve deaths/splits; returns new islands this step. */
  finishStep(): DetachedIsland[] {
    const events = resolveStructure(this.world, this.assembled, this.colliderToPart);
    if (events.detachedIslands.length > 0) {
      this.islands.push(...events.detachedIslands);
      // Losing tanks/ammo/batteries shrinks capacity (and clamps stock).
      this.recomputeResources();
    }
    return events.detachedIslands;
  }

  private recomputeResources(): void {
    let fuelCap = 0;
    let ammoCap = 0;
    let powerCap = 0;
    for (const [, p] of this.assembled.parts) {
      if (!p.alive || p.detached) continue;
      fuelCap += p.def.fuelCapacity ?? 0;
      ammoCap += p.def.ammoCapacity ?? 0;
      powerCap += p.def.batteryCapacity ?? 0;
    }
    this.fuelCapacity = fuelCap;
    this.fuel = Math.min(this.fuel, fuelCap);
    this.ammo = Math.min(this.ammo, ammoCap);
    this.powerCapacity = powerCap;
    this.power = Math.min(this.power, powerCap);
  }

  wheels(): RuntimeWheel[] {
    return this.assembled.wheels;
  }

  weaponStates(): RuntimeWeapon[] {
    return this.weapons;
  }

  telemetry(): VehicleTelemetry {
    const v = this.assembled.body.linvel();
    let alive = 0;
    let detached = 0;
    for (const [, p] of this.assembled.parts) {
      if (p.alive && !p.detached) alive++;
      if (p.detached) detached++;
    }
    return {
      speedKmh: Math.hypot(v.x, v.y, v.z) * 3.6,
      rpm: this.lastRpm,
      gear: this.lastGear,
      fuel: this.fuel,
      fuelCapacity: this.fuelCapacity,
      ammo: this.ammo,
      power: this.power,
      groundedWheels: this.lastWheelTelemetry.groundedCount,
      totalWheels: this.assembled.wheels.filter((w) => !w.broken).length,
      overloadedWheels: this.lastWheelTelemetry.overloadedWheels,
      aliveParts: alive,
      detachedParts: detached,
      shotsThisStep: this.lastShots,
    };
  }

  /** Free everything this vehicle created in the world. */
  dispose(): void {
    for (const isle of this.islands) this.world.removeRigidBody(isle.body);
    this.world.removeRigidBody(this.assembled.body);
    this.islands = [];
  }
}
