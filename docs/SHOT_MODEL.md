# Shot & Recovery model (v0.3)

**Purpose:** a field aid for deciding how long to wait and where to look after a hit. Every output is an estimate
from typical cases, so the hunter's physical sign (blood, hair, arrow) should take priority over it.

## Anatomy (`deercast/shot.py`)
- A simplified adult whitetail (~150 lb) built from axis-aligned ellipsoids, measured in inches.
  - Body frame: x = forward, y = deer's left, z = up, origin at the center of the torso.
  - **Exterior parts:** torso, neck base, neck, head, upper front legs, hams, and lower legs.
  - **Internal parts:** brain, spine, neck spine, windpipe/carotid/jugular, aorta, heart, left and right lungs,
    liver (sits more on the right side), kidneys, rumen (left side), intestines, femoral arteries,
    and shoulder blade/upper leg bone on each side.
- **Shooter geometry:**
  - **yaw:** −90 facing toward, 0 broadside, +90 facing away.
  - **pitch:** downward angle = atan(stand height ÷ horizontal distance), or set manually.
  - **side:** which side of the deer faced the shooter. A right-side shot mirrors the y axis.
- **The view:** the deer is drawn as the exact screen projection of each ellipsoid, as the shooter would see it.
- **The arrow path:** a tap on the screen becomes a ray cast along the view direction.
  - Entry and exit points come from the first continuous run of body parts the ray passes through.
  - An organ counts as hit if the ray passes through more than 0.15 in of it.
- **Bone:** with a bow or crossbow, organs that lie past the shoulder bone are shown as conditional.
  The app then gives two outcomes: one if the arrow passed through, one if it stopped at the bone.

## Outcomes (`OUTCOMES`, `PRIORITY`)
- The primary outcome is the most lethal category the arrow path crosses, in this order:
  brain, spine, heart, aorta, double lung, femoral artery, neck vessels, kidneys, liver, single lung,
  gut (paunch), shoulder only, muscle, miss.
- Each category carries an expected survival time, a recommended wait, a travel distance (min / typical / 90th percentile),
  the blood sign to expect, and tracking tips. These follow standard hunter-education and bowhunter-education guidance.
  Example: double lung is 30-minute wait with ~80 yd typical travel. Liver is a 4–6 hour wait with ~200 yd
  typical travel. A gut shot is an 8–12+ hour wait with ~250 yd typical travel.
- **Evidence overrides geometry.** The hunter can enter what they found on the arrow or at the impact site
  (frothy blood, dark blood, gut matter, and so on) and choose to plan the recovery from that sign instead.

## Arrow outcome & bow setup (v0.5)
- **Arrow** input (bow and crossbow only). The options are: pass-through and recovered, pass-through but not found,
  stayed in the deer / partial penetration, or not sure.
  - **Stayed in the deer:** the "stopped at bone" answer is selected by default when the path hits bone.
    Expect less blood, since there's no exit hole. Waits of 2 hours or more for lethal hits are increased by half.
  - **Pass-through:** the "broke through the bone" answer is selected by default.
- **Bow Setup page** (`deercast/archery.py`, stored in `gear.json`):
  - **Speed:** estimated from the IBO/ATA rating using standard adjustments for draw length, arrow weight per pound
    of draw weight, string accessories, and draw weight under 70 lb. For a crossbow, it's estimated from the rated
    speed and bolt weight at constant energy. A chronograph reading overrides the estimate.
  - **Kinetic energy** = gr·fps²/450,800. **Momentum** = gr·fps/225,218.
  - **Bone penetration rating:** momentum × a tip factor (fixed blade 1.0, hybrid 0.85, mechanical 0.72).
    0.52 or more is High, 0.40 or more is Moderate, anything lower is Low.
  - A Low rating makes "stopped at bone" the default answer on shoulder hits.

## Recovery map (`deercast/recovery.py`)
- **Hit site:** the stand location, moved by the shot distance along the bearing from the stand to the deer.
- **Search grid:** a polar grid of 8 distance rings × 12 direction sectors.
  - If the run direction is known, the grid covers ±100° around it. Otherwise it covers the full 360°.
- **Cell weight** is the product of three terms:
  - **Distance:** a log-normal distribution with the median at the typical distance and the 90th percentile at the
    maximum. If the hunter saw the deer travel, the distances are raised to at least what was seen.
  - **Direction:** a von Mises distribution centered on the run direction (κ = 2.2, roughly ±40°).
  - **Downhill:** exp(bias × clamp(drop_m / 8, −3, 3)), using elevations from Open-Meteo.
    The bias is applied only for slow-death hits (liver, gut, single lung, muscle and similar),
    since those deer usually bed down downhill or in cover.
- **Water & cover** (v0.3.1): wounded deer head for water and heavy cover to bed.
  - Streams, ponds, lakes (including multipolygon lakes like Nolin), wetlands, woods and scrub are pulled from
    OpenStreetMap via the Overpass API (free, cached 7 days) within about 1.2 × the maximum distance.
  - The hunter can also mark **water / thick cover / bedding** circles on the Map page (`features.json` in the private repo).
  - Multiplier per cell: (1 + water_bias·e^(−d_water/90 m)) × (1 + cover_bias·e^(−d_cover/40 m)), with an extra
    (1 + 1.5·cover_bias·e^(−d_bed/40 m)) for marked bedding areas. d_cover is 0 inside a woods polygon.
  - The biases depend on the outcome (`WATER_BIAS`, `COVER_BIAS`). They are strongest for liver, gut and single-lung hits
    (water ~1.2–1.5, cover ~1.2–1.5) and weak for quick kills (~0.3–0.5), since those deer die before they get far.
- The three highest-weight cells are numbered on the map as the first places to search.
- **Weather:** the forecast at the hit site is checked for rain during the wait plus 4 hours (it can wash out the trail),
  and for temperatures of 50°F or more during waits of 4 hours or longer (meat spoilage).

## Known limits / next steps
- OSM cover mapping in rural Kentucky is coarse (large woodlots only; it misses cedar thickets and CRP), so the hunter's own marks are the most reliable input. Trails, fences and pressure are not modeled.
- Organ sizes are fixed. A future option could scale them by deer size (doe, yearling, mature buck).
- Saved shots go to `shots.json` in the private data repo. Recording the recovery outcome later
  would let these estimates be calibrated against real results.
