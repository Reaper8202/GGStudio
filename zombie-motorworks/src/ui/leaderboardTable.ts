import type { BiomeId } from '../core/biomes.ts';
import { formatRunDuration, type LeaderboardRow } from '../core/leaderboard.ts';
import { BIOMES } from '../survival/arena/recipes/index.ts';

export interface LeaderboardTableOptions {
  /** Shown in place of the table when the board has no runs on it. */
  emptyMessage: string;
  ariaLabel?: string;
  /** Adds a completion column rendering each row's `at` timestamp. */
  formatWhen?: (at: number) => string;
}

/** The biome's name, colour-coded so each arena reads at a glance. */
function biomeCell(biomeId: BiomeId | undefined): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.className = 'leaderboard__biome';
  const biome = biomeId === undefined ? undefined : BIOMES[biomeId];
  if (biome === undefined) {
    cell.textContent = '—';
    return cell;
  }
  cell.classList.add(`leaderboard__biome--${biome.id}`);
  cell.textContent = biome.name;
  return cell;
}

/**
 * The one ranked-board table every leaderboard renders: score, wave, kills,
 * run time and biome, with the run that just finished marked for styling.
 */
export function buildLeaderboardTable(
  rows: readonly LeaderboardRow[],
  options: LeaderboardTableOptions,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'leaderboard';
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'leaderboard__empty';
    empty.textContent = options.emptyMessage;
    wrapper.appendChild(empty);
    return wrapper;
  }

  const formatWhen = options.formatWhen;
  const table = document.createElement('table');
  if (options.ariaLabel !== undefined) {
    table.setAttribute('aria-label', options.ariaLabel);
  }
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  const labels = ['#', 'Score', 'Wave', 'Kills', 'Time', 'Biome'];
  if (formatWhen !== undefined) labels.push('When');
  for (const label of labels) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    headRow.appendChild(cell);
  }
  head.appendChild(headRow);

  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    if (row.isCurrentRun) tr.className = 'is-current-run';
    const rank = document.createElement('th');
    rank.scope = 'row';
    rank.textContent = String(row.rank);
    tr.appendChild(rank);
    for (const value of [row.score, row.wave, row.kills]) {
      const cell = document.createElement('td');
      cell.textContent = value.toLocaleString();
      tr.appendChild(cell);
    }
    const time = document.createElement('td');
    time.className = 'leaderboard__time';
    time.textContent = formatRunDuration(row.durationSeconds);
    tr.appendChild(time);
    tr.appendChild(biomeCell(row.biomeId));
    if (formatWhen !== undefined) {
      const completed = document.createElement('td');
      completed.textContent = formatWhen(row.at);
      tr.appendChild(completed);
    }
    body.appendChild(tr);
  }

  table.append(head, body);
  wrapper.appendChild(table);
  return wrapper;
}
