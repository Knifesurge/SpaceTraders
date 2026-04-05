const SHIP_CACHE_TTL_MS = 10 * 1000;
const SHIP_PAGE_SIZE = 20;

let myShipsCache = {
  cachedAt: 0,
  ships: null,
};

export const invalidateMyShipsCache = () => {
  myShipsCache = {
    cachedAt: 0,
    ships: null,
  };
};

const fetchAllMyShips = async (fleetApi) => {
  let page = 1;
  const allShips = [];

  while (true) {
    const response = await fleetApi.getMyShips(page, SHIP_PAGE_SIZE);
    const ships = response.data?.data || [];
    allShips.push(...ships);

    if (ships.length < SHIP_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return allShips;
};

export const getAllMyShipsCached = async (fleetApi, options = {}) => {
  const { forceRefresh = false } = options;
  const now = Date.now();

  if (!forceRefresh && myShipsCache.ships && now - myShipsCache.cachedAt < SHIP_CACHE_TTL_MS) {
    return myShipsCache.ships;
  }

  const ships = await fetchAllMyShips(fleetApi);
  myShipsCache = {
    cachedAt: now,
    ships,
  };

  return ships;
};
