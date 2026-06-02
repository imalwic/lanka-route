/**
 * Sri Lanka Trip Route Optimizer - Calculation & Routing Utilities
 */

/**
 * Calculates straight-line distance between two coordinates using the Haversine formula.
 */
export function getHaversineDistance(c1, c2) {
  const R = 6371; // Earth's radius in km
  const dLat = ((c2.lat - c1.lat) * Math.PI) / 180;
  const dLng = ((c2.lng - c1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((c1.lat * Math.PI) / 180) *
      Math.cos((c2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

/**
 * Generates an offline fallback distance/duration matrix based on straight-line distances.
 * Sri Lankan roads are mountainous and winding, so we assume an average speed of 40 km/h.
 */
export function getFallbackMatrices(coords) {
  const n = coords.length;
  const distances = Array(n)
    .fill(0)
    .map(() => Array(n).fill(0));
  const durations = Array(n)
    .fill(0)
    .map(() => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dist = getHaversineDistance(coords[i], coords[j]);
      distances[i][j] = dist * 1000; // meters
      // 40 km/h = 11.11 m/s. Travel time = distance (m) / 11.11
      durations[i][j] = (dist / 40) * 3600; // seconds
    }
  }
  return { distances, durations, isFallback: true };
}

/**
 * Fetches the real driving distance & duration matrix between coordinates using OSRM Table API.
 */
export async function getOSRMMatrices(coords) {
  if (coords.length < 2) return null;
  
  try {
    // OSRM expects longitude,latitude coordinates separated by semicolons
    const coordString = coords.map((c) => `${c.lng},${c.lat}`).join(';');
    const url = `https://router.project-osrm.org/table/v1/driving/${coordString}?annotations=duration,distance`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`OSRM Table API status: ${response.status}`);
    }
    
    const data = await response.json();
    if (data.code !== 'Ok' || !data.durations || !data.distances) {
      throw new Error('OSRM returned invalid table data');
    }
    
    return {
      durations: data.durations, // 2D array in seconds
      distances: data.distances, // 2D array in meters
      isFallback: false
    };
  } catch (error) {
    console.warn('Failed to fetch from OSRM Table API, using high-fidelity Haversine fallback:', error);
    return getFallbackMatrices(coords);
  }
}

/**
 * TSP Solver that respects position-locked items.
 * 
 * - Locked items MUST remain at their current indices.
 * - Unlocked items are shuffled into the empty slots to minimize total cost.
 * 
 * @param {Array} locations - Original array of location items { id, lat, lng, isLocked }
 * @param {Object} matrix - The cost matrix (e.g. durations or distances matrix)
 * @param {boolean} isRoundTrip - Whether the route must return to the start point
 * @returns {Array} - The optimized array of locations
 */
export function optimizeRouteWithLocks(locations, matrix, isRoundTrip) {
  const N = locations.length;
  if (N <= 2) return [...locations]; // No optimization needed for 0, 1, or 2 items

  // Create slot board
  const slots = Array(N).fill(null);
  const unlockedItems = [];

  locations.forEach((loc, index) => {
    if (loc.isLocked) {
      slots[index] = loc;
    } else {
      unlockedItems.push(loc);
    }
  });

  // Find indexes of free slots
  const freeSlotIndices = [];
  slots.forEach((slot, index) => {
    if (slot === null) {
      freeSlotIndices.push(index);
    }
  });

  // If no unlocked items or no free slots, return original list
  if (unlockedItems.length === 0 || freeSlotIndices.length === 0) {
    return [...locations];
  }

  // Cost calculator based on matrix indices
  const calculateRouteCost = (route) => {
    let cost = 0;
    for (let i = 0; i < N - 1; i++) {
      const fromIdx = locations.findIndex((l) => l.id === route[i].id);
      const toIdx = locations.findIndex((l) => l.id === route[i + 1].id);
      cost += matrix[fromIdx][toIdx];
    }
    if (isRoundTrip) {
      const fromIdx = locations.findIndex((l) => l.id === route[N - 1].id);
      const toIdx = locations.findIndex((l) => l.id === route[0].id);
      cost += matrix[fromIdx][toIdx];
    }
    return cost;
  };

  let bestRoute = null;
  let minCost = Infinity;

  // Brute-force solver for small unlocked lists (<= 8 items) - 100% exact math
  if (unlockedItems.length <= 8) {
    const permutations = getAllPermutations(unlockedItems);
    
    for (const perm of permutations) {
      const currentRoute = [...slots];
      freeSlotIndices.forEach((slotIdx, i) => {
        currentRoute[slotIdx] = perm[i];
      });

      const cost = calculateRouteCost(currentRoute);
      if (cost < minCost) {
        minCost = cost;
        bestRoute = currentRoute;
      }
    }
  } else {
    // Heuristic: Randomized Hill Climbing with 2-Opt for large unlocked lists (> 8 items)
    // Create initial valid permutation
    const currentRoute = [...slots];
    const tempUnlocked = [...unlockedItems];
    freeSlotIndices.forEach((slotIdx) => {
      currentRoute[slotIdx] = tempUnlocked.shift();
    });

    bestRoute = [...currentRoute];
    minCost = calculateRouteCost(bestRoute);

    // Apply 2-opt swaps on free slots
    let improved = true;
    let iterations = 0;
    const maxIterations = 1000;

    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;

      for (let i = 0; i < freeSlotIndices.length - 1; i++) {
        for (let j = i + 1; j < freeSlotIndices.length; j++) {
          const idxA = freeSlotIndices[i];
          const idxB = freeSlotIndices[j];

          // Swap slots
          const testRoute = [...bestRoute];
          const temp = testRoute[idxA];
          testRoute[idxA] = testRoute[idxB];
          testRoute[idxB] = temp;

          const cost = calculateRouteCost(testRoute);
          if (cost < minCost) {
            minCost = cost;
            bestRoute = testRoute;
            improved = true;
          }
        }
      }
    }
  }

  return bestRoute || [...locations];
}

/**
 * Helper to generate all permutations of an array.
 */
function getAllPermutations(arr) {
  const results = [];
  
  function permute(tempArr, remaining) {
    if (remaining.length === 0) {
      results.push(tempArr);
      return;
    }
    for (let i = 0; i < remaining.length; i++) {
      permute(
        [...tempArr, remaining[i]],
        remaining.filter((_, idx) => idx !== i)
      );
    }
  }
  
  permute([], arr);
  return results;
}

/**
 * Fetches the actual road-driving path geometry coordinates from OSRM Routing API
 * to draw a high-fidelity line connecting all locations sequentially on the map.
 */
export async function getOSRMRouteGeometry(locations, isRoundTrip, allowsExpressway = true) {
  if (locations.length < 2) return [];

  try {
    let routeCoords = [...locations];
    if (isRoundTrip) {
      routeCoords.push(locations[0]);
    }

    // Inject expressway bypasses for vehicles that are banned from expressways (three-wheels, bikes)
    if (!allowsExpressway) {
      routeCoords = injectExpresswayBypasses(routeCoords);
    }

    const coordString = routeCoords.map((c) => `${c.lng},${c.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson&alternatives=true`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`OSRM Route API status: ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error('OSRM returned empty or invalid route path');
    }

    // Map all available routes (OSRM returns alternative paths in routes array)
    const routes = data.routes.map((route, idx) => {
      const path = route.geometry.coordinates.map((coord) => [coord[1], coord[0]]);
      
      // Generate a friendly name based on leg summaries if available
      const routeSummary = route.legs 
        ? route.legs.map(l => l.summary).filter(Boolean).join(' → ')
        : '';
      const cleanSummary = routeSummary || (idx === 0 ? 'Primary Path' : `Alternative route ${idx}`);

      return {
        path,
        distanceKm: route.distance / 1000,
        durationHrs: route.duration / 3600,
        summary: cleanSummary,
        isFallback: false
      };
    });

    return routes;
  } catch (error) {
    console.warn('Failed to fetch OSRM Route geometry, falling back to direct line routes:', error);
    
    // Offline Fallback: Draw direct geodesic lines between nodes
    const path = [];
    let totalDist = 0;
    
    for (let i = 0; i < locations.length - 1; i++) {
      path.push([locations[i].lat, locations[i].lng]);
      totalDist += getHaversineDistance(locations[i], locations[i+1]);
    }
    path.push([locations[locations.length - 1].lat, locations[locations.length - 1].lng]);
    
    if (isRoundTrip) {
      path.push([locations[0].lat, locations[0].lng]);
      totalDist += getHaversineDistance(locations[locations.length - 1], locations[0]);
    }
    
    return [{
      path,
      distanceKm: totalDist,
      durationHrs: totalDist / 40, // 40 km/h average
      summary: 'Direct Offline Fallback Route',
      isFallback: true
    }];
  }
}

/**
 * Injects intermediate A-class road waypoints to bypass Sri Lankan Expressways (E-class)
 * for restricted vehicles (Three-Wheelers, Motorbikes).
 */
export function injectExpresswayBypasses(waypoints) {
  const result = [];
  for (let i = 0; i < waypoints.length; i++) {
    result.push(waypoints[i]);
    if (i === waypoints.length - 1) break;

    const w1 = waypoints[i];
    const w2 = waypoints[i + 1];

    // 1. Colombo/Gampaha <-> Galle/Matara/Hambantota (Southern Expressway E01 Bypass)
    const isW1ColGamp = w1.lat >= 6.7 && w1.lat <= 7.3 && w1.lng >= 79.8 && w1.lng <= 80.25;
    const isW2South = w2.lat >= 5.8 && w2.lat <= 6.3 && w2.lng >= 80.05 && w2.lng <= 81.3;
    const isW1South = w1.lat >= 5.8 && w1.lat <= 6.3 && w1.lng >= 80.05 && w1.lng <= 81.3;
    const isW2ColGamp = w2.lat >= 6.7 && w2.lat <= 7.3 && w2.lng >= 79.8 && w2.lng <= 80.25;

    if ((isW1ColGamp && isW2South) || (isW1South && isW2ColGamp)) {
      result.push({
        id: `bypass-e01-${Date.now()}-${Math.random()}`,
        name: 'Ambalangoda (A2 Coast Road Bypass)',
        lat: 6.2443,
        lng: 80.0516,
        isBypass: true
      });
      continue;
    }

    // 2. Colombo <-> Negombo (Katunayake Expressway E03 Bypass)
    const isW1Col = w1.lat >= 6.8 && w1.lat <= 7.0 && w1.lng >= 79.8 && w1.lng <= 79.95;
    const isW2Neg = w2.lat >= 7.15 && w2.lat <= 7.3 && w2.lng >= 79.8 && w2.lng <= 79.95;
    const isW1Neg = w1.lat >= 7.15 && w1.lat <= 7.3 && w1.lng >= 79.8 && w1.lng <= 79.95;
    const isW2Col = w2.lat >= 6.8 && w2.lat <= 7.0 && w2.lng >= 79.8 && w2.lng <= 79.95;

    if ((isW1Col && isW2Neg) || (isW1Neg && isW2Col)) {
      result.push({
        id: `bypass-e03-${Date.now()}-${Math.random()}`,
        name: 'Ja-Ela (A3 Negombo Road Bypass)',
        lat: 7.0744,
        lng: 79.8893,
        isBypass: true
      });
      continue;
    }

    // 3. Colombo <-> Kurunegala (Central Expressway E04 Bypass)
    const isW2Kuru = w2.lat >= 7.45 && w2.lat <= 7.6 && w2.lng >= 80.3 && w2.lng <= 80.5;
    const isW1Kuru = w1.lat >= 7.45 && w1.lat <= 7.6 && w1.lng >= 80.3 && w1.lng <= 80.5;

    if ((isW1ColGamp && isW2Kuru) || (isW1Kuru && isW2ColGamp)) {
      result.push({
        id: `bypass-e04-${Date.now()}-${Math.random()}`,
        name: 'Warakapola (A1 Road Bypass)',
        lat: 7.2241,
        lng: 80.1982,
        isBypass: true
      });
      continue;
    }
  }
  return result;
}
