# Realistic SFX strategy

## Target

Zombie Motorworks should sound like a violent improvised machine, not an
arcade toy. The source hierarchy is:

1. real field recordings;
2. recorded practical Foley;
3. designed effects built from recorded material;
4. synthesis only for an element that cannot plausibly be recorded.

The current pass contains no procedurally generated gameplay sounds.

## Comparable-game research

- Crossout's developers [recorded individual real vehicle engines from
  scratch](https://old.crossout.net/en/news/590/current/) and rebuilt their
  engine playback around those recordings.
- Mad Max's vehicle sound work used extensive engine recording and layered
  vehicle systems; the [sound-team interview](https://www.asoundeffect.com/game-audio-vehicle-sounds-mad-max/)
  is a useful reference for treating each car as a physical machine rather
  than one pitch-shifted loop.
- Dying Light foregrounds performed zombie voices as character work; its
  [official behind-the-scenes feature](https://dyinglightgame.com/news/watch-the-voice-of-zombies/?lang=fr)
  supports using distinct attack, idle, and death performances instead of a
  generic monster chirp.

These references produce three rules for this game: crossfade real engine
loads, layer mechanical/body detail around weapons and destruction, and attach
zombie voices to meaningful AI beats.

## Search method

For each event, search in this order:

1. OpenGameArt, Freesound, Sonniss GDC bundles, Pixabay, and creator-hosted
   libraries using the physical source, not the game label. Examples:
   `AR-15 exterior single shot CC0`, `diesel engine load loop CC BY`,
   `metal chassis shear field recording`, `wet gore Foley CC0`.
2. Verify the licence on the asset's own page. Prefer CC0; accept CC BY when
   the author and source can be preserved here. Reject NC, unclear, or
   scraped/reposted material.
3. Download the original WAV/FLAC/OGG, inspect duration and waveform, remove
   silence or unusable tails, add short fades, loudness-match, and encode a
   browser copy.
4. Keep at least two variants for frequent one-shots. Pitch variation is
   deliberately narrow and is never used to disguise one synthetic source.
5. Record source URL, creator, licence, and processing in
   `public/assets/audio/LICENSES.md` before integration.

Paid packs remain useful as quality references, but their files and close
imitations are not copied. A replacement must come from independently licensed
recordings and be edited to fit this game's timing.

## Event coverage

| System                 | Physical source and runtime treatment                                                                                                                                                                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine                 | Real idle, medium-load, and high-load loops crossfaded by live RPM and throttle.                                                                                                                                                                                                                                            |
| Tyres                  | Real continuous skid recording, opened only by severe wheel-solver slip at high speed on hard ground. Ordinary cornering never opens it.                                                                                                                                                                                    |
| Terrain                | Separate recorded gravel, tank-on-sand, and snow-tractor rolling beds selected by biome and scaled by grounded-wheel count and road speed. Vehicle recordings are mandatory here; footsteps are rejected even when their material texture is convincing in isolation.                                                       |
| Turret                 | Two AR-15 reports with small, bounded variation.                                                                                                                                                                                                                                                                            |
| Heavy cannon           | Two real cannon reports separated from a public-domain field recording, with restrained low-end shaping and a lower, louder mix than the turret.                                                                                                                                                                            |
| Sniper                 | Two bolt-action rifle reports.                                                                                                                                                                                                                                                                                              |
| Gunslinger             | Two real pistol reports, spatialised at the zombie.                                                                                                                                                                                                                                                                         |
| Flamethrower           | Real fire bed kept alive only while shots are arriving.                                                                                                                                                                                                                                                                     |
| Impacts/detachment     | Recorded metal impacts for chassis contact, wood/fixture cracks for walls and scenery, plus a mechanical explosion for catastrophic events.                                                                                                                                                                                 |
| Zombies                | Every archetype has a spatialised ability signature: walker flesh/melee, gunslinger pistol action, thrower launch and debris impact, necromancer phase/electric summon, worker mine mechanism, Phone Addict shield crackle, kamikaze warning ticks/explosion, and behemoth ground slam. Vocal pitch also follows archetype. |
| Ice/electric abilities | Recorded ice breaks and source effects derived from electrical recordings.                                                                                                                                                                                                                                                  |
| Fuel, garage, UI       | A real cash-register bell for purchases; recorded clicks on enabled buttons; and a dedicated 0.4-second upgrade reward built from a mechanism transient and tightly faded bell interval. Confirmed actions retain their own semantic cue over the tactile click.                                                            |
| Garage music           | Original 24-second industrial loop at 80 BPM: minor-key engine-room drone, restrained bass pulse, sparse metal-like plucks, synthetic workshop percussion, and a filtered CC0 engine texture. It fades with Garage entry/exit and shares the existing sound toggle.                                                         |
| Damage and run state   | Floating damage numbers get rate-limited flesh confirmations, with a firmer kill downbeat. Vehicle health loss remains a separate severity-scaled chassis impact. Countdown, wave start, mine warning, recovery jump, invalid ability use, and game over each have concise state feedback.                                  |

## Mix and performance rules

- Cap simultaneous one-shots and rate-limit high-frequency events.
- Attenuate zombie sounds with distance and pan relative to camera heading.
- Keep common gun and impact events dry and short so large waves remain
  readable.
- Route effects through one restrained cleanup bus: remove sub-audible rumble,
  add slight presence for small speakers, and catch only stacked peaks.
- Crossfade loops with gain ramps; never restart an engine layer every frame.
- Keep loose-surface rolling texture separate from tyre squeal: gravel, sand,
  and snow suppress the asphalt skid bed.
- Keep contact and damage distinct: a collision can make a body impact without
  reducing HP, while actual health loss adds a severity-scaled chassis layer.
- Tie zombie signatures to the ability moment, not a random idle bark, and
  include the archetype in cooldown keys so one specialist cannot silence a
  different specialist.
- Boost close zombie events while using a steeper distance curve and hard
  far-field cutoff; nearby threats must read above the vehicle without making
  the whole arena sound equally close.
- Audio failure is non-fatal: missing or undecodable files must not affect
  gameplay.
- Reassess gains by playing a dense late wave, not by auditioning files alone.

## Next recording targets

The highest-value future upgrade is an original vehicle session: the same
diesel engine recorded at idle, several steady loads, acceleration, deceleration,
shutdown, exhaust, and cabin perspectives. After that, record a
dedicated junk-metal Foley session for suspension hits, welded-part stress,
detachment, garage placement, and repair tools. Those recordings would give the
game a unique identity while keeping this event and mix architecture intact.
