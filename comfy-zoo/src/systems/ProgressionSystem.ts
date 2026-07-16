/**
 * Zone unlocks by total-housed milestones (balance.zones) and interstitial
 * throttling: shown only after closing the build menu following a placement or
 * on zone transitions, never before the first capture, and at most once per
 * interstitialMinIntervalSeconds.
 */
import type { GameContext } from '../core/GameContext';
import type { ZoneId } from '../data/types';
import { BALANCE } from '../core/data';

export class ProgressionSystem {
  private lastInterstitialAt = -Infinity;
  private hasCaptured = false;
  private placedSinceMenuOpen = false;
  private lastZone: ZoneId = 'meadow';

  constructor(private ctx: GameContext) {
    ctx.bus.on('animal:captured', () => (this.hasCaptured = true));
    ctx.bus.on('animal:housed', () => this.checkZoneUnlocks());
    ctx.bus.on('shelter:placed', () => (this.placedSinceMenuOpen = true));
    ctx.bus.on('ui:menuOpened', (p) => {
      if (p.menu === 'build') this.placedSinceMenuOpen = false;
    });
    ctx.bus.on('ui:menuClosed', (p) => {
      if (p.menu === 'build' && this.placedSinceMenuOpen) {
        this.placedSinceMenuOpen = false;
        this.tryInterstitial();
      }
    });
  }

  totalHoused(): number {
    return this.ctx.shelters.reduce((n, s) => n + s.occupants.length, 0);
  }

  checkZoneUnlocks(): void {
    const housed = this.totalHoused();
    for (const zone of BALANCE.zones) {
      if (housed >= zone.unlockAtHoused && !this.ctx.state.unlockedZones.includes(zone.id)) {
        this.ctx.state.unlockedZones.push(zone.id);
        this.ctx.bus.emit('zone:unlocked', { zoneId: zone.id });
        this.ctx.requestSave('zone');
      }
    }
  }

  private tryInterstitial(): void {
    if (!this.hasCaptured) return;
    if (!this.ctx.adapter.capabilities.interstitialAds) return;
    if (this.ctx.now - this.lastInterstitialAt < BALANCE.interstitialMinIntervalSeconds) {
      return;
    }
    this.lastInterstitialAt = this.ctx.now;
    void this.ctx.adapter.showInterstitial();
  }

  update(): void {
    const zone = this.ctx.grid.zoneAt(this.ctx.player.x, this.ctx.player.z);
    if (zone !== this.lastZone) {
      this.lastZone = zone;
      this.tryInterstitial();
    }
  }

  currentZone(): ZoneId {
    return this.lastZone;
  }
}
