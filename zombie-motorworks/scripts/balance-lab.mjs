// Balance Lab: renders the wave difficulty and reward curves to a standalone
// HTML page, so balance can be read off the shipped formulas instead of
// inferred from twenty minutes of play.
//
//   node scripts/balance-lab.mjs                      shipped curves, waves 1-20
//   node scripts/balance-lab.mjs --waves 30           further out
//   node scripts/balance-lab.mjs --tuning cand.json   overlay a candidate tuning
//   node scripts/balance-lab.mjs --out /tmp/lab.html  somewhere else
//
// `--tuning` takes a snapshot from the dev tuner's "Copy tuning" button, and
// charts it against the shipped curves so two candidates can be compared before
// either is adopted.
//
// TypeScript is loaded through Vite's SSR pipeline rather than a separate
// runner, so the Lab always reads the same modules the game does.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 || at === args.length - 1 ? fallback : args[at + 1];
};

const lastWave = Math.max(1, Number(flag('waves', 20)) || 20);
const tuningPath = flag('tuning', null);
const outPath = resolve(flag('out', 'docs/generated/balance-lab.html'));

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn',
  // Nothing here is served to a browser, and the modules loaded are pure
  // TypeScript with no runtime dependencies. Scanning index.html for deps only
  // races the shutdown below and prints an alarming error for no benefit.
  optimizeDeps: { noDiscovery: true, include: [] },
});

let shipped;
let candidate = null;
let candidateName = '';
try {
  const lab = await server.ssrLoadModule('/src/survival/waveLab.ts');
  shipped = { rows: lab.waveLabRows(lastWave), summary: null };
  shipped.summary = lab.summarize(shipped.rows);

  if (tuningPath !== null) {
    const tuning = await server.ssrLoadModule(
      '/src/survival/devtuning/DevTuning.ts',
    );
    const text = await readFile(resolve(tuningPath), 'utf8');
    if (!tuning.importTuningJSON(text)) {
      throw new Error(`${tuningPath} is not a valid tuning snapshot`);
    }
    candidateName = tuningPath;
    candidate = { rows: lab.waveLabRows(lastWave), summary: null };
    candidate.summary = lab.summarize(candidate.rows);
  }
} finally {
  await server.close();
}

const html = render(shipped, candidate, candidateName);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, html, 'utf8');

console.log(`Balance Lab -> ${outPath}`);
console.log(summaryLine('shipped', shipped.summary));
if (candidate !== null) {
  console.log(summaryLine(candidateName, candidate.summary));
}

function summaryLine(label, s) {
  const overflow =
    s.firstOverflowWave === null ? 'never' : `wave ${s.firstOverflowWave}`;
  const ceiling =
    s.lastEscalatingWave === null ? 'never' : `wave ${s.lastEscalatingWave}`;
  const pool =
    s.kindsOverPool.length === 0
      ? ''
      : `\n    ! ${s.kindsOverPool.join(', ')} asked for beyond the spawn pool — ` +
        `the game will quietly spawn fewer than this tuning says`;
  return (
    `  ${label}: cap exceeded ${overflow} | ` +
    `pay drift ${s.payDriftRatio.toFixed(2)}x | ` +
    `late walker share ${(s.lateWalkerShare * 100).toFixed(0)}% | ` +
    `escalation ends ${ceiling}${pool}`
  );
}

/* ------------------------------------------------------------------ render */

function esc(s) {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}

