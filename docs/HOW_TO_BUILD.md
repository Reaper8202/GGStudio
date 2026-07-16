# How to Build a Vehicle — Step-by-Step Guide

The in-game **? Help** button (top bar) shows a condensed version of this guide.
This document walks through building a working truck from an empty grid.

## The one big rule

Everything snaps to a 3D grid, and **every part must connect face-to-face to
your existing build** — no floating parts. Your build always grows outward
from the orange **Chassis Core**. Think LEGO, not free placement.

Some parts are picky about *where* they connect:

| Part | Attaches to |
|---|---|
| Frames, seat, fuel tank, battery, ammo, cargo | any face of any structural part |
| **Wheel** | the **left/right side** of a **Wheel Mount** (teal) |
| **Engine** | the **top** of an **Engine Mount** |
| **Fixed Gun / Turret** | the **top** of a **Hardpoint** |
| **Armour / Shell panel** | any exposed **face** of a part (one panel per face) |

Wheels also need the cell **directly below them empty** — that's their
suspension travel space.

## Step 1 — Learn the ghost

Click any part in the left palette. A translucent ghost now follows your
mouse across the grid:

- **Green** — click to place it there.
- **Red** — can't place; a tooltip near the cursor says exactly why
  ("Wheel needs a wheel mount", "Cells already occupied"…).
- **R** spins the ghost, **F** tips it over. The small **yellow notch** shows
  which way the part faces.
- **Esc** puts the part away. **Ctrl+Z** undoes anything.

Camera: drag to orbit, scroll to zoom, keys **1–5** jump to
perspective/front/rear/side/top views.

## Step 2 — Build a chassis deck

Press **New** for an empty grid (or keep editing the starter rig). Place
**Frame Boxes** around the Chassis Core to form a flat deck — say 3 wide and
5 long, one layer up off the ground. Wide and long is stable; tall and narrow
tips over. Tip: turn on the **Symmetry** button and build only one side —
the other side mirrors automatically.

## Step 3 — Wheel mounts, then wheels

Place four **Wheel Mounts** (teal) at the corners of the deck. Their side
faces (the ones with sockets) must face outward, left and right.

Now grab a **Wheel** and hover it against the *outside face* of each mount.
If it shows red with "wheel needs a wheel mount", press **R** a couple of
times — the wheel's hub must face the mount.

Spread the wheels apart: a **long wheelbase** stops the truck from doing
wheelies, a **wide track** stops it from rolling over in corners.

## Step 4 — Drivetrain and driver

1. Place an **Engine Mount** on the deck (rear is good — over the driven
   wheels means more traction).
2. Place an **Engine on top of it**. Small engine is plenty for a light rig.
3. Place a **Fuel Tank** and a **Driver Seat** anywhere on the frame.

## Step 5 — Configure the wheels (don't skip this!)

Click each wheel and use the right-hand panel:

- **driven** — receives engine power. *No driven wheels = the truck sits
  there revving.* Drive the rear pair, or all four.
- **steering** — turns with A/D. Steer the front pair.
- **braking** — leave on.
- **suspension preset** — `standard` to start; `heavy-duty` if you armour up;
  `off-road` for the ramp/bumps scenarios.

## Step 6 — Read the analysis before driving

The right panel and the 3D overlays are your engineering report:

- **Yellow ball + dashed line** = centre of mass. Keep it low and centred.
- **Green ground outline** = your wheel footprint (support polygon). If the
  dashed line lands outside it, the vehicle falls over while parked.
- **Stability / Max slope / Power-weight** tell you how it will behave before
  you ever drive it.
- **Warnings (orange) never block you** — they're advice. Only red errors
  (no engine, no seat, floating parts) disable TEST DRIVE, and the button's
  tooltip lists them.

## Step 7 — Test drive

**▶ TEST DRIVE** drops you into the chamber: **W** throttle, **S/Space**
brake, **A/D** steer, mouse aims turrets, **F**/click fires. Try the scenario
buttons — ramp, side slope, bumps, zombies, drop test. **Reset vehicle**
respawns fresh; **← Back to editor** returns to your untouched blueprint.

When something fails, the chamber says why in plain text: *VEHICLE FLIPPED*,
*WHEELS SPINNING — no traction*, *WHEELS OFF THE GROUND*, *OUT OF FUEL*.
Every one of those is fixable in the editor — wider track, lower mass, more
driven wheels, better suspension.

## Weapons and armour (optional)

- **Hardpoint** on the deck → **Fixed Gun** or **Turret** on top of it →
  an **Ammo Box** somewhere on the frame (guns are useless without ammo;
  turrets also sip battery power, so add a **Battery**).
- **Armour panels** snap onto faces of parts — armour the nose and the fuel
  tank first (the analysis flags exposed tanks). **Shell panels** are
  lightweight cosmetics, not protection.
- Recoil is real: a big gun mounted high on a light rig will shove you around.

## Saving

Name the blueprint in the top-left box, hit **Save**. Load/duplicate from the
dropdown. Blueprints survive page reloads (browser storage).
