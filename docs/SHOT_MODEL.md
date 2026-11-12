# Shot & Recovery model (v0.3.2)

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
  stayed in the deer / partial penetration, found after it pulled out of the deer (not a pass-through), or not sure.
  - **Stayed in the deer** or **pulled out (not a pass-through)**: the "stopped at bone" answer is selected by default when the path hits bone.
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
    `parse_osm` / `parseOsm` joins a multipolygon's member ways end-to-end into closed rings (`assemble_rings`), since
    OSM splits big lakes and forests into many ways that run in either direction.
  - The hunter can also mark **water / thick cover / bedding** circles on the Map page (`features.json` in the private repo).
  - Multiplier per cell: (1 + water_bias·e^(−d_water/90 m)) × (1 + cover_bias·e^(−d_cover/40 m)), with an extra
    (1 + 1.5·cover_bias·e^(−d_bed/40 m)) for marked bedding areas. d_cover is 0 inside a woods polygon.
  - The biases depend on the outcome (`WATER_BIAS`, `COVER_BIAS`). They are strongest for liver, gut and single-lung hits
    (water ~1.2–1.5, cover ~1.2–1.5) and weak for quick kills (~0.3–0.5), since those deer die before they get far.
- **Open water** (v0.3.2, John 11-11: "a deer can't die in the middle of the lake"):
  - *Open water* = lakes, ponds, reservoirs and river areas: OSM `natural=water`, `waterway=riverbank`,
    `landuse=reservoir`, except seasonal/intermittent ponds. Each is a set of closed rings read even-odd, so the outer
    shoreline minus its inner rings — **islands are land**.
  - Streams and creeks stay *lines*: they only attract (the water pull above). Wetlands stay passable cover.
    Hunter **water marks** stay attractors too: they are circles, never no-go areas.
  - A cell whose center is in open water gets **zero**.
  - **No swimming:** a cell is unreachable when the straight line from the hit site to its center crosses more than
    `SWIM_MAX_M` = 50 m of open water (computed exactly from the ring crossings, `water_mask`). A small farm pond can be
    run around, so less than that doesn't block.
  - **Shore pile-up** (`apply_water`): a zeroed cell's probability moves to the last dry, reachable cell on the same
    bearing, nearer the hit. A deer running toward the lake goes down along the shore, not on the far bank. A sector with
    no dry cell before the water loses its share, and everything is re-normalized.
  - The "head for water" pull still measures to the nearest water line. That includes every lake and island
    shoreline, so for a cell on shore it is the distance to the shoreline.
  - **Bundled Nolin shoreline** (`web/public/data/nolin_water.json`, built by `tools/make_nolin_water.py`): this is the
    514-ft contour (1 ft under summer pool) from the KyFromAbove lidar used in the Fishin Magician depth build. It
    makes a 5,070-acre outer ring with 6 islands. It is used whenever the hit is within 5 km of the lake's bounding box,
    merged (as a union) with whatever Overpass returns, so the lake still works when Overpass fails. Arms upstream of
    lat 37.388 (Nolin River) and lon −86.098 (east) are cut off in that file, so only OSM covers them.
  - **Map:** no shading over open water. A cell that straddles the shore is drawn as strips of its 5×5 sub-cells whose
    centers are on land (`dryPieces`). If at least 15% of the probability was over or across water, one line says:
    "Spots over the lake were removed — the deer most likely went down along the shore." It says "pond" / "bank" for
    water under ~20 acres. If the hit site itself plots in the water, the map asks the hunter to check the shot
    distance and direction.
- The three highest-weight cells are numbered on the map as the first places to search.
- **Weather:** the forecast at the hit site is checked for rain during the wait plus 4 hours (it can wash out the trail),
  and for temperatures of 50°F or more during waits of 4 hours or longer (meat spoilage).

## Known limits / next steps
- **Lake level:** the open-water outlines are at summer pool (OSM and the bundled 514-ft line). In fall and winter,
  Nolin is drawn down (the winter lidar flights found it at ~496–499 ft), so exposed flats and banks still count as water. A level-aware
  shoreline (the live USGS level × the lidar contours, as Fishin Magician does) is a possible next step.
- OSM cover mapping in rural Kentucky is coarse (large woodlots only; it misses cedar thickets and CRP), so the hunter's own marks are the most reliable input. Trails, fences and pressure are not modeled.
- Organ sizes are fixed. A future option could scale them by deer size (doe, yearling, mature buck).
- Saved shots go to `shots.json` in the private data repo. Recording the recovery outcome later
  would let these estimates be calibrated against real results.
