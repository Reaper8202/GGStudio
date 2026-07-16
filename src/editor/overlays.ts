/**
 * Analysis overlays: centre-of-mass marker, expected wheel contacts, support
 * polygon, structural connection lines, steering/weapon arc fans.
 * Rebuilt (cheaply) whenever the blueprint or analysis changes.
 */

import * as THREE from 'three';
import type {
  PartDefinition,
  StructuralConnection,
  VehicleAnalysisReport,
  VehicleBlueprint,
} from '../core/types.ts';
import { cellCentreM } from '../core/mass.ts';
import { getPart } from '../core/blueprint.ts';
import { rotateVec } from '../core/grid.ts';

export interface OverlayToggles {
  com: boolean;
  contacts: boolean;
  supportPolygon: boolean;
  connections: boolean;
  arcs: boolean;
}

export function defaultToggles(): OverlayToggles {
  return { com: true, contacts: true, supportPolygon: true, connections: false, arcs: true };
}

export class Overlays {
  readonly group = new THREE.Group();

  rebuild(
    bp: VehicleBlueprint,
    getDef: (id: string) => PartDefinition,
    report: VehicleAnalysisReport,
    connections: StructuralConnection[],
    toggles: OverlayToggles,
    selectedIds: ReadonlySet<string>,
  ): void {
    this.group.clear();

    if (toggles.com && bp.parts.length > 0) {
      const com = report.centreOfMass;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 14, 10),
        new THREE.MeshBasicMaterial({ color: 0xffd23c }),
      );
      marker.position.set(com.x, com.y, com.z);
      this.group.add(marker);
      const drop = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(com.x, com.y, com.z),
          new THREE.Vector3(com.x, 0, com.z),
        ]),
        new THREE.LineDashedMaterial({ color: 0xffd23c, dashSize: 0.08, gapSize: 0.05 }),
      );
      drop.computeLineDistances();
      this.group.add(drop);
    }

    if (toggles.contacts) {
      for (const c of report.wheelContacts) {
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(0.1, 16),
          new THREE.MeshBasicMaterial({
            color: c.grounded ? 0x6fdc6f : 0xff6f5e,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
          }),
        );
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(c.point.x, c.point.y + 0.01, c.point.z);
        this.group.add(disc);
      }
    }

    if (toggles.supportPolygon && report.supportPolygon.length >= 3) {
      const margin = report.stabilityMarginM;
      const color = margin > 0.15 ? 0x59c95e : margin > 0.02 ? 0xe0b13c : 0xe05545;
      const pts = report.supportPolygon.map((p) => new THREE.Vector3(p.x, 0.02, p.z));
      pts.push(pts[0].clone());
      this.group.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color, linewidth: 2 }),
        ),
      );
    }

    if (toggles.connections) {
      const weak: THREE.Vector3[] = [];
      const strong: THREE.Vector3[] = [];
      for (const conn of connections) {
        const a = getPart(bp, conn.aId);
        const b = getPart(bp, conn.bId);
        if (!a || !b) continue;
        const ca = cellCentreM(a.pos);
        const cb = cellCentreM(b.pos);
        const list = conn.maxForce < 12000 ? weak : strong;
        list.push(new THREE.Vector3(ca.x, ca.y, ca.z), new THREE.Vector3(cb.x, cb.y, cb.z));
      }
      if (strong.length) {
        this.group.add(
          new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints(strong),
            new THREE.LineBasicMaterial({ color: 0x53c7f0, transparent: true, opacity: 0.9 }),
          ),
        );
      }
      if (weak.length) {
        this.group.add(
          new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints(weak),
            new THREE.LineBasicMaterial({ color: 0xf06553, transparent: true, opacity: 0.95 }),
          ),
        );
      }
    }

    if (toggles.arcs) {
      for (const id of selectedIds) {
        const placed = getPart(bp, id);
        if (!placed) continue;
        const def = getDef(placed.defId);
        const centre = cellCentreM(placed.pos);
        if (def.wheel && def.wheel.maxSteerAngleDeg > 0) {
          const arc = arcFan(0.55, (def.wheel.maxSteerAngleDeg * Math.PI) / 180, 0x53f0a8);
          const fwd = rotateVec(placed.orient, { x: 0, y: 0, z: 1 });
          arc.position.set(centre.x, centre.y + 0.05, centre.z);
          arc.rotation.y = Math.atan2(fwd.x, fwd.z);
          this.group.add(arc);
        }
        if (def.weapon) {
          const arc = arcFan(
            Math.min(def.weapon.rangeM * 0.12, 2.2),
            (Math.min(def.weapon.arcDeg, 358) * Math.PI) / 180 / 2,
            0xf0c353,
          );
          const fwd = rotateVec(placed.orient, { x: 0, y: 0, z: 1 });
          arc.position.set(centre.x, centre.y + 0.05, centre.z);
          arc.rotation.y = Math.atan2(fwd.x, fwd.z);
          this.group.add(arc);
        }
      }
    }
  }
}

/** Horizontal fan of ±halfAngle around +Z. */
function arcFan(radius: number, halfAngle: number, color: number): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const a = -halfAngle + (2 * halfAngle * i) / steps;
    shape.lineTo(Math.sin(a) * radius, Math.cos(a) * radius);
  }
  shape.lineTo(0, 0);
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
