/* Display units.
 *
 * The simulation is SI throughout -- metres, m/s, seconds -- because the physics
 * constants, the IDM literature and every threshold in test_sim.py are expressed that
 * way, and converting inside the model would mean carrying unit bugs into the dynamics.
 * Conversion happens here, at the edge, purely for what the reader sees.
 */
'use strict';

const U = {
  MPH_PER_MS: 2.2369362920544,
  FT_PER_M: 3.280839895,
  M_PER_MILE: 1609.344,

  mph: v => v * U.MPH_PER_MS,            // m/s   -> mph
  ft: m => m * U.FT_PER_M,               // m     -> feet
  perMile: d => d * U.M_PER_MILE,        // veh/m -> veh/mile
  miles: m => m / U.M_PER_MILE,          // m     -> miles
  mToFt: ft => ft / U.FT_PER_M,          // feet  -> m   (for controls that send SI)

  /** "1,312 ft" / "0.25 mi" -- feet up close, miles once that stops being readable. */
  distance(m) {
    const ft = U.ft(m);
    return ft >= 2000 ? `${U.miles(m).toFixed(2)} mi` : `${Math.round(ft)} ft`;
  },
};
