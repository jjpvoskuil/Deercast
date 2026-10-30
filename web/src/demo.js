// Made-up data for trying the screen before Supabase is connected (not John's real stands).
const g = { id: "demo", name: "Demo Ground", owner: "demo", members: ["demo"], home: { lat: 37.2906, lon: -86.0408, label: "Demo" } };
const P = (dLat, dLon) => [g.home.lat + dLat, g.home.lon + dLon];

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
