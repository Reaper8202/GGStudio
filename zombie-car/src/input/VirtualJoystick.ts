/**
 * Bottom-left circular virtual joystick. Works with touch AND mouse via
 * Pointer Events. Lives inside `#hud-root` in its own `pointer-events:auto`
 * container (the HUD root itself is `pointer-events:none`).
 */
import "./joystick.css";

const DEAD_ZONE_FRACTION = 0.12;

export interface JoystickValue {
  /** Normalized world-space X component, -1..1. */
  x: number;
  /** Normalized world-space Z component, -1..1. */
  z: number;
  /** 0..1 after dead-zone remapping. */
  magnitude: number;
}

export class VirtualJoystick {
  private readonly rootEl: HTMLDivElement;
  private readonly baseEl: HTMLDivElement;
  private readonly knobEl: HTMLDivElement;

  private dragging = false;
  private pointerId: number | null = null;

  private dirX = 0;
  private dirZ = 0;
  private magnitude = 0;

  constructor(hudRoot: HTMLElement) {
    this.rootEl = document.createElement("div");
    this.rootEl.className = "vjoy-root";

    this.baseEl = document.createElement("div");
    this.baseEl.className = "vjoy-base";

    this.knobEl = document.createElement("div");
    this.knobEl.className = "vjoy-knob vjoy-snap";

    this.baseEl.appendChild(this.knobEl);
    this.rootEl.appendChild(this.baseEl);
    hudRoot.appendChild(this.rootEl);

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);

    this.baseEl.addEventListener("pointerdown", this.onPointerDown);
    this.baseEl.addEventListener("pointermove", this.onPointerMove);
    this.baseEl.addEventListener("pointerup", this.onPointerUp);
    this.baseEl.addEventListener("pointercancel", this.onPointerUp);
  }

  getValue(): JoystickValue {
    return { x: this.dirX, z: this.dirZ, magnitude: this.magnitude };
  }

  /** Snaps the knob back to center and clears the current value. */
  reset(): void {
    this.dragging = false;
    this.pointerId = null;
    this.dirX = 0;
    this.dirZ = 0;
    this.magnitude = 0;
    this.knobEl.classList.add("vjoy-snap");
    this.knobEl.style.transform = "translate(0px, 0px)";
  }

  destroy(): void {
    this.baseEl.removeEventListener("pointerdown", this.onPointerDown);
    this.baseEl.removeEventListener("pointermove", this.onPointerMove);
    this.baseEl.removeEventListener("pointerup", this.onPointerUp);
    this.baseEl.removeEventListener("pointercancel", this.onPointerUp);
    this.rootEl.remove();
  }

  private onPointerDown(event: PointerEvent): void {
    this.dragging = true;
    this.pointerId = event.pointerId;
    this.knobEl.classList.remove("vjoy-snap");
    this.baseEl.setPointerCapture(event.pointerId);
    this.updateFromEvent(event);
    event.preventDefault();
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.dragging || event.pointerId !== this.pointerId) return;
    this.updateFromEvent(event);
    event.preventDefault();
  }

  private onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    if (this.baseEl.hasPointerCapture(event.pointerId)) {
      this.baseEl.releasePointerCapture(event.pointerId);
    }
    this.reset();
    event.preventDefault();
  }

  private updateFromEvent(event: PointerEvent): void {
    const rect = this.baseEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    const radius = rect.width / 2;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, radius);
    const angle = Math.atan2(dy, dx);
    const knobX = Math.cos(angle) * clampedDist;
    const knobY = Math.sin(angle) * clampedDist;
    this.knobEl.style.transform = `translate(${knobX}px, ${knobY}px)`;

    const deadZonePx = radius * DEAD_ZONE_FRACTION;
    if (dist < deadZonePx) {
      this.dirX = 0;
      this.dirZ = 0;
      this.magnitude = 0;
      return;
    }

    // Screen-right -> world +X. Screen-down -> world +Z (screen-up is
    // world -Z, matching the world-aligned top-down camera).
    this.dirX = dx / dist;
    this.dirZ = dy / dist;
    this.magnitude = Math.min(
      (clampedDist - deadZonePx) / (radius - deadZonePx),
      1
    );
  }
}
