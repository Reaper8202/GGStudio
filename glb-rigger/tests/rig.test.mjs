import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  applyOverrides,
  assignTriangles,
  connectedComponents,
  distSqToSegment,
  loadRig,
  nearestBone,
  parseArgs,
} from '../rig.mjs';

const MINIMAL = {
  joints: [
    { name: 'root', parent: null, pos: [0, 0, 0], tip: [0, 1, 0] },
    { name: 'child', parent: 'root', pos: [0, 1, 0], tip: [0, 2, 0] },
  ],
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

test('defaults the output beside the input', () => {
  const options = parseArgs(['models/hero.glb', '-c', 'rig.json']);
  assert.equal(options.output, path.join('models', 'hero.rigged.glb'));
  assert.equal(options.snap, true);
  assert.equal(options.snapMaxTriangles, 32);
});

test('requires an input and a config', () => {
  assert.throws(() => parseArgs([]), /input GLB is required/);
  assert.throws(() => parseArgs(['a.glb']), /--config is required/);
});

test('rejects a second input and unknown flags', () => {
  assert.throws(() => parseArgs(['a.glb', 'b.glb', '-c', 'r.json']), /Only one input/);
  assert.throws(() => parseArgs(['a.glb', '-c', 'r.json', '--wat']), /Unknown option: --wat/);
});

test('validates --snap-max', () => {
  assert.equal(parseArgs(['a.glb', '-c', 'r.json', '--snap-max', '0']).snapMaxTriangles, 0);
  assert.throws(() => parseArgs(['a.glb', '-c', 'r.json', '--snap-max', 'lots']), /non-negative/);
  assert.throws(() => parseArgs(['a.glb', '-c', 'r.json', '--snap-max', '-4']), /non-negative/);
});

test('--no-snap turns snapping off', () => {
  assert.equal(parseArgs(['a.glb', '-c', 'r.json', '--no-snap']).snap, false);
});

// ---------------------------------------------------------------------------
// Rig config
// ---------------------------------------------------------------------------

test('loads a valid rig and indexes bones in config order', () => {
  const { bones, root, overrides } = loadRig(MINIMAL);
  assert.equal(root, 'root');
  assert.deepEqual(bones.map((b) => b.name), ['root', 'child']);
  assert.deepEqual(bones.map((b) => b.index), [0, 1]);
  assert.equal(bones[0].radius, 1);
  assert.deepEqual(overrides, []);
});

test('derives a tip from an only child when none is given', () => {
  const { bones } = loadRig({
    joints: [
      { name: 'root', parent: null, pos: [0, 0, 0] },
      { name: 'child', parent: 'root', pos: [0, 3, 0], tip: [0, 4, 0] },
    ],
  });
  assert.deepEqual(bones[0].tip, [0, 3, 0]);
});

test('requires an explicit tip when a joint branches', () => {
  assert.throws(
    () =>
      loadRig({
        joints: [
          { name: 'root', parent: null, pos: [0, 0, 0] },
          { name: 'a', parent: 'root', pos: [1, 0, 0], tip: [2, 0, 0] },
          { name: 'b', parent: 'root', pos: [-1, 0, 0], tip: [-2, 0, 0] },
        ],
      }),
    /needs an explicit "tip"/,
  );
});

test('rejects malformed hierarchies', () => {
  assert.throws(() => loadRig({ joints: [] }), /non-empty "joints"/);
  assert.throws(
    () => loadRig({ joints: [{ name: 'a', parent: null, pos: [0, 0, 0], tip: [0, 1, 0] },
                             { name: 'b', parent: null, pos: [1, 0, 0], tip: [1, 1, 0] }] }),
    /exactly one root/,
  );
  assert.throws(
    () => loadRig({ joints: [{ name: 'a', parent: 'ghost', pos: [0, 0, 0], tip: [0, 1, 0] }] }),
    /unknown parent/,
  );
  assert.throws(
    () => loadRig({ joints: [{ name: 'a', parent: null, pos: [0, 0, 0] }, { name: 'a', parent: 'a', pos: [0, 1, 0] }] }),
    /Duplicate joint/,
  );
});

test('rejects a cycle', () => {
  assert.throws(
    () =>
      loadRig({
        joints: [
          { name: 'root', parent: null, pos: [0, 0, 0], tip: [0, 1, 0] },
          { name: 'a', parent: 'b', pos: [0, 1, 0], tip: [0, 2, 0] },
          { name: 'b', parent: 'a', pos: [0, 2, 0], tip: [0, 3, 0] },
        ],
      }),
    /Cycle in rig|exactly one root/,
  );
});

test('resolves overrides to bone indices and rejects unknown targets', () => {
  const { overrides } = loadRig({
    ...MINIMAL,
    overrides: [{ bone: 'child', min: [0, 0, 0], max: [1, 1, 1] }],
  });
  assert.equal(overrides[0].bone, 1);
  assert.throws(
    () => loadRig({ ...MINIMAL, overrides: [{ bone: 'ghost', min: [0, 0, 0], max: [1, 1, 1] }] }),
    /unknown bone/,
  );
  assert.throws(
    () => loadRig({ ...MINIMAL, overrides: [{ bone: 'child', min: [0, 0], max: [1, 1, 1] }] }),
    /needs a 3-number "min"/,
  );
});

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

test('distSqToSegment measures perpendicular distance and clamps past the ends', () => {
  const a = [0, 0, 0], b = [1, 0, 0];
  assert.equal(distSqToSegment([0.5, 1, 0], a, b), 1);
  assert.equal(distSqToSegment([3, 0, 0], a, b), 4); // clamps to b
  assert.equal(distSqToSegment([-2, 0, 0], a, b), 4); // clamps to a
  assert.equal(distSqToSegment([0.5, 0, 0], a, b), 0);
});

test('distSqToSegment handles a degenerate zero-length bone', () => {
  assert.equal(distSqToSegment([0, 2, 0], [0, 0, 0], [0, 0, 0]), 4);
});

test('nearestBone picks the closest segment', () => {
  const bones = [
    { index: 0, pos: [0, 0, 0], tip: [0, 1, 0], radius: 1 },
    { index: 1, pos: [5, 0, 0], tip: [5, 1, 0], radius: 1 },
  ];
  assert.equal(nearestBone([0.2, 0.5, 0], bones), 0);
  assert.equal(nearestBone([4.8, 0.5, 0], bones), 1);
});

test('a larger radius makes a bone greedier', () => {
  const point = [2.4, 0, 0];
  const even = [
    { index: 0, pos: [0, 0, 0], tip: [0, 1, 0], radius: 1 },
    { index: 1, pos: [5, 0, 0], tip: [5, 1, 0], radius: 1 },
  ];
  assert.equal(nearestBone(point, even), 0);
  const greedy = [even[0], { ...even[1], radius: 3 }];
  assert.equal(nearestBone(point, greedy), 1);
});

test('connectedComponents separates disjoint shells', () => {
  // Two triangles sharing no vertices.
  const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
  const label = connectedComponents(indices, 6);
  assert.equal(label[0], label[1]);
  assert.equal(label[1], label[2]);
  assert.equal(label[3], label[5]);
  assert.notEqual(label[0], label[3]);
});

test('connectedComponents joins triangles that share a vertex', () => {
  const indices = new Uint32Array([0, 1, 2, 2, 3, 4]);
  const label = connectedComponents(indices, 5);
  assert.equal(label[0], label[4]);
});

/** Two triangles in one shell, one near each of two far-apart bones. */
function splitShell() {
  const positions = new Float32Array([
    0, 0, 0, 0.1, 0, 0, 0, 0.1, 0, // triangle near bone 0
    10, 0, 0, 10.1, 0, 0, 10, 0.1, 0, // triangle near bone 1
  ]);
  // Index 2 is shared, welding both triangles into a single shell.
  const indices = new Uint32Array([0, 1, 2, 3, 4, 2]);
  const bones = [
    { index: 0, pos: [0, 0, 0], tip: [0, 1, 0], radius: 1 },
    { index: 1, pos: [10, 0, 0], tip: [10, 1, 0], radius: 1 },
  ];
  return { positions, indices, bones };
}

test('without snapping each triangle follows its own nearest bone', () => {
  const { positions, indices, bones } = splitShell();
  const assignment = assignTriangles(positions, indices, bones, { snap: false });
  assert.deepEqual([...assignment], [0, 1]);
});

test('snapping pulls a small shell onto one bone', () => {
  const { positions, indices, bones } = splitShell();
  const assignment = assignTriangles(positions, indices, bones, { snap: true, snapMaxTriangles: 32 });
  assert.equal(assignment[0], assignment[1]);
});

test('shells above the snap threshold keep per-triangle assignment', () => {
  const { positions, indices, bones } = splitShell();
  const assignment = assignTriangles(positions, indices, bones, { snap: true, snapMaxTriangles: 1 });
  assert.deepEqual([...assignment], [0, 1]);
});

test('every triangle is assigned to exactly one existing bone', () => {
  const { positions, indices, bones } = splitShell();
  const assignment = assignTriangles(positions, indices, bones, {});
  assert.equal(assignment.length, indices.length / 3);
  for (const bone of assignment) {
    assert.ok(bone >= 0 && bone < bones.length);
  }
});

test('applyOverrides forces triangles inside the box and leaves others alone', () => {
  const centroids = new Float32Array([0, 0, 0, 10, 10, 10]);
  const assignment = Int32Array.from([0, 0]);
  applyOverrides(centroids, assignment, [
    { bone: 1, min: [-1, -1, -1], max: [1, 1, 1] },
  ]);
  assert.deepEqual([...assignment], [1, 0]);
});

test('overrides beat snapping', () => {
  const { positions, indices, bones } = splitShell();
  // Snapping alone unifies the shell onto bone 0; the override splits it back
  // out. The box straddles x=6.7, where the shared vertex puts triangle 1's
  // centroid — overrides test the centroid, not the vertices.
  const snapped = assignTriangles(positions, indices, bones, { snap: true, snapMaxTriangles: 32 });
  assert.deepEqual([...snapped], [0, 0]);

  const assignment = assignTriangles(positions, indices, bones, {
    snap: true,
    snapMaxTriangles: 32,
    overrides: [{ bone: 1, min: [6, -1, -1], max: [8, 1, 1] }],
  });
  assert.deepEqual([...assignment], [0, 1]);
});

test('the first matching override wins', () => {
  const centroids = new Float32Array([0, 0, 0]);
  const assignment = Int32Array.from([5]);
  applyOverrides(centroids, assignment, [
    { bone: 2, min: [-1, -1, -1], max: [1, 1, 1] },
    { bone: 3, min: [-1, -1, -1], max: [1, 1, 1] },
  ]);
  assert.equal(assignment[0], 2);
});