function faults(summary) {
  const overflow =
    summary.firstOverflowWave === null
      ? {
          num: 'none',
          text: 'Every wave fits on screen. Count is doing real work at all depths.',
          sev: 'ok',
        }
      : {
          num: `wave ${summary.firstOverflowWave}`,
          text: 'Where demand first exceeds the on-screen cap. Past here extra zombies queue instead of appearing, so waves get longer rather than harder.',
          sev: 'critical',
        };
  const drift =
    summary.payDriftRatio < 1.25
      ? {
          num: `${summary.payDriftRatio.toFixed(2)}x`,
          text: 'Pay keeps pace with threat across the run.',
          sev: 'ok',
        }
      : {
          num: `${summary.payDriftRatio.toFixed(1)}x worse`,
          text: 'Pay per point of enemy health, first wave against last. Players get steadily poorer against a steadily bigger problem, while shop prices stay fixed.',
          sev: 'critical',
        };
  const walkers = {
    num: `${Math.round(summary.lateWalkerShare * 100)}%`,
    text: 'Share of the deepest wave that is plain walkers. When this stays high, late waves ask the same question as early ones, only for longer.',
    sev: summary.lateWalkerShare > 0.75 ? 'major' : 'ok',
  };
  const ceiling =
    summary.lastEscalatingWave === null
      ? {
          num: 'flat',
          text: 'No multiplier changes across the range measured.',
          sev: 'major',
        }
      : {
          num: `wave ${summary.lastEscalatingWave}`,
          text: 'Last wave on which any multiplier still moves. After this the run has nowhere left to go but queue length.',
          sev: 'major',
        };
  return [
    { tag: 'Pacing', ...overflow },
    { tag: 'Reward', ...drift },
    { tag: 'Variety', ...walkers },
    { tag: 'Ceiling', ...ceiling },
  ];
}

