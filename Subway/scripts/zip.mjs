// Packs dist/ into game.zip — the single-ZIP bundle Playables/portals expect.
// Pure Node (store method, no compression deps); Vite output is already minified.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'game.zip');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

// CRC32 (IEEE), table-based.
const TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const files = [...walk(DIST)].sort();
const localParts = [];
const centralParts = [];
let offset = 0;

for (const file of files) {
  const data = readFileSync(file);
  const name = Buffer.from(relative(DIST, file).split(sep).join('/'), 'utf8');
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(0, 8); // method: store
  local.writeUInt16LE(0, 10); // time
  local.writeUInt16LE(0x21, 12); // date (1980-01-01)
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);

  localParts.push(local, name, data);
  centralParts.push(central, name);
  offset += local.length + name.length + data.length;
}

const centralStart = offset;
const centralBuf = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(centralStart, 16);

writeFileSync(OUT, Buffer.concat([...localParts, centralBuf, end]));

const total = files.reduce((s, f) => s + statSync(f).size, 0);
const sha = createHash('sha256').update(readFileSync(OUT)).digest('hex').slice(0, 12);
console.log(
  `game.zip: ${files.length} files, ${(total / 1024 / 1024).toFixed(2)} MB uncompressed, sha256 ${sha}`,
);
if (total > 8 * 1024 * 1024) {
  console.error('WARNING: bundle exceeds the 8 MB initial-load budget!');
  process.exitCode = 1;
}
