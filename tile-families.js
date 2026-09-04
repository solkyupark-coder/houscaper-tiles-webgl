const ATLAS_FAMILY_DISTANCE_MM = 8000;
// ponytail: 8000mm correctly separates atlas "neighborhoods" but still merges
// distinct design studies that sit ~9??5m apart inside one neighborhood
// (e.g. frame-structural left X~126k vs right X~143k). 4000mm is the ceiling
// that keeps one study together. Upgrade path: tag studies in the Rhino export.
const COHERENT_SUBCLUSTER_MM = 4000;

// ponytail: labels are matched to spatial clusters purely by order, and clusters
// whose cages carry no mesh (currently one 60-cage cluster) are dropped silently
// below. Upgrade path: key metadata off a cage id recorded in the Rhino export
// and surface mesh-less clusters instead of filtering them away.
const FAMILY_METADATA = [
  { id: "surface-floor", label: "Surface floor" },
  { id: "unmeshed-study", label: "Unmeshed study" },
  { id: "frame-light", label: "Frame light" },
  { id: "frame-structural", label: "Frame structural" },
  { id: "blank-openings", label: "Blank openings" },
];

// Default playable family is further restricted to one coherent Rhino study
// (largest 4000mm sub-cluster, one tile per atlas origin).
const DEFAULT_FAMILY_ID = "frame-light";

function distance(a, b) {
  return Math.hypot(
    a.origin[0] - b.origin[0],
    a.origin[1] - b.origin[1],
    a.origin[2] - b.origin[2],
  );
}

export function clusterAtlasFamilies(
  cages,
  maxDistance = ATLAS_FAMILY_DISTANCE_MM,
) {
  const unseen = new Set(cages.map((_, index) => index));
  const clusters = [];

  while (unseen.size) {
    const queue = [unseen.values().next().value];
    const indices = [];
    unseen.delete(queue[0]);

    while (queue.length) {
      const index = queue.pop();
      indices.push(index);
      for (const candidate of [...unseen]) {
        if (distance(cages[index], cages[candidate]) <= maxDistance) {
          unseen.delete(candidate);
          queue.push(candidate);
        }
      }
    }

    const familyCages = indices
      .map((index) => cages[index])
      .sort((a, b) => a.sourceCage - b.sourceCage);
    clusters.push({
      cages: familyCages,
      minSourceCage: familyCages[0].sourceCage,
    });
  }

  return clusters.sort((a, b) => a.minSourceCage - b.minSourceCage);
}

function restrictToCoherentStudy(tiles, cageBySource) {
  const studyCages = [
    ...new Map(
      tiles
        .map((tile) => cageBySource.get(tile.sourceCage))
        .filter(Boolean)
        .map((cage) => [cage.sourceCage, cage]),
    ).values(),
  ];
  if (studyCages.length <= 1) return tiles;

  const subclusters = clusterAtlasFamilies(studyCages, COHERENT_SUBCLUSTER_MM);
  const keepCages = new Set(
    subclusters.sort((a, b) => b.cages.length - a.cages.length)[0].cages.map(
      (cage) => cage.sourceCage,
    ),
  );
  const inStudy = tiles.filter((tile) => keepCages.has(tile.sourceCage));

  // Same atlas origin = alternate design pass, not hashable variants.
  const byOrigin = new Map();
  for (const tile of inStudy) {
    const cage = cageBySource.get(tile.sourceCage);
    const key = cage.origin.join(",");
    const prev = byOrigin.get(key);
    if (
      !prev ||
      tile.variant < prev.variant ||
      (tile.variant === prev.variant && tile.sourceCage < prev.sourceCage)
    ) {
      byOrigin.set(key, tile);
    }
  }
  return [...byOrigin.values()].sort((a, b) => a.sourceCage - b.sourceCage);
}

export function buildFamilyCatalog(manifest, cageData) {
  const clusters = clusterAtlasFamilies(cageData.cages);
  const familyByCage = new Map();
  const cageBySource = new Map(
    cageData.cages.map((cage) => [cage.sourceCage, cage]),
  );

  clusters.forEach((cluster, index) => {
    const metadata = FAMILY_METADATA[index];
    for (const cage of cluster.cages) familyByCage.set(cage.sourceCage, metadata);
  });

  const families = FAMILY_METADATA.map((metadata) => {
    let tiles = manifest.tiles.filter(
      (tile) => familyByCage.get(tile.sourceCage)?.id === metadata.id,
    );
    if (metadata.id === DEFAULT_FAMILY_ID) {
      tiles = restrictToCoherentStudy(tiles, cageBySource);
    }
    return { ...metadata, tiles };
  }).filter((family) => family.tiles.length);

  return {
    source: cageData.source,
    defaultFamilyId: DEFAULT_FAMILY_ID,
    families,
  };
}
