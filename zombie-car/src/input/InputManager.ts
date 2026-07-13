/**
 * Merges keyboard (WASD/arrows) and the virtual joystick into a single
 * normalized world-space direction + magnitude, consumed by the vehicle
 * controller. Screen-relative: "up" (W/ArrowUp, or dragging the joystick
 * up) drives world -Z, matching the world-aligned top-down camera.
 */
import * as THREE from "three";
import type { GameSystem } from "../types";
import { VirtualJoystick } from "./VirtualJoystick";

export interface VehicleInput {
  /** Normalized world-space XZ direction (y is always 0). */
  readonly direction: THREE.Vector3;
  /** 0..1 */
  readonly magnitude: number;
}

/** Minimal surface the vehicle controller needs from an input source. */
export interface InputSource {
  getInput(): VehicleInput;
}

export class InputManager implements GameSystem, InputSource {
  private readonly pressed = new Set<string>();
  private readonly joystick: VirtualJoystick;
  // Reused every call to avoid per-frame allocation.
  private readonly direction = new THREE.Vector3();

  constructor(hudRootId = "hud-root") {
    const hudRoot = document.getElementById(hudRootId) ?? document.body;
    this.joystick = new VirtualJoystick(hudRoot);

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onBlur = this.onBlur.bind(this);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  /** Computed fresh on every call — safe to read from fixedUpdate or update. */
  getInput(): VehicleInput {
    const joy = this.joystick.getValue();
    if (joy.magnitude > 0) {
      this.direction.set(joy.x, 0, joy.z);
      return { direction: this.direction, magnitude: joy.magnitude };
    }

    let x = 0;
    let z = 0;
    if (this.isDown("KeyW", "ArrowUp")) z -= 1;
    if (this.isDown("KeyS", "ArrowDown")) z += 1;
    if (this.isDown("KeyA", "ArrowLeft")) x -= 1;
    if (this.isDown("KeyD", "ArrowRight")) x += 1;

    if (x === 0 && z === 0) {
      this.direction.set(0, 0, 0);
      return { direction: this.direction, magnitude: 0 };
    }

    this.direction.set(x, 0, z).normalize();
    return { direction: this.direction, magnitude: 1 };
  }

  reset(): void {
    this.pressed.clear();
    this.joystick.reset();
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.joystick.destroy();
  }

  private isDown(...codes: string[]): boolean {
    for (const code of codes) {
      if (this.pressed.has(code)) return true;
    }
    return false;
  }

  private onKeyDown(event: KeyboardEvent): void {
    this.pressed.add(event.code);
  }

  private onKeyUp(event: KeyboardEvent): void {
    this.pressed.delete(event.code);
  }

  private onBlur(): void {
    this.pressed.clear();
  }
}
