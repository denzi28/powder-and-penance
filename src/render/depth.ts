// Draw order. Actors and overhanging wall caps are Y-sorted by their feet / bottom edge.
export const DEPTH = {
  floor: 0,
  shadow: 500,
  actor: (feetY: number) => 1000 + feetY,
  overlay: 1_000_000,
};
