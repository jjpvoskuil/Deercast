// Made-up data for trying the screen before Supabase is connected (not John's real stands).
const g = { id: "demo", name: "Demo Ground", owner: "demo", members: ["demo"], home: { lat: 37.2906, lon: -86.0408, label: "Demo" } };
const P = (dLat, dLon) => [g.home.lat + dLat, g.home.lon + dLon];

export const DEMO_EMAIL = "demo@example.com";
/** Seed for the browser-only demo database (lib/db.js demoDb). */
export function demoSeed() {
  const d = demoData.forGround("demo");
  const me = DEMO_EMAIL;
  return {
    users: [{ email: me, name: "Demo Hunter", role: "admin" }, { email: "partner@example.com", name: "Hunting Partner", role: "member" }],
    grounds: [{ ...g, owner: me, members: [me, "partner@example.com"], created: "2026-10-27T12:00:00" },
      // a ground the admin isn't on (admins still see it)
      { id: "demo2", name: "Partner's Farm", owner: "partner@example.com", members: [], home: g.home, created: "2026-11-12T12:00:00" }],
    stands: { demo: d.stands }, features: { demo: d.features },
    hunts: d.hunts.map((h) => ({ ...h, owner: me, ground_id: "demo", start: "2026-10-27T15:30:00-05:00", end: "2026-10-27T18:10:00-05:00",
      notes: "", harvest: false, hours: [{ hour: "2026-10-27T16:00:00-05:00", score: 5.5, minutes: 60, seen: 0 },
        { hour: "2026-10-27T17:00:00-05:00", score: 7.2, minutes: 60, seen: 3 }, { hour: "2026-10-27T18:00:00-05:00", score: 6.1, minutes: 10, seen: 1 }] })).concat([{ id: "hp1", owner: "partner@example.com", ground_id: "demo", date: "2026-11-01", stand: "Stand: Creek Blind",
      start: "2026-11-01T06:20:00-05:00", end: "2026-11-01T09:00:00-05:00", notes: "Partner's sit", harvest: false, hours: [],
      sightings: [{ kind: "Doe", count: 2, activity: "", bait: "", group: "gp1", time: "2026-11-01T07:10:00-05:00" }] }]),
    shots: [], docs: {},
    // a partner sitting right now (Who's hunting)
    liveOthers: [{ id: "lp1", owner: "partner@example.com", ground_id: "demo", where: "Stand: Creek Blind", start: new Date(Date.now() - 95 * 60e3).toISOString(),
      notes: "Wind's good", weapon_id: null, sightings: [{ kind: "Doe", count: 2, activity: "Feeding", bait: "", group: "lg1", time: new Date(Date.now() - 40 * 60e3).toISOString() }], photos: [] }],
    punch: [{ id: "p1", title: "Example punch-list item", category: "Feature", priority: "Medium", status: "Open", details: "", created: "2026-11-01 10:00", updated: "2026-11-01 10:00" }],
  };
}

export const demoData = {
  grounds: [g],
  forGround: () => ({
    stands: [
      { id: "s1", name: "Ridge Stand", lat: P(0.0012, -0.0015)[0], lon: P(0.0012, -0.0015)[1], type: "Ladder", good_winds: ["N", "NE"], notes: "" },
      { id: "s2", name: "Creek Blind", lat: P(-0.0016, 0.0019)[0], lon: P(-0.0016, 0.0019)[1], type: "Ground blind", good_winds: ["SW", "W"], notes: "" },
    ],
    features: [
      { id: "f1", type: "feeder", name: "Feeder", lat: P(0.0006, -0.0004)[0], lon: P(0.0006, -0.0004)[1], last_filled: "2026-10-25" },
      { id: "f2", type: "water", name: "Pond", lat: P(-0.0022, -0.0012)[0], lon: P(-0.0022, -0.0012)[1], radius_yd: 40 },
      { id: "f3", type: "bedding", name: "Thicket", lat: P(0.0025, 0.0022)[0], lon: P(0.0025, 0.0022)[1], radius_yd: 60 },
    ],
    hunts: [{ id: "h1", owner: "demo", date: "2026-10-27", stand: "Stand: Ridge Stand", sightings: [
      { time: "2026-10-27T17:40:00-05:00", kind: "Doe", count: 2, group: "a", lat: P(0.0007, 0.0004)[0], lon: P(0.0007, 0.0004)[1], came_from: "N", went_to: "SE", activity: "Feeding" },
      { time: "2026-10-27T17:40:00-05:00", kind: "Fawn", count: 1, group: "a", lat: P(0.0007, 0.0004)[0], lon: P(0.0007, 0.0004)[1], came_from: "N", went_to: "SE" },
      { time: "2026-10-27T18:05:00-05:00", kind: "Buck", count: 1, lat: P(0.0002, -0.0011)[0], lon: P(0.0002, -0.0011)[1], came_from: "W" },
    ] }],
  }),
};
