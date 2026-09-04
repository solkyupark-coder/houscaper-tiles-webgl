import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  buildTileOrbitIndex,
  indexTilesBySignature,
  resolveArchitecturalTile,
  signatureForCube,
} from "./architectural-tiles.js";
import { parseRhinoObj } from "./rhino-obj.js";

const LEVEL_HEIGHT = 0.6;

export async function mountHouscaper(mountElement) {
  const mountId = (window.__houscaperMountId = (window.__houscaperMountId || 0) + 1);
  
  // ════════════════════════════════════════════════════════════════
  //  BMC core (mirrors packages/bmc-core/src/topology.ts)
  // ════════════════════════════════════════════════════════════════
  const VC = [
    [0,0,0],[1,0,0],[1,1,0],[0,1,0],
    [0,0,1],[1,0,1],[1,1,1],[0,1,1],
  ];
  const EDGES = [
    [0,1],[1,2],[2,3],[3,0],
    [4,5],[5,6],[6,7],[7,4],
    [0,4],[1,5],[2,6],[3,7],
  ];
  const bitOf = v => 1 << (7 - v);
  const { tiles: TILES, lookup: LOOKUP } = await fetch("/assets/bmc-data.json").then((response) => response.json());
  
  const KIND_COLOR = {
    roof:  new THREE.Color("#c1554d"),
    wall:  new THREE.Color("#ede5d8"),
    floor: new THREE.Color("#8da0ae"),
    extra: new THREE.Color("#7d5fa0"),
    none:  new THREE.Color("#b8c8d0"),
  };
  
  // ════════════════════════════════════════════════════════════════
  //  Deterministic RNG + noise (no external deps)
  // ════════════════════════════════════════════════════════════════
  function mulberry32(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  
  function hash2(ix, iy) {
    const n = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }
  function smoothNoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx*fx*(3 - 2*fx), uy = fy*fy*(3 - 2*fy);
    return hash2(ix,iy)   *(1-ux)*(1-uy)
         + hash2(ix+1,iy) *   ux *(1-uy)
         + hash2(ix,iy+1) *(1-ux)*   uy
         + hash2(ix+1,iy+1)*  ux *   uy;
  }
  function fbm(x, y, oct = 6) {
    let v = 0, a = 0.5, f = 1, s = 0;
    for (let i = 0; i < oct; i++) {
      v += smoothNoise(x * f, y * f) * a;
      s += a; a *= 0.5; f *= 2;
    }
    return v / s;
  }
  
  // World terrain height at (worldX, worldZ)
  function terrainH(wx, wz) {
    const d = Math.sqrt(wx * wx + wz * wz);
    const flat = Math.max(0, 1 - d / 15); // flat building platform
    const gentle = (fbm(wx * 0.035 + 7,  wz * 0.035 + 13) - 0.45) * 10;
    const medium = (fbm(wx * 0.012 + 50, wz * 0.012 + 80) - 0.38) * 22;
    const peaks  = Math.max(0, fbm(wx * 0.007 + 200, wz * 0.007 + 300) - 0.42) * 55;
    const dist   = Math.min(1, Math.max(0, d / 25));
    const far    = Math.min(1, Math.max(0, (d - 35) / 60));
    const h = gentle * dist + medium * dist + peaks * far;
    return h * (1 - flat * 0.98); // keep center flat
  }
  
  const WATER_Y = -0.6;
  
  // ════════════════════════════════════════════════════════════════
  //  Three.js scene
  // ════════════════════════════════════════════════════════════════
  const viewport = () => ({
    width: mountElement.clientWidth || window.innerWidth,
    height: mountElement.clientHeight || window.innerHeight,
  });
  const initialViewport = viewport();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(initialViewport.width, initialViewport.height);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  mountElement.appendChild(renderer.domElement);
  
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#b8d8f0");
  scene.fog = new THREE.FogExp2("#c8e0f2", 0.0055);
  
  const camera = new THREE.PerspectiveCamera(50, initialViewport.width / initialViewport.height, 0.1, 600);
  camera.position.set(7, 5, 8);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(1.5, 0.9, 1.2);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxDistance = 70;
  controls.maxPolarAngle = Math.PI * 0.48;
  
  // Lighting
  scene.add(new THREE.AmbientLight("#a8c8e8", 0.55));
  const sun = new THREE.DirectionalLight("#ffe0a0", 2.2);
  sun.position.set(40, 80, 30);
  scene.add(sun);
  const sky = new THREE.DirectionalLight("#90b8e0", 0.5);
  sky.position.set(-30, 20, -50);
  scene.add(sky);
  
  // ════════════════════════════════════════════════════════════════
  //  Terrain mesh
  // ════════════════════════════════════════════════════════════════
  const T_SIZE = 240, T_SEGS = 150;
  const terrainGeo = new THREE.PlaneGeometry(T_SIZE, T_SIZE, T_SEGS, T_SEGS);
  terrainGeo.rotateX(-Math.PI / 2);
  
  const tPos = terrainGeo.attributes.position;
  const tCol = new Float32Array(tPos.count * 3);
  
  const cGrass  = new THREE.Color("#7da85e");
  const cGrass2 = new THREE.Color("#6a9050");
  const cDirt   = new THREE.Color("#9e8060");
  const cRock   = new THREE.Color("#7c7870");
  const cSand   = new THREE.Color("#c8b87a");
  const cSnow   = new THREE.Color("#dde6ee");
  const cGround = new THREE.Color("#a8987a"); // flat building platform
  
  for (let i = 0; i < tPos.count; i++) {
    const wx = tPos.getX(i), wz = tPos.getZ(i);
    const h = terrainH(wx, wz);
    tPos.setY(i, Math.max(h, WATER_Y - 0.05)); // don't dig below water bottom
  
    const d = Math.sqrt(wx * wx + wz * wz);
    let col;
    if (d < 15) {
      col = cGround.clone().lerp(cGrass, Math.max(0, (d - 10) / 5));
    } else if (h < WATER_Y + 0.4) {
      col = cSand;
    } else if (h < 2) {
      col = cGrass.clone().lerp(cGrass2, Math.random() * 0.3);
    } else if (h < 8) {
      col = cGrass2.clone().lerp(cDirt, (h - 2) / 6);
    } else if (h < 18) {
      col = cDirt.clone().lerp(cRock, (h - 8) / 10);
    } else {
      col = cRock.clone().lerp(cSnow, Math.min(1, (h - 18) / 15));
    }
    tCol[i * 3] = col.r; tCol[i * 3 + 1] = col.g; tCol[i * 3 + 2] = col.b;
  }
  terrainGeo.setAttribute("color", new THREE.BufferAttribute(tCol, 3));
  terrainGeo.computeVertexNormals();
  
  const terrainMesh = new THREE.Mesh(terrainGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
  scene.add(terrainMesh);
  
  // ════════════════════════════════════════════════════════════════
  //  Water
  // ════════════════════════════════════════════════════════════════
  const waterGeo = new THREE.PlaneGeometry(T_SIZE, T_SIZE, 1, 1);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshStandardMaterial({
    color: "#3878b8", transparent: true, opacity: 0.72,
    roughness: 0.05, metalness: 0.4, envMapIntensity: 1,
  });
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.position.y = WATER_Y;
  scene.add(waterMesh);
  
  // ════════════════════════════════════════════════════════════════
  //  Trees (instanced)
  // ════════════════════════════════════════════════════════════════
  const rng = mulberry32(1337);
  const dummy = new THREE.Object3D();
  
  const trunkGeo  = new THREE.CylinderGeometry(0.07, 0.14, 0.9, 5);
  const canopyGeo = new THREE.ConeGeometry(0.55, 1.6, 6);
  const trunkMat  = new THREE.MeshStandardMaterial({ color: "#6b4828", roughness: 0.95 });
  const leafMat1  = new THREE.MeshStandardMaterial({ color: "#3e6e32", roughness: 0.85, flatShading: true });
  const leafMat2  = new THREE.MeshStandardMaterial({ color: "#4a8040", roughness: 0.85, flatShading: true });
  
  const TREES = 700;
  const tTrunk  = new THREE.InstancedMesh(trunkGeo,  trunkMat, TREES);
  const tCanopy = new THREE.InstancedMesh(canopyGeo, leafMat1, TREES);
  const tTop    = new THREE.InstancedMesh(canopyGeo, leafMat2, TREES);
  
  let ti = 0;
  while (ti < TREES) {
    const wx = (rng() - 0.5) * T_SIZE * 0.85;
    const wz = (rng() - 0.5) * T_SIZE * 0.85;
    const d  = Math.sqrt(wx * wx + wz * wz);
    if (d < 15) continue;
    const h = terrainH(wx, wz);
    if (h < WATER_Y + 0.5 || h > 14) continue;
  
    const s = 0.6 + rng() * 1.1;
    const ry = rng() * Math.PI * 2;
  
    dummy.position.set(wx, h + 0.45 * s, wz);
    dummy.scale.set(s, s, s);
    dummy.rotation.set(0, ry, 0);
    dummy.updateMatrix();
    tTrunk.setMatrixAt(ti, dummy.matrix);
  
    dummy.position.set(wx, h + 1.15 * s, wz);
    dummy.scale.set(s, s * 0.95, s);
    dummy.rotation.set(0, ry, 0);
    dummy.updateMatrix();
    tCanopy.setMatrixAt(ti, dummy.matrix);
  
    dummy.position.set(wx, h + 1.85 * s, wz);
    dummy.scale.set(s * 0.62, s * 0.75, s * 0.62);
    dummy.rotation.set(0, ry + 0.4, 0);
    dummy.updateMatrix();
    tTop.setMatrixAt(ti, dummy.matrix);
  
    ti++;
  }
  tTrunk.count = tCanopy.count = tTop.count = ti;
  scene.add(tTrunk, tCanopy, tTop);
  
  // ════════════════════════════════════════════════════════════════
  //  Rocks (instanced)
  // ════════════════════════════════════════════════════════════════
  const ROCKS = 260;
  const rockGeo = new THREE.IcosahedronGeometry(0.42, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: "#888078", roughness: 0.97, flatShading: true });
  const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, ROCKS);
  let ri = 0;
  while (ri < ROCKS) {
    const wx = (rng() - 0.5) * T_SIZE * 0.85;
    const wz = (rng() - 0.5) * T_SIZE * 0.85;
    const d  = Math.sqrt(wx * wx + wz * wz);
    if (d < 13) continue;
    const h = terrainH(wx, wz);
    if (h < WATER_Y + 0.1) continue;
    const sx = 0.3 + rng() * 1.3, sy = 0.2 + rng() * 0.9, sz = 0.3 + rng() * 1.1;
    dummy.position.set(wx, h + sy * 0.28, wz);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(rng(), rng() * Math.PI * 2, rng());
    dummy.updateMatrix();
    rockInst.setMatrixAt(ri++, dummy.matrix);
  }
  rockInst.count = ri;
  scene.add(rockInst);
  
  // ════════════════════════════════════════════════════════════════
  //  Voxel store + BMC building
  // ════════════════════════════════════════════════════════════════
  const voxels = new Set();
  const voxelTypes = new Map();
  const key    = (x, y, z) => `${x},${y},${z}`;
  const has    = (x, y, z) => voxels.has(key(x, y, z));
  const BOUND = 22, HEIGHT = 14;
  const inBounds = (x, y, z) =>
    Math.abs(x) <= BOUND && Math.abs(y) <= BOUND && z >= 0 && z < HEIGHT;
  
  function cubeConfig(cx, cy, cz, extra = null) {
    let cfg = 0;
    for (let v = 0; v < 8; v++) {
      const px = cx + VC[v][0], py = cy + VC[v][1], pz = cz + VC[v][2];
      let occ = has(px, py, pz);
      if (extra && extra.x === px && extra.y === py && extra.z === pz) occ = extra.value;
      if (occ) cfg |= bitOf(v);
    }
    return cfg;
  }
  const cubesOf = (x, y, z) => VC.map(([dx, dy, dz]) => [x - dx, y - dy, z - dz]);
  
  function canToggle(x, y, z, value) {
    for (const [cx, cy, cz] of cubesOf(x, y, z)) {
      const cfg = cubeConfig(cx, cy, cz, { x, y, z, value });
      if (cfg !== 0 && cfg !== 255 && LOOKUP[cfg].kind === "invalid") return false;
    }
    return true;
  }
  
  // BMC (x,y,z-up) → three.js (x, z_world=y_bmc, y_world=z_bmc)
  const toWorld = (x, y, z) => new THREE.Vector3(x, z, y);
  
  let renderMode = "architectural";
  let brush = 1;
  let activeFamilyId = null;
  let familyCatalog = null;
  let architecturalIndex = new Map();
  let architecturalOrbitIndex = new Map();
  const architecturalAssets = new Map();
  const architecturalGroup = new THREE.Group();
  scene.add(architecturalGroup);
  
  const architecturalMaterials = {
    arc_frame: new THREE.MeshStandardMaterial({ color: "#75685f", roughness: 0.72, metalness: 0.08, side: THREE.DoubleSide }),
    floor: new THREE.MeshStandardMaterial({ color: "#62696d", roughness: 0.88, side: THREE.DoubleSide }),
    window_frame: new THREE.MeshStandardMaterial({ color: "#487ea3", roughness: 0.35, metalness: 0.16, side: THREE.DoubleSide }),
    blank: new THREE.MeshStandardMaterial({ color: "#a89a85", roughness: 0.8, side: THREE.DoubleSide }),
    support_wire: new THREE.MeshStandardMaterial({ color: "#aab3b8", roughness: 0.28, metalness: 0.7, side: THREE.DoubleSide }),
    default: new THREE.MeshStandardMaterial({ color: "#897d70", roughness: 0.8, side: THREE.DoubleSide }),
  };
  
  function disposeArchitecturalGeometries() {
    for (const roleGeometries of architecturalAssets.values()) {
      for (const [, geometry] of roleGeometries) geometry.dispose();
    }
  }

  async function loadArchitecturalTiles(familyId = null) {
    if (!familyCatalog) {
      const catalogResponse = await fetch("/assets/tilesets/catalog.json");
      if (!catalogResponse.ok) throw new Error(`tileset catalog: ${catalogResponse.status}`);
      familyCatalog = await catalogResponse.json();
      const familySelect = document.getElementById("tileFamily");
      familySelect.replaceChildren(...familyCatalog.families.map((family) => {
        const option = document.createElement("option");
        option.value = family.id;
        option.textContent = `${family.label} · ${family.tileCount}`;
        return option;
      }));
    }

    const selectedFamilyId = familyId ?? familyCatalog.defaultFamilyId;
    const family = familyCatalog.families.find(({ id }) => id === selectedFamilyId);
    if (!family) throw new Error(`unknown tile family: ${selectedFamilyId}`);
    const response = await fetch(family.manifest);
    if (!response.ok) throw new Error(`architectural manifest: ${response.status}`);
    const manifest = await response.json();
    const base = manifest.meshBase;

    architecturalGroup.clear();
    disposeArchitecturalGeometries();
    architecturalAssets.clear();
    architecturalIndex = indexTilesBySignature(manifest);
    architecturalOrbitIndex = buildTileOrbitIndex(manifest);
  
    await Promise.all(manifest.tiles.map(async (tile) => {
      const assetResponse = await fetch(base + tile.file);
      if (!assetResponse.ok) throw new Error(`${tile.file}: ${assetResponse.status}`);
      const rolePositions = parseRhinoObj(await assetResponse.text());
      const roleGeometries = [];
      for (const [role, positions] of rolePositions) {
        if (!positions.length) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        roleGeometries.push([role, geometry]);
      }
      architecturalAssets.set(tile.id, roleGeometries);
    }));

    activeFamilyId = selectedFamilyId;
    document.getElementById("tileFamily").value = selectedFamilyId;
    const supportedTypes = new Set(manifest.tiles.flatMap((tile) => [...tile.signature]));
    supportedTypes.delete("0");
    const defaultType = [1, 4, 2, 5].find((type) => supportedTypes.has(String(type))) ?? 1;
    for (const voxelKey of voxelTypes.keys()) {
      if (!supportedTypes.has(String(voxelTypes.get(voxelKey)))) {
        voxelTypes.set(voxelKey, defaultType);
      }
    }
    brush = defaultType;
    for (const button of document.querySelectorAll("#brushes button")) {
      const type = Number(button.dataset.brush);
      button.disabled = !supportedTypes.has(String(type));
      button.classList.toggle("active", type === brush);
    }
  }
  
  function typedSignature(cx, cy, cz, extra = null) {
    if (!extra) return signatureForCube(voxelTypes, cx, cy, cz);
    const previous = voxelTypes.get(key(extra.x, extra.y, extra.z));
    if (extra.value) voxelTypes.set(key(extra.x, extra.y, extra.z), extra.type);
    else voxelTypes.delete(key(extra.x, extra.y, extra.z));
    const signature = signatureForCube(voxelTypes, cx, cy, cz);
    if (previous === undefined) voxelTypes.delete(key(extra.x, extra.y, extra.z));
    else voxelTypes.set(key(extra.x, extra.y, extra.z), previous);
    return signature;
  }
  
  function canSetArchitectural(x, y, z, value, type) {
    if (!architecturalIndex.size) return false;
    for (const [cx, cy, cz] of cubesOf(x, y, z)) {
      const signature = typedSignature(cx, cy, cz, { x, y, z, value, type });
      if (signature === "00000000" || new Set(signature).size === 1) continue;
      if (!resolveArchitecturalTile(architecturalOrbitIndex, signature, cx, cy, cz)) return false;
    }
    return true;
  }
  
  function rebuildArchitectural(changeCenter = null) {
    architecturalGroup.clear();
    if (!architecturalIndex.size) return;
    const cubes = new Set();
    for (const voxelKey of voxels) {
      const [x, y, z] = voxelKey.split(",").map(Number);
      for (const [cx, cy, cz] of cubesOf(x, y, z)) cubes.add(key(cx, cy, cz));
    }
    for (const cubeKey of cubes) {
      const [cx, cy, cz] = cubeKey.split(",").map(Number);
      const signature = typedSignature(cx, cy, cz);
      if (signature === "00000000" || new Set(signature).size === 1) continue;
      const resolved = resolveArchitecturalTile(architecturalOrbitIndex, signature, cx, cy, cz);
      const tile = resolved?.tile;
      const roleGeometries = tile && architecturalAssets.get(tile.id);
      if (!roleGeometries) continue;
      const group = new THREE.Group();
      group.userData.tile = tile;
      group.userData.rotation = resolved.rotation;
      group.userData.mirrored = resolved.mirrored;
      group.position.set(cx, cz * LEVEL_HEIGHT, cy);
      if (changeCenter && group.position.distanceTo(changeCenter) < MOTION_RADIUS) {
        group.userData.motion = {
          elapsed: 0,
          duration: reducedMotion.matches ? 0.01 : 0.24,
          baseY: group.position.y,
        };
        group.scale.setScalar(reducedMotion.matches ? 1 : 0.72);
        group.position.y += reducedMotion.matches ? 0 : 0.18;
      }
      const pivot = new THREE.Group();
      pivot.position.set(0.5, 0, 0.5);
      pivot.rotation.y = resolved.rotation * Math.PI * 0.5;
      pivot.scale.x = resolved.mirrored ? -1 : 1;
      const content = new THREE.Group();
      content.position.set(-0.5, 0, -0.5);
      for (const [role, geometry] of roleGeometries) {
        content.add(new THREE.Mesh(geometry, architecturalMaterials[role] ?? architecturalMaterials.default));
      }
      pivot.add(content);
      group.add(pivot);
      architecturalGroup.add(group);
    }
  }
  
  function updateArchitecturalAnimations(dt) {
    for (const group of architecturalGroup.children) {
      const motion = group.userData.motion;
      if (!motion) continue;
      motion.elapsed += Math.min(dt, 0.05);
      const progress = Math.min(1, motion.elapsed / motion.duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      group.scale.setScalar(0.72 + eased * 0.28);
      group.position.y = motion.baseY + (1 - eased) * 0.18;
      if (progress === 1) delete group.userData.motion;
    }
  }
  
  // ════════════════════════════════════════════════════════════════
  //  Surface net mesh
  // ════════════════════════════════════════════════════════════════
  const surfMat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0.04,
  });
  let surfMesh = null;
  let surfaceAnimation = null;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const MOTION_RADIUS = 2.4;
  
  function tileMotion(progress, exiting = false, reduced = reducedMotion.matches) {
    const p = Math.max(0, Math.min(1, progress));
    if (reduced) return [1, 0, exiting ? 1 - p : 1];
    if (exiting) {
      const eased = p * p;
      return [1 - eased * 0.2, -eased * 0.08, 1 - p];
    }
    const eased = 1 - Math.pow(1 - p, 3);
    return [0.72 + eased * 0.28, (1 - eased) * 0.28, 1];
  }
  
  function extractLocalGeometry(source, center) {
    const srcPos = source?.getAttribute("position");
    const srcCol = source?.getAttribute("color");
    if (!srcPos || !srcCol) return null;
    const positions = [], colors = [];
    const r2 = MOTION_RADIUS * MOTION_RADIUS;
    for (let i = 0; i < srcPos.count; i += 3) {
      const cx = (srcPos.getX(i) + srcPos.getX(i+1) + srcPos.getX(i+2)) / 3;
      const cy = (srcPos.getY(i) + srcPos.getY(i+1) + srcPos.getY(i+2)) / 3;
      const cz = (srcPos.getZ(i) + srcPos.getZ(i+1) + srcPos.getZ(i+2)) / 3;
      if ((cx-center.x)**2 + (cy-center.y)**2 + (cz-center.z)**2 > r2) continue;
      for (let j = i; j < i + 3; j++) {
        positions.push(srcPos.getX(j), srcPos.getY(j), srcPos.getZ(j));
        colors.push(srcCol.getX(j), srcCol.getY(j), srcCol.getZ(j));
      }
    }
    if (!positions.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.translate(-center.x, -center.y, -center.z);
    geo.computeVertexNormals();
    return geo;
  }
  
  function finishSurfaceAnimation() {
    if (!surfaceAnimation) return;
    const { entry, ghost } = surfaceAnimation;
    entry.position.array.set(entry.base);
    entry.position.needsUpdate = true;
    if (ghost) {
      scene.remove(ghost);
      ghost.geometry.dispose();
      ghost.material.dispose();
    }
    surfaceAnimation = null;
  }
  
  function startSurfaceAnimation(oldGeometry, newGeometry, center) {
    const position = newGeometry.getAttribute("position");
    const base = Float32Array.from(position.array);
    const weights = new Float32Array(position.count);
    for (let i = 0; i < position.count; i++) {
      const dx = base[i*3] - center.x;
      const dy = base[i*3+1] - center.y;
      const dz = base[i*3+2] - center.z;
      const d = Math.sqrt(dx*dx + dy*dy + dz*dz) / MOTION_RADIUS;
      const w = Math.max(0, 1 - d);
      weights[i] = w * w * (3 - 2 * w);
    }
  
    const ghostGeometry = extractLocalGeometry(oldGeometry, center);
    let ghost = null;
    if (ghostGeometry) {
      const ghostMaterial = surfMat.clone();
      ghostMaterial.transparent = true;
      ghostMaterial.depthWrite = false;
      ghost = new THREE.Mesh(ghostGeometry, ghostMaterial);
      ghost.position.copy(center);
      ghost.renderOrder = 1;
      scene.add(ghost);
    }
    surfaceAnimation = {
      elapsed: 0,
      duration: reducedMotion.matches ? 0.14 : 0.28,
      entry: { position, base, weights, center },
      ghost,
    };
  }
  
  function updateSurfaceAnimation(dt) {
    if (!surfaceAnimation) return;
    const animation = surfaceAnimation;
    animation.elapsed += Math.min(dt, 0.05);
    const p = Math.min(1, animation.elapsed / animation.duration);
    const [scale, offset] = tileMotion(p);
    const { position, base, weights, center } = animation.entry;
    for (let i = 0; i < position.count; i++) {
      const w = weights[i];
      const s = 1 - (1 - scale) * w;
      position.setXYZ(
        i,
        center.x + (base[i*3] - center.x) * s,
        center.y + (base[i*3+1] - center.y) * s + offset * w,
        center.z + (base[i*3+2] - center.z) * s,
      );
    }
    position.needsUpdate = true;
  
    if (animation.ghost) {
      const [ghostScale, ghostOffset, opacity] = tileMotion(p, true);
      animation.ghost.scale.setScalar(ghostScale);
      animation.ghost.position.y = center.y + ghostOffset;
      animation.ghost.material.opacity = opacity;
    }
    if (p === 1) finishSurfaceAnimation();
  }
  
  function cubePoint(cx, cy, cz) {
    const cfg = cubeConfig(cx, cy, cz);
    let n = 0, sx = 0, sy = 0, sz = 0;
    for (const [a, b] of EDGES) {
      if (((cfg >> (7 - a)) & 1) !== ((cfg >> (7 - b)) & 1)) {
        sx += (VC[a][0] + VC[b][0]) * 0.5;
        sy += (VC[a][1] + VC[b][1]) * 0.5;
        sz += (VC[a][2] + VC[b][2]) * 0.5;
        n++;
      }
    }
    if (!n) return toWorld(cx + 0.5, cy + 0.5, cz + 0.5);
    return toWorld(cx + sx / n, cy + sy / n, cz + sz / n);
  }
  
  function cubeKind(cx, cy, cz) {
    const e = LOOKUP[cubeConfig(cx, cy, cz)];
    return e.kind === "tile" ? TILES[e.tile].kind : "none";
  }
  
  function rebuildSurface(changeCenter = null) {
    if (changeCenter) finishSurfaceAnimation();
    const oldGeometry = surfMesh?.geometry ?? null;
    const AXES = [[1,0,0],[0,1,0],[0,0,1]];
    const positions = [], colors = [];
    const seen = new Set();
  
    for (const k of voxels) {
      const [x, y, z] = k.split(",").map(Number);
      for (const [ax, ay, az] of AXES) {
        for (const dir of [1, -1]) {
          const nx = x+dir*ax, ny = y+dir*ay, nz = z+dir*az;
          if (has(nx, ny, nz)) continue;
          const lk = `${Math.min(x,nx)},${Math.min(y,ny)},${Math.min(z,nz)}|${ax}${ay}${az}`;
          if (seen.has(lk)) continue;
          seen.add(lk);
  
          const [b1, b2] = ax ? [[0,1,0],[0,0,1]] : ay ? [[1,0,0],[0,0,1]] : [[1,0,0],[0,1,0]];
          const bx = Math.min(x, nx), by = Math.min(y, ny), bz = Math.min(z, nz);
          const base = [ax?bx:x, ay?by:y, az?bz:z];
          const corners = [[0,0],[1,0],[1,1],[0,1]].map(([s,t]) => [
            base[0]-s*b1[0]-t*b2[0],
            base[1]-s*b1[1]-t*b2[1],
            base[2]-s*b1[2]-t*b2[2],
          ]);
          const pts  = corners.map(([cx,cy,cz]) => cubePoint(cx, cy, cz));
          const cols = corners.map(([cx,cy,cz]) => KIND_COLOR[cubeKind(cx,cy,cz)] ?? KIND_COLOR.none);
  
          const outward = toWorld(nx,ny,nz).sub(toWorld(x,y,z));
          const norm = new THREE.Vector3()
            .subVectors(pts[1], pts[0])
            .cross(new THREE.Vector3().subVectors(pts[2], pts[0]));
          const order = norm.dot(outward) >= 0 ? [0,1,2,0,2,3] : [0,2,1,0,3,2];
          for (const i of order) {
            positions.push(pts[i].x, pts[i].y, pts[i].z);
            colors.push(cols[i].r, cols[i].g, cols[i].b);
          }
        }
      }
    }
  
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color",    new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    if (surfMesh) surfMesh.geometry = geo;
    else {
      surfMesh = new THREE.Mesh(geo, surfMat);
      scene.add(surfMesh);
    }
    if (changeCenter) startSurfaceAnimation(oldGeometry, geo, changeCenter);
    oldGeometry?.dispose();
  }
  
  // ════════════════════════════════════════════════════════════════
  //  Voxel box helpers (picking + optional display)
  // ════════════════════════════════════════════════════════════════
  const voxelGroup = new THREE.Group();
  scene.add(voxelGroup);
  const boxGeo      = new THREE.BoxGeometry(1, 1, 1);
  const pickMat     = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const displayMat  = new THREE.MeshStandardMaterial({
    color: "#5090c8", transparent: true, opacity: 0.3, roughness: 0.9,
  });
  let showVoxels = false;
  
  function rebuildVoxelBoxes() {
    voxelGroup.clear();
    for (const k of voxels) {
      const [x, y, z] = k.split(",").map(Number);
      const m = new THREE.Mesh(boxGeo, showVoxels ? displayMat : pickMat);
      if (renderMode === "architectural") {
        m.scale.set(1, LEVEL_HEIGHT, 1);
        m.position.set(x + 0.5, (z + 0.5) * LEVEL_HEIGHT, y + 0.5);
      } else {
        m.position.copy(toWorld(x + 0.5, y + 0.5, z + 0.5));
      }
      m.userData.voxel = [x, y, z];
      voxelGroup.add(m);
    }
  }
  
  // ════════════════════════════════════════════════════════════════
  //  Stats
  // ════════════════════════════════════════════════════════════════
  function updateStats() {
    if (renderMode === "architectural") {
      const counts = { 1: 0, 2: 0, 4: 0, 5: 0 };
      for (const type of voxelTypes.values()) if (type in counts) counts[type]++;
      document.getElementById("stats").textContent =
      `${activeFamilyId ?? "loading"} · voxels ${voxels.size} · base ${counts[1]} / floor ${counts[2]} / opening ${counts[4]} / window ${counts[5]} · tiles ${architecturalGroup.children.length}`;
      return;
    }
    const cnt = { roof:0, wall:0, floor:0, extra:0 };
    const seen = new Set();
    for (const k of voxels) {
      const [x, y, z] = k.split(",").map(Number);
      for (const [cx, cy, cz] of cubesOf(x, y, z)) {
        const ck = key(cx, cy, cz);
        if (seen.has(ck)) continue;
        seen.add(ck);
        const kk = cubeKind(cx, cy, cz);
        if (kk in cnt) cnt[kk]++;
      }
    }
    document.getElementById("stats").textContent =
      `복셀 ${voxels.size} · roof ${cnt.roof} / wall ${cnt.wall} / floor ${cnt.floor} / extra ${cnt.extra}`;
  }
  
  function refresh(changeCenter = null) {
    if (surfMesh) surfMesh.visible = renderMode === "surface";
    architecturalGroup.visible = renderMode === "architectural";
    if (renderMode === "surface") rebuildSurface(changeCenter);
    else rebuildArchitectural(changeCenter);
    rebuildVoxelBoxes();
    updateStats();
  }
  
  // ════════════════════════════════════════════════════════════════
  //  Interaction
  // ════════════════════════════════════════════════════════════════
  const raycaster = new THREE.Raycaster();
  const pointer   = new THREE.Vector2();
  let downAt = null;
  
  const groundPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * BOUND, 2 * BOUND).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  scene.add(groundPlane);
  
  function flash(msg) {
    const el = document.getElementById("msg");
    el.textContent = msg; el.style.opacity = "1";
    clearTimeout(flash._t);
    flash._t = setTimeout(() => (el.style.opacity = "0"), 1400);
  }
  
  function setVoxel(x, y, z, value, type = brush) {
    if (!inBounds(x, y, z)) return flash("격자 범위를 벗어났어요");
    const voxelKey = key(x, y, z);
    const sameType = voxelTypes.get(voxelKey) === type;
    if (has(x, y, z) === value && (!value || renderMode === "surface" || sameType)) return;
    if (renderMode === "surface" && !canToggle(x, y, z, value))
      return flash("점/모서리 연결 금지 (surface-to-surface only)");
    if (renderMode === "architectural" && !canSetArchitectural(x, y, z, value, type))
      return flash("22.3dm에 이 typed cube-ID 타일이 없어요");
    if (value) {
      voxels.add(voxelKey);
      voxelTypes.set(voxelKey, renderMode === "architectural" ? type : 1);
    } else {
      voxels.delete(voxelKey);
      voxelTypes.delete(voxelKey);
    }
    const center = renderMode === "surface"
      ? toWorld(x + 0.5, y + 0.5, z + 0.5)
      : new THREE.Vector3(x + 0.5, (z + 0.5) * LEVEL_HEIGHT, y + 0.5);
    refresh(center);
  }
  
  const listeners = new AbortController();
  const { signal } = listeners;

  renderer.domElement.addEventListener("contextmenu", e => e.preventDefault(), { signal });
  renderer.domElement.addEventListener("pointerdown", e => { downAt = [e.clientX, e.clientY, e.button]; }, { signal });
  renderer.domElement.addEventListener("pointerup",   e => {
    if (!downAt) return;
    const [sx, sy, btn] = downAt; downAt = null;
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 5) return;
  
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((e.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((e.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
  
    const hit = raycaster.intersectObjects(voxelGroup.children)[0];
    if (hit) {
      const [x, y, z] = hit.object.userData.voxel;
      if (btn === 2) return setVoxel(x, y, z, false);
      if (renderMode === "architectural" && (brush === 4 || brush === 5))
        return setVoxel(x, y, z, true, brush);
      const n = hit.face.normal;
      return setVoxel(x + Math.round(n.x), y + Math.round(n.z), z + Math.round(n.y), true);
    }
    if (btn === 0) {
      const gh = raycaster.intersectObject(groundPlane)[0];
      if (gh) setVoxel(Math.floor(gh.point.x), Math.floor(gh.point.z), 0, true);
    }
  }, { signal });
  
  document.getElementById("showVoxels").addEventListener("change", e => {
    showVoxels = e.target.checked; rebuildVoxelBoxes();
  }, { signal });
  document.getElementById("renderMode").addEventListener("change", async (event) => {
    renderMode = event.target.value;
    document.getElementById("brushes").hidden = renderMode !== "architectural";
    if (renderMode === "architectural" && !architecturalIndex.size) {
      flash("22.3dm cube-ID 타일 불러오는 중…");
      try {
        await loadArchitecturalTiles();
      } catch (error) {
        console.error(error);
        renderMode = "surface";
        event.target.value = "surface";
        flash("22.3dm 타일 로드 실패");
      }
    }
    refresh();
  }, { signal });
  document.getElementById("brushes").addEventListener("click", (event) => {
    const button = event.target.closest("[data-brush]");
    if (!button) return;
    brush = Number(button.dataset.brush);
    for (const item of document.querySelectorAll("#brushes button"))
      item.classList.toggle("active", item === button);
  }, { signal });
  document.getElementById("tileFamily").addEventListener("change", async (event) => {
    flash("geometry family 전환 중…");
    try {
      await loadArchitecturalTiles(event.target.value);
      refresh();
    } catch (error) {
      console.error(error);
      event.target.value = activeFamilyId;
      flash("geometry family 로드 실패");
    }
  }, { signal });
  const handleResize = () => {
    const { width, height } = viewport();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };
  window.addEventListener("resize", handleResize, { signal });
  
  // ════════════════════════════════════════════════════════════════
  //  Water animation
  // ════════════════════════════════════════════════════════════════
  let t = 0;
  function animateWater(dt) {
    t += dt;
    waterMat.color.setHSL(0.6, 0.55, 0.38 + Math.sin(t * 0.6) * 0.02);
    waterMat.opacity = 0.68 + Math.sin(t * 0.9) * 0.04;
  }
  
  // ════════════════════════════════════════════════════════════════
  //  Expose for testing
  // ════════════════════════════════════════════════════════════════
  window.getHouscaperState = () => {
    const typedCounts = {};
    for (const type of voxelTypes.values()) typedCounts[type] = (typedCounts[type] ?? 0) + 1;
    return {
      renderMode,
      activeFamilyId,
      voxels: voxels.size,
      typedVoxels: voxelTypes.size,
      typedCounts,
      architecturalAssets: architecturalAssets.size,
      architecturalSignatures: architecturalIndex.size,
      renderedArchitecturalTiles: architecturalGroup.children.length,
    };
  };
  
  // ════════════════════════════════════════════════════════════════
  //  Starter house
  // ════════════════════════════════════════════════════════════════
  for (let x = 0; x <= 3; x++)
    for (let y = 0; y <= 2; y++)
      for (let z = 0; z <= 1; z++) {
        voxels.add(key(x, y, z));
        voxelTypes.set(key(x, y, z), 1);
      }
  for (let x = 0; x <= 3; x++) {
    voxels.add(key(x, 1, 2));
    voxelTypes.set(key(x, 1, 2), 1);
  }
  try {
    await loadArchitecturalTiles();
  } catch (error) {
    console.error(error);
    renderMode = "surface";
    document.getElementById("renderMode").value = "surface";
    document.getElementById("brushes").hidden = true;
    flash("22.3dm 타일 로드 실패 — BMC surface로 전환");
  }
  refresh();
  
  // ════════════════════════════════════════════════════════════════
  //  Render loop
  // ════════════════════════════════════════════════════════════════
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    controls.update();
    animateWater(dt);
    updateSurfaceAnimation(dt);
    updateArchitecturalAnimations(dt);
    renderer.render(scene, camera);
  });

  return () => {
    renderer.setAnimationLoop(null);
    listeners.abort();
    clearTimeout(flash._t);
    controls.dispose();
    scene.traverse((object) => {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : object.material
          ? [object.material]
          : [];
      for (const material of materials) material.dispose();
    });
    disposeArchitecturalGeometries();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    if (window.__houscaperMountId === mountId) {
      delete window.getHouscaperState;
    }
  };
}
