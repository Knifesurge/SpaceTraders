import { WaypointType, WaypointTraitSymbol } from "spacetraders-sdk";

const WAYPOINT_TYPE_MAP = Object.keys(WaypointType).reduce((acc, key) => {
  acc[key.toLowerCase()] = WaypointType[key]; // Normalize keys to lowercase
  return acc;
}, {});

const getWaypointType = (input) => {
  if (!input) return undefined;
  return WAYPOINT_TYPE_MAP[input.toLowerCase()];
};

const getWaypointTrait = (input) => {
  const entry = Object.entries(WaypointTraitSymbol).find(
    ([key, value]) => value === input
  );
  return entry ? entry[0] : undefined;
};

export { getWaypointType, getWaypointTrait };