function render(shipped, candidate, candidateName) {
  const rows = shipped.rows;
  const maxPop = Math.max(...rows.map((r) => r.population));
  const cards = faults(shipped.summary)
    .map(
      (f) => `      <div class="fault" data-sev="${f.sev}">
        <span class="tag">${esc(f.tag)}</span>
        <span class="num">${esc(f.num)}</span>
        <p>${esc(f.text)}</p>
      </div>`,
    )
    .join('\n');

  const body = rows
    .map((r) => {
      const over = r.overflow > 0;
      const px = (n) => Math.max(1, Math.round((n / maxPop) * 118));
      const shown = Math.min(r.population, r.maxActive);
      const cell = (v, cls = '') => `<td class="${cls}">${v}</td>`;
      return `          <tr${over ? ' data-band="over"' : ''}>
            ${cell(r.wave)}${cell(r.counts.walker)}
            ${cell(r.counts.thrower || '·', r.counts.thrower ? '' : 'dimmed')}
            ${cell(r.counts.worker || '·', r.counts.worker ? '' : 'dimmed')}
            ${cell(r.counts['phone-addict'] || '·', r.counts['phone-addict'] ? '' : 'dimmed')}
            ${cell(r.population)}${cell(r.maxActive, over ? 'over' : 'dimmed')}
            <td class="barcell"><span class="barwrap"><i class="bar cap" style="width:${px(shown)}px"></i>${
              over
                ? `<i class="bar" style="width:${px(r.overflow)}px;background:var(--rust)"></i>`
                : ''
            }</span></td>
            ${cell(Math.round(r.threat).toLocaleString())}
            ${cell(Math.round(r.threatPerZombie), 'dimmed')}
            ${cell(`${Math.round(r.spawnFloorSeconds)}s`, 'dimmed')}
            ${cell(`${Math.round(r.specialistShare * 100)}%`, 'dimmed')}
            ${cell(`$${r.totalPayout}`)}
            ${cell(r.flatPayout > r.totalPayout ? `$${r.flatPayout}` : '—', r.flatPayout > r.totalPayout * 1.5 ? 'over' : 'dimmed')}
            ${cell(r.payPerThreat.toFixed(3), r.payPerThreat < shipped.rows[0].payPerThreat * 0.6 ? 'over' : '')}
          </tr>`;
    })
    .join('\n');

  const series = JSON.stringify({
    shipped: rows.map((r) => ({
      wave: r.wave,
      threat: r.threat,
      perThreat: r.payPerThreat,
      overflow: r.overflow,
    })),
    candidate:
      candidate === null
        ? null
        : candidate.rows.map((r) => ({
            wave: r.wave,
            threat: r.threat,
            perThreat: r.payPerThreat,
            overflow: r.overflow,
          })),
  });

  const compareNote =
    candidate === null
      ? ''
      : `<p class="note"><strong>Candidate overlay:</strong> ${esc(candidateName)} is drawn dashed against the shipped curves. Compare the shape, not just the endpoints — a candidate that fixes the endpoint but keeps the same mid-run sag has not fixed anything.</p>`;

  return `<title>Balance Lab — waves 1-${lastWave}</title>
<style>
  :root {
    --ink:#16120E; --panel:#201B16; --panel-2:#2A231C; --line:#3A3129;
    --text:#EDE7DE; --dim:#9A9086; --amber:#E8A33D; --amber-soft:#7A5620;
    --rust:#D0563F; --moss:#7A9C63; --steel:#5F87A8;
    --bg:var(--ink); --fg:var(--text);
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg:#E6E7E2; --panel:#F1F1EC; --panel-2:#DFE0DA; --line:#C4C6BD;
      --text:#1C1A16; --dim:#6B6860; --amber:#A96D12; --amber-soft:#E8D3A8;
      --rust:#A93B26; --moss:#4C6E38; --steel:#3D5F7D; --fg:var(--text);
    }
  }
  :root[data-theme="dark"] {
    --bg:#16120E; --panel:#201B16; --panel-2:#2A231C; --line:#3A3129;
    --text:#EDE7DE; --dim:#9A9086; --amber:#E8A33D; --amber-soft:#7A5620;
    --rust:#D0563F; --moss:#7A9C63; --steel:#5F87A8; --fg:var(--text);
  }
  :root[data-theme="light"] {
    --bg:#E6E7E2; --panel:#F1F1EC; --panel-2:#DFE0DA; --line:#C4C6BD;
    --text:#1C1A16; --dim:#6B6860; --amber:#A96D12; --amber-soft:#E8D3A8;
    --rust:#A93B26; --moss:#4C6E38; --steel:#3D5F7D; --fg:var(--text);
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--fg); font-size:16px; line-height:1.55;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .wrap { max-width:1120px; margin:0 auto; padding:3rem 1.5rem 6rem; display:flex; flex-direction:column; gap:3rem; }
  h1 { margin:0; font-size:clamp(1.8rem,4vw,2.6rem); font-weight:800; letter-spacing:-0.02em; line-height:1.06; text-transform:uppercase; text-wrap:balance; }
  h2 { margin:0; font-size:0.78rem; font-weight:700; letter-spacing:0.16em; text-transform:uppercase; color:var(--amber); }
  p { margin:0; }
  section { display:flex; flex-direction:column; gap:1.2rem; }
  .stamp {
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:0.7rem;
    letter-spacing:0.2em; text-transform:uppercase; color:var(--dim);
    display:flex; flex-wrap:wrap; gap:0.4rem 1.4rem;
    padding-bottom:0.9rem; border-bottom:2px solid var(--line);
  }
  .stamp b { color:var(--amber); font-weight:600; }
  header { display:flex; flex-direction:column; gap:1rem; }
  .faults { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:1px; background:var(--line); border:1px solid var(--line); }
  .fault { background:var(--panel); padding:1.1rem 1.15rem 1.25rem; display:flex; flex-direction:column; gap:0.5rem; border-top:3px solid var(--sev,var(--dim)); }
  .fault[data-sev="critical"] { --sev:var(--rust); }
  .fault[data-sev="major"] { --sev:var(--amber); }
  .fault[data-sev="ok"] { --sev:var(--moss); }
  .fault .tag { font-family:ui-monospace,Menlo,monospace; font-size:0.62rem; letter-spacing:0.16em; text-transform:uppercase; color:var(--sev,var(--dim)); font-weight:700; }
  .fault .num { font-family:ui-monospace,Menlo,monospace; font-variant-numeric:tabular-nums; font-size:1.6rem; font-weight:700; line-height:1; letter-spacing:-0.03em; }
  .fault p { font-size:0.84rem; color:var(--dim); }
  .chart-frame { background:var(--panel); border:1px solid var(--line); padding:1.5rem 1.25rem 1.1rem; overflow-x:auto; }
  .chart-frame svg { display:block; width:100%; min-width:520px; height:auto; }
  .legend { display:flex; flex-wrap:wrap; gap:0.4rem 1.5rem; font-size:0.74rem; font-family:ui-monospace,Menlo,monospace; color:var(--dim); margin-top:1rem; padding-top:0.9rem; border-top:1px solid var(--line); }
  .legend span { display:inline-flex; align-items:center; gap:0.45rem; }
  .swatch { width:14px; height:3px; flex:none; }
  .table-frame { overflow-x:auto; border:1px solid var(--line); background:var(--panel); }
  table { border-collapse:collapse; width:100%; min-width:900px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-variant-numeric:tabular-nums; font-size:0.78rem; }
  thead th { text-align:right; padding:0.7rem 0.5rem; font-size:0.6rem; letter-spacing:0.12em; text-transform:uppercase; color:var(--dim); font-weight:700; border-bottom:2px solid var(--line); white-space:nowrap; background:var(--panel-2); position:sticky; top:0; }
  thead th:first-child, tbody td:first-child { text-align:left; }
  tbody td { padding:0.42rem 0.5rem; text-align:right; border-bottom:1px solid var(--line); white-space:nowrap; }
  tbody tr:hover td { background:var(--panel-2); }
  tbody tr[data-band="over"] td:first-child { color:var(--rust); font-weight:700; }
  td.over { color:var(--rust); font-weight:700; }
  td.dimmed { color:var(--dim); }
  .bar { display:inline-block; vertical-align:middle; height:9px; min-width:1px; background:var(--steel); }
  .bar.cap { background:var(--amber-soft); }
  .barcell { text-align:left !important; width:128px; }
  .barwrap { display:flex; align-items:center; gap:4px; }
  .note { border-left:3px solid var(--amber); padding:0.2rem 0 0.2rem 1.1rem; font-size:0.9rem; color:var(--dim); max-width:68ch; }
  .note strong { color:var(--fg); font-weight:600; }
  @media (max-width:620px) { .wrap { padding:2rem 1rem 4rem; gap:2.2rem; } }
</style>

<div class="wrap">
  <header>
    <div class="stamp">
      <span>Zombie Motorworks</span>
      <span>Balance Lab</span>
      <span>Waves <b>1&ndash;${lastWave}</b></span>
      <span>Generated <b>${new Date().toISOString().slice(0, 16).replace('T', ' ')}</b></span>
      ${candidate === null ? '' : `<span>Overlay <b>${esc(candidateName)}</b></span>`}
    </div>
    <h1>Wave difficulty and reward, measured</h1>
    <p class="note">Computed by evaluating the shipped curve functions directly, so this is what the game actually does rather than an estimate. It measures the <strong>supply side</strong> only &mdash; what the game sends at you. Real clear times depend on pathing, weapon uptime and driving, which need play to calibrate.</p>
  </header>

  <section>
    <h2>Readings</h2>
    <div class="faults">
${cards}
    </div>
  </section>

  <section>
    <h2>Threat against pay</h2>
    <div class="chart-frame">
      <svg id="divergence" viewBox="0 0 900 340" role="img" aria-label="Total enemy health per wave against money earned per point of enemy health."></svg>
      <div class="legend">
        <span><i class="swatch" style="background:var(--rust)"></i> Enemy health in the wave</span>
        <span><i class="swatch" style="background:var(--moss)"></i> Money per point of enemy health</span>
        <span><i class="swatch" style="background:var(--amber)"></i> On-screen cap exceeded</span>
        ${candidate === null ? '' : '<span><i class="swatch" style="background:var(--steel)"></i> Candidate (dashed)</span>'}
      </div>
    </div>
    <p class="note">These two should stay roughly parallel &mdash; a wave that is twice the work should pay about twice as well. Where they diverge, the shop is drifting out of reach.</p>
    ${compareNote}
  </section>

  <section>
    <h2>Wave-by-wave</h2>
    <div class="table-frame">
      <table>
        <thead>
          <tr>
            <th>Wave</th><th>Walk</th><th>Throw</th><th>Work</th><th>Phone</th>
            <th>Sent</th><th>Cap</th><th class="barcell">On screen vs sent</th>
            <th>Enemy HP</th><th>HP each</th><th>Spawn floor</th><th>Specialist</th>
            <th>Pay</th><th>Flat pay</th><th>$/HP</th>
          </tr>
        </thead>
        <tbody>
${body}
        </tbody>
      </table>
    </div>
    <p class="note"><strong>Sent</strong> is what the wave asks for, <strong>cap</strong> is how many can exist at once; the surplus is pure duration. <strong>Spawn floor</strong> is the shortest the wave can possibly run, set by the spawn schedule alone. <strong>Flat pay</strong> is what the wave would pay if money kept pace with threat at wave one's rate &mdash; the gap against <strong>Pay</strong> is the shortfall a player feels as the shop drifting away.</p>
  </section>
</div>

<script>
const DATA = ${series};
const svg = document.getElementById('divergence');
const W = 900, H = 340, L = 58, R = 58, T = 22, B = 40;
const all = DATA.candidate ? DATA.shipped.concat(DATA.candidate) : DATA.shipped;
const lastWave = Math.max(...DATA.shipped.map((d) => d.wave));
const x = (w) => L + ((w - 1) / Math.max(1, lastWave - 1)) * (W - L - R);
const maxThreat = Math.max(...all.map((d) => d.threat));
const maxPer = Math.max(...all.map((d) => d.perThreat));
const yT = (v) => T + (1 - v / maxThreat) * (H - T - B);
const yP = (v) => T + (1 - v / maxPer) * (H - T - B);
const line = (pts, fn, key) =>
  pts.map((d, i) => (i ? 'L' : 'M') + x(d.wave).toFixed(1) + ' ' + fn(d[key]).toFixed(1)).join(' ');

let g = '';
const tick = Math.max(1, Math.round(lastWave / 10));
for (let w = 1; w <= lastWave; w += 1) {
  if (w !== 1 && w % tick !== 0) continue;
  g += '<line x1="' + x(w) + '" y1="' + T + '" x2="' + x(w) + '" y2="' + (H - B) + '" stroke="var(--line)" stroke-width="1"/>';
  g += '<text x="' + x(w) + '" y="' + (H - B + 20) + '" fill="var(--dim)" font-size="11" text-anchor="middle" font-family="ui-monospace, Menlo, monospace">' + w + '</text>';
}
const capAt = DATA.shipped.find((d) => d.overflow > 0);
if (capAt) {
  g += '<line x1="' + x(capAt.wave) + '" y1="' + T + '" x2="' + x(capAt.wave) + '" y2="' + (H - B) + '" stroke="var(--amber)" stroke-width="1.5" stroke-dasharray="4 4"/>';
  g += '<text x="' + (x(capAt.wave) + 7) + '" y="' + (T + 13) + '" fill="var(--amber)" font-size="11" font-family="ui-monospace, Menlo, monospace">cap exceeded</text>';
}
if (DATA.candidate) {
  g += '<path d="' + line(DATA.candidate, yT, 'threat') + '" fill="none" stroke="var(--steel)" stroke-width="2" stroke-dasharray="5 4"/>';
  g += '<path d="' + line(DATA.candidate, yP, 'perThreat') + '" fill="none" stroke="var(--steel)" stroke-width="2" stroke-dasharray="5 4" opacity="0.65"/>';
}
g += '<path d="' + line(DATA.shipped, yT, 'threat') + '" fill="none" stroke="var(--rust)" stroke-width="2.5" stroke-linejoin="round"/>';
g += '<path d="' + line(DATA.shipped, yP, 'perThreat') + '" fill="none" stroke="var(--moss)" stroke-width="2.5" stroke-linejoin="round"/>';
const ends = [DATA.shipped[0], DATA.shipped[DATA.shipped.length - 1]];
for (const d of ends) {
  g += '<circle cx="' + x(d.wave) + '" cy="' + yT(d.threat) + '" r="3.5" fill="var(--rust)"/>';
  g += '<circle cx="' + x(d.wave) + '" cy="' + yP(d.perThreat) + '" r="3.5" fill="var(--moss)"/>';
}
const label = (d, fn, key, anchor, dx, fill, text) =>
  '<text x="' + (x(d.wave) + dx) + '" y="' + (fn(d[key]) + 4) + '" fill="' + fill + '" font-size="11" text-anchor="' + anchor + '" font-family="ui-monospace, Menlo, monospace">' + text + '</text>';
g += label(ends[0], yT, 'threat', 'end', -8, 'var(--rust)', Math.round(ends[0].threat));
g += label(ends[1], yT, 'threat', 'start', 8, 'var(--rust)', Math.round(ends[1].threat));
g += label(ends[0], yP, 'perThreat', 'end', -8, 'var(--moss)', ends[0].perThreat.toFixed(3));
g += label(ends[1], yP, 'perThreat', 'start', 8, 'var(--moss)', ends[1].perThreat.toFixed(3));
svg.innerHTML = g;
</script>
`;
}
