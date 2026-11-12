import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

// Your deployed function (see api/contributions.js). If it is missing or fails,
// the page falls back to a public community API, then to the sample tree.
const API_URL = '/api/contributions';
const FALLBACK_API = 'https://github-contributions-api.jogruber.de/v4/';

const MAX_LEAVES = 8000;   // one leaf per contribution, capped for performance
/*
  Each tree type is only a set of numbers fed into the same generator.
  angle: how far branches tilt from their parent. up: pushes branches upward (+) or outward (-).
  flatten: squashes the leaf cloud vertically (acacia = flat umbrella). droop: weeping branches.
*/
const SPECIES = {
  acacia:   { label: 'Acacia',          trunk: '#6b5238', leaf: '#8aa83c', trunkH: 1.15, trunkR: 0.85, kids: [2, 3], angle: 0.95, up: -0.08, droop: 0,    lenDecay: 0.80, radDecay: 0.60, leafSize: 0.19, flatten: 0.35, leafSpread: 0.60, leader: true, blossoms: false },
  narra:    { label: 'Narra',           trunk: '#74503a', leaf: '#5d9a3c', trunkH: 1.00, trunkR: 1.15, kids: [3, 3], angle: 0.85, up:  0.05, droop: 0,    lenDecay: 0.78, radDecay: 0.62, leafSize: 0.19, flatten: 0.70, leafSpread: 0.60, leader: true, blossoms: false },
  darkoak:  { label: 'Dark oak',        trunk: '#3b2b1e', leaf: '#2c5a35', trunkH: 0.80, trunkR: 1.50, kids: [3, 4], angle: 0.80, up:  0.00, droop: 0,    lenDecay: 0.74, radDecay: 0.64, leafSize: 0.19, flatten: 0.80, leafSpread: 0.55, leader: true, blossoms: false },
  mahogany: { label: 'Mahogany',        trunk: '#6a3b2b', leaf: '#3d7a3f', trunkH: 1.20, trunkR: 1.00, kids: [2, 3], angle: 0.60, up:  0.14, droop: 0,    lenDecay: 0.76, radDecay: 0.60, leafSize: 0.19, flatten: 1.10, leafSpread: 0.50, leader: true, blossoms: false },
  cherry:   { label: 'Cherry blossom',  trunk: '#4a3434', leaf: '#f08fb3', trunkH: 0.90, trunkR: 0.95, kids: [3, 3], angle: 0.85, up:  0.02, droop: 0,    lenDecay: 0.76, radDecay: 0.62, leafSize: 0.19, flatten: 0.75, leafSpread: 0.60, leader: true, blossoms: true  },
  sakura:   { label: 'Sakura',          trunk: '#5a4040', leaf: '#ffc4da', trunkH: 1.00, trunkR: 0.85, kids: [2, 3], angle: 0.75, up:  0.05, droop: 0.12, lenDecay: 0.80, radDecay: 0.60, leafSize: 0.19, flatten: 0.90, leafSpread: 0.55, leader: true, blossoms: true  }
};

const SWATCHES = ['#7bbf4a', '#2f6b3a', '#f4a6c0', '#ffd36b', '#e8743b', '#c9a0ff', '#6ad0c8', '#ffffff'];
const SEASONS = {
  spring: { label: 'Spring', icon: '', ground: '#b8cc9c', sky: ['#d6ecdf', '#f6efd9'], darkGround: '#283a2d', darkSky: ['#21352b', '#121b15'], sun: '#fff2d6' },
  summer: { label: 'Summer', icon: '', ground: '#9ab879', sky: ['#b9dce6', '#f5e8c8'], darkGround: '#26372a', darkSky: ['#183128', '#102019'], sun: '#ffe6a3' },
  fall:   { label: 'Fall',   icon: '', ground: '#b89a67', sky: ['#d8e6e5', '#f6d8b5'], darkGround: '#3a3025', darkSky: ['#38291f', '#1d1714'], sun: '#ffc58f' },
  winter: { label: 'Winter',icon: '', ground: '#dce4e4', sky: ['#dce8f0', '#f5f7f5'], darkGround: '#303a43', darkSky: ['#24303b', '#111920'], sun: '#f4f8ff' }
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const params = new URLSearchParams(location.search);
const EMBED = params.get('embed') === '1';
if (EMBED) document.documentElement.classList.add('embed');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const urlType = params.get('type');
const urlColor = params.get('color');
const urlCount = parseInt(params.get('n'), 10);
const urlSeason = params.get('season');
const urlTreeStyle = params.get('tree');
const urlLeafShape = params.get('leaf');

const state = {
  user: '',
  species: SPECIES[urlType] ? urlType : 'narra',
  season: SEASONS[urlSeason] ? urlSeason : 'spring',
  treeStyle: urlTreeStyle === 'pixel' ? 'pixel' : 'natural',
  leafShape: ['circle', 'pixel'].includes(urlLeafShape) ? urlLeafShape : 'leaf',
  customLeaf: /^[0-9a-f]{6}$/i.test(urlColor || '') ? '#' + urlColor.toLowerCase() : null,
  range: params.get('range') === 'year' ? 'year' : 'all',
  count: Number.isFinite(urlCount) ? clamp(urlCount, 0, 100000) : 419,
  falling: !reduceMotion && params.get('falling') !== '0',
  calendarDays: [],
  calendarOpen: false,
  embedCalendarOpen: false,
  rotate: params.get('rotate') === '0' ? false : !reduceMotion
};

const leafHex = () => state.customLeaf || SPECIES[state.species].leaf;
const app = $('#app');
const sidebarToggle = $('#sidebarToggle');
const settingsPanel = $('#settingsPanel');
const layout = $('.layout');
let sidebarResizeTimer;

function finishSidebarResize() {
  clearTimeout(sidebarResizeTimer);
  if (!sidebarTransitioning) return;
  sidebarTransitioning = false;
  requestAnimationFrame(() => {
    resize();
    requestAnimationFrame(() => app.classList.remove('sidebar-resizing'));
  });
}

let sidebarTransitioning = false;
layout.addEventListener('transitionend', (event) => {
  if (event.target === layout && event.propertyName === 'grid-template-columns') finishSidebarResize();
});
settingsPanel.addEventListener('transitionend', (event) => {
  if (event.target === settingsPanel && ['flex-basis', 'flex-grow'].includes(event.propertyName)) finishSidebarResize();
});

sidebarToggle.addEventListener('click', () => {
  sidebarTransitioning = !reduceMotion;
  app.classList.toggle('sidebar-resizing', sidebarTransitioning);
  clearTimeout(sidebarResizeTimer);
  if (sidebarTransitioning) sidebarResizeTimer = setTimeout(finishSidebarResize, 400);
  const collapsed = app.classList.toggle('sidebar-collapsed');
  const label = collapsed ? 'Show controls' : 'Hide controls';
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggle.setAttribute('aria-label', label);
  sidebarToggle.title = label;
  if (!collapsed) settingsPanel.scrollTop = 0;
  if (!sidebarTransitioning) requestAnimationFrame(resize);
});

/* ------------------------------------------------------------------ */
/* Three.js scene                                                      */
/* ------------------------------------------------------------------ */

const stage = $('#stage');
const canvas = $('#c');
const xpFlow = $('#xpFlow');
const xpOrbs = [...xpFlow.children];
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
camera.position.set(4, 3, 7);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.autoRotate = state.rotate;
controls.autoRotateSpeed = 1.2;

const hemi = new THREE.HemisphereLight(0xffffff, 0x8a9a7a, 1.1);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(7, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -10; sun.shadow.camera.right = 10;
sun.shadow.camera.top = 10;   sun.shadow.camera.bottom = -10;
sun.shadow.camera.near = 1;   sun.shadow.camera.far = 40;
sun.shadow.bias = -0.0005;
scene.add(hemi, sun);

const groundMat = new THREE.MeshStandardMaterial({ color: '#b8cc9c', roughness: 1 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(7, 72), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grassMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide });
const grassGeo = (() => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.055, 0);
  shape.bezierCurveTo(-0.07, 0.12, 0.04, 0.3, 0.035, 0.46);
  shape.quadraticCurveTo(0.11, 0.28, 0.065, 0);
  shape.closePath();
  const blade = new THREE.ShapeGeometry(shape, 5);
  const crossed = blade.clone();
  crossed.rotateY(Math.PI / 2);
  const geometry = mergeGeometries([blade, crossed], false);
  blade.dispose();
  crossed.dispose();
  return geometry;
})();
const GRASS_COUNT = 190;
const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_COUNT);
grassMesh.frustumCulled = false;
grassMesh.castShadow = false;
grassMesh.receiveShadow = false;
const grassBlades = [];
const grassBladeScales = new Float32Array(GRASS_COUNT);
const grassRng = mulberry32(0x51a55);
const grassDummy = new THREE.Object3D();
const grassColor = new THREE.Color();
const grassPalette = ['#88a963', '#9ab973', '#aac67e', '#779653'];
for (let i = 0; i < GRASS_COUNT; i++) {
  const angle = grassRng() * Math.PI * 2;
  const radius = 2.5 + grassRng() * 4.1;
  const blade = {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
    yaw: grassRng() * Math.PI * 2,
    height: 0.32 + grassRng() * 0.28,
    width: 0.75 + grassRng() * 0.55,
    phase: grassRng() * Math.PI * 2
  };
  grassBlades.push(blade);
  grassDummy.position.set(blade.x, 0.015, blade.z);
  grassDummy.rotation.set(0, blade.yaw, 0);
  grassDummy.scale.set(blade.width, blade.height, blade.width);
  grassDummy.updateMatrix();
  grassMesh.setMatrixAt(i, grassDummy.matrix);
  grassColor.set(grassPalette[Math.floor(grassRng() * grassPalette.length)]);
  grassMesh.setColorAt(i, grassColor);
}
grassMesh.count = 0;
scene.add(grassMesh);

const growthProgress = { value: 1 };
function addGrowthShader(material, tag, attributes, body) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrowth = growthProgress;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${attributes}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${body}`);
  };
  material.customProgramCacheKey = () => tag;
  return material;
}

const GROWTH_ATTRIBUTES = 'attribute vec3 aStart; attribute vec2 aTime; uniform float uGrowth;';
const GROWTH_BODY = `
  float segmentGrowth = smoothstep(aTime.x, aTime.y, uGrowth);
  transformed = aStart + (transformed - aStart) * segmentGrowth;`;
const barkMat = addGrowthShader(
  new THREE.MeshStandardMaterial({ color: '#6b5238', roughness: 1, flatShading: true }),
  'growing-bark',
  GROWTH_ATTRIBUTES,
  GROWTH_BODY
);
const barkDepthMat = addGrowthShader(
  new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
  'growing-bark-depth',
  GROWTH_ATTRIBUTES,
  GROWTH_BODY
);
const leafMat = addGrowthShader(
  new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, side: THREE.DoubleSide }),
  'sprouting-leaves',
  'attribute float aBirth; uniform float uGrowth;',
  `float sprout = clamp((uGrowth - aBirth) / 0.025, 0.0, 1.0);
   transformed *= sprout * sprout * (3.0 - 2.0 * sprout);`
);

const leafTex = (() => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(86, 112, 62, 0.48)';
  g.lineWidth = 2;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(32, 121);
  g.quadraticCurveTo(26, 63, 32, 7);
  g.stroke();
  for (let y = 31; y <= 101; y += 14) {
    const side = (y % 2) ? -1 : 1;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(32, y);
    g.quadraticCurveTo(32 + side * 13, y - 10, 32 + side * 20, y - 17);
    g.moveTo(32, y + 3);
    g.quadraticCurveTo(32 - side * 13, y + 11, 32 - side * 19, y + 18);
    g.stroke();
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
})();
const leafGeo = (() => {
  const shape = new THREE.Shape();
  shape.moveTo(0.12, -0.9);
  shape.bezierCurveTo(0.48, -0.66, 0.67, -0.26, 0.62, 0.12);
  shape.bezierCurveTo(0.57, 0.51, 0.23, 0.83, 0.06, 0.92);
  shape.bezierCurveTo(0.02, 0.95, -0.02, 0.95, -0.06, 0.92);
  shape.bezierCurveTo(-0.25, 0.82, -0.62, 0.49, -0.63, 0.1);
  shape.bezierCurveTo(-0.65, -0.29, -0.43, -0.69, -0.12, -0.9);
  shape.bezierCurveTo(-0.06, -0.95, 0.06, -0.95, 0.12, -0.9);
  const geometry = new THREE.ShapeGeometry(shape, 12);
  const positions = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) {
    uv.setXY(i, positions.getX(i) + 0.5, (positions.getY(i) + 1) / 2);
  }
  uv.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
})();

leafMat.map = leafTex;
leafMat.needsUpdate = true;
const circleLeafMat = addGrowthShader(
  new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, side: THREE.DoubleSide }),
  'sprouting-circle-leaves',
  'attribute float aBirth; uniform float uGrowth;',
  `float sprout = clamp((uGrowth - aBirth) / 0.025, 0.0, 1.0);
   transformed *= sprout * sprout * (3.0 - 2.0 * sprout);`
);
const pixelLeafMat = addGrowthShader(
  new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }),
  'sprouting-pixel-leaves',
  'attribute float aBirth; uniform float uGrowth;',
  `float sprout = clamp((uGrowth - aBirth) / 0.025, 0.0, 1.0);
   transformed *= sprout * sprout * (3.0 - 2.0 * sprout);`
);
const fallingLeafMat = new THREE.MeshStandardMaterial({
  color: '#ffffff',
  roughness: 0.75,
  side: THREE.DoubleSide,
  map: leafTex
});
const circleFallingLeafMat = new THREE.MeshStandardMaterial({
  color: '#ffffff',
  roughness: 0.75,
  side: THREE.DoubleSide
});
const pixelFallingLeafMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
const leafGeometries = {
  leaf: leafGeo,
  circle: new THREE.SphereGeometry(0.48, 16, 12),
  pixel: new THREE.BoxGeometry(0.72, 0.72, 0.72)
};
const leafMaterials = { leaf: leafMat, circle: circleLeafMat, pixel: pixelLeafMat };
const fallingLeafMaterials = { leaf: fallingLeafMat, circle: circleFallingLeafMat, pixel: pixelFallingLeafMat };

function makeLeafGeometry(shape) {
  return leafGeometries[shape].clone();
}

const groundLeaves = new THREE.InstancedMesh(
  leafGeo,
  new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide }),
  220
);
groundLeaves.frustumCulled = false;
groundLeaves.count = 0;
scene.add(groundLeaves);

const flowerPetals = new THREE.InstancedMesh(
  new THREE.CircleGeometry(0.035, 8),
  new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide }),
  220
);
flowerPetals.frustumCulled = false;
flowerPetals.count = 0;
scene.add(flowerPetals);
const flowerCenters = new THREE.InstancedMesh(
  new THREE.SphereGeometry(0.018, 8, 6),
  new THREE.MeshStandardMaterial({ color: '#f5c84b', roughness: 1 }),
  44
);
flowerCenters.frustumCulled = false;
flowerCenters.count = 0;
scene.add(flowerCenters);
const flowerStems = new THREE.InstancedMesh(
  new THREE.CylinderGeometry(0.008, 0.012, 1, 6),
  new THREE.MeshStandardMaterial({ color: '#648c45', roughness: 1 }),
  44
);
flowerStems.frustumCulled = false;
flowerStems.count = 0;
scene.add(flowerStems);
const decorDummy = new THREE.Object3D();

const seasonalGroundColors = Array.from({ length: GRASS_COUNT }, () => new THREE.Color());
const seasonalGroundScales = new Float32Array(GRASS_COUNT);
const seasonalGroundColor = new THREE.Color();
let seasonalGroundTransition = null;
let themeApplied = false;

function updateSeasonalGround(seasonKey, groundColor, animate) {
  const groundDecorRng = mulberry32(0x5ea50a);
  const palettes = {
    spring: { grass: ['#78a85d', '#8dbb69', '#a8c978'], grassCount: 175 },
    summer: { grass: ['#568d45', '#70a64f', '#91b65a'], grassCount: 190 },
    fall: { grass: ['#b2a34f', '#c48b3a', '#d2ad54'], grassCount: 105 },
    winter: { grass: ['#b9c5bd', '#d1d8d1', '#a8b7b1'], grassCount: 18 }
  };
  const palette = palettes[seasonKey];
  const fallColors = ['#d87532', '#c64b2d', '#e3ad3d', '#a9482c'];
  const scale = seasonKey === 'winter' ? 0.42 : seasonKey === 'fall' ? 0.8 : 1;
  const sourceColors = [];
  const sourceScales = Float32Array.from(grassBladeScales);
  for (let i = 0; i < grassBlades.length; i++) {
    grassMesh.getColorAt(i, seasonalGroundColor);
    sourceColors.push(seasonalGroundColor.clone());
    grassColor.set(palette.grass[Math.floor(groundDecorRng() * palette.grass.length)]);
    seasonalGroundColors[i].copy(grassColor);
    seasonalGroundScales[i] = i < palette.grassCount ? scale : 0;
    if (!animate) {
      grassBladeScales[i] = seasonalGroundScales[i];
      grassMesh.setColorAt(i, seasonalGroundColors[i]);
    }
  }
  const targetGroundColor = new THREE.Color(groundColor);
  if (animate) {
    seasonalGroundTransition = {
      start: performance.now(),
      sourceGroundColor: groundMat.color.clone(),
      targetGroundColor,
      sourceColors,
      sourceScales,
      duration: 750
    };
  } else {
    groundMat.color.copy(targetGroundColor);
    seasonalGroundTransition = null;
  }
  grassMesh.count = GRASS_COUNT;
  if (!animate) {
    updateSeasonalGroundTransition(1);
  }

  groundLeaves.count = seasonKey === 'fall' ? 220 : 0;
  for (let i = 0; i < groundLeaves.count; i++) {
    const angle = groundDecorRng() * Math.PI * 2;
    const radius = 1.8 + groundDecorRng() * 4.8;
    decorDummy.position.set(Math.cos(angle) * radius, 0.035 + groundDecorRng() * 0.01, Math.sin(angle) * radius);
    decorDummy.rotation.set(-Math.PI / 2 + (groundDecorRng() - 0.5) * 0.18, groundDecorRng() * Math.PI * 2, (groundDecorRng() - 0.5) * 0.25);
    decorDummy.scale.setScalar(0.1 + groundDecorRng() * 0.09);
    decorDummy.updateMatrix();
    groundLeaves.setMatrixAt(i, decorDummy.matrix);
    grassColor.set(fallColors[Math.floor(groundDecorRng() * fallColors.length)]);
    groundLeaves.setColorAt(i, grassColor);
  }
  groundLeaves.instanceMatrix.needsUpdate = true;
  if (groundLeaves.instanceColor) groundLeaves.instanceColor.needsUpdate = true;

  const flowerCount = seasonKey === 'spring' ? 36 : 0;
  flowerPetals.count = flowerCount * 5;
  flowerCenters.count = flowerCount;
  flowerStems.count = 0;
  const flowerColors = ['#f28a9b', '#ffd166', '#b795d4', '#fff4da'];
  for (let i = 0; i < flowerCount; i++) {
    const angle = groundDecorRng() * Math.PI * 2;
    const radius = 2 + groundDecorRng() * 4.3;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const tall = i % 3 === 0;
    const bloomHeight = tall ? 0.28 + groundDecorRng() * 0.26 : 0.065;
    const petalColor = new THREE.Color(flowerColors[i % flowerColors.length]);
    if (tall) {
      decorDummy.position.set(x, bloomHeight / 2, z);
      decorDummy.scale.set(1, bloomHeight, 1);
      decorDummy.updateMatrix();
      flowerStems.setMatrixAt(flowerStems.count, decorDummy.matrix);
      flowerStems.count++;
    }
    for (let petal = 0; petal < 5; petal++) {
      const petalAngle = (petal / 5) * Math.PI * 2;
      decorDummy.position.set(x + Math.cos(petalAngle) * 0.035, bloomHeight, z + Math.sin(petalAngle) * 0.035);
      decorDummy.rotation.set(-Math.PI / 2, 0, 0);
      decorDummy.scale.setScalar(tall ? 1.25 : 1);
      decorDummy.updateMatrix();
      const index = i * 5 + petal;
      flowerPetals.setMatrixAt(index, decorDummy.matrix);
      flowerPetals.setColorAt(index, petalColor);
    }
    decorDummy.position.set(x, bloomHeight + 0.01, z);
    decorDummy.scale.setScalar(1);
    decorDummy.updateMatrix();
    flowerCenters.setMatrixAt(i, decorDummy.matrix);
  }
  flowerPetals.instanceMatrix.needsUpdate = true;
  if (flowerPetals.instanceColor) flowerPetals.instanceColor.needsUpdate = true;
  flowerCenters.instanceMatrix.needsUpdate = true;
  flowerStems.instanceMatrix.needsUpdate = true;
}

function updateSeasonalGroundTransition(progress) {
  const transition = seasonalGroundTransition;
  const eased = progress * progress * (3 - 2 * progress);
  if (transition) groundMat.color.lerpColors(transition.sourceGroundColor, transition.targetGroundColor, eased);
  for (let i = 0; i < grassBlades.length; i++) {
    if (transition) {
      grassColor.lerpColors(transition.sourceColors[i], seasonalGroundColors[i], eased);
      grassMesh.setColorAt(i, grassColor);
      grassBladeScales[i] = lerp(transition.sourceScales[i], seasonalGroundScales[i], eased);
    }
    const blade = grassBlades[i];
    decorDummy.position.set(blade.x, 0.015, blade.z);
    decorDummy.rotation.set(0, blade.yaw, 0);
    decorDummy.scale.set(blade.width * grassBladeScales[i], blade.height * grassBladeScales[i], blade.width * grassBladeScales[i]);
    decorDummy.updateMatrix();
    grassMesh.setMatrixAt(i, decorDummy.matrix);
  }
  grassMesh.instanceMatrix.needsUpdate = true;
  if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
}

function applyTheme() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const season = SEASONS[state.season];
  const skyTop = dark ? season.darkSky[0] : season.sky[0];
  const skyBottom = dark ? season.darkSky[1] : season.sky[1];
  stage.style.setProperty('--stage-sky-top', skyTop);
  stage.style.setProperty('--stage-sky-bottom', skyBottom);
  stage.style.setProperty('--stage-sun', season.sun);
  stage.dataset.season = state.season;
  updateSeasonalGround(state.season, dark ? season.darkGround : season.ground, themeApplied && !reduceMotion);
  themeApplied = true;
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

/* ------------------------------------------------------------------ */
/* Tree generation                                                     */
/* ------------------------------------------------------------------ */

// 0 contributions = bare seedling, ~2000 = full size. Log curve so 5,000 isn't 50x taller than 100.
const growthOf = (count) => clamp(Math.log10(count + 1) / Math.log10(2001), 0, 1);

function generate(count, P, seed) {
  const rng = mulberry32(seed);
  const t = growthOf(count);
  const trunkLen = lerp(0.6, 1.7, t) * P.trunkH;
  const trunkRad = lerp(0.05, 0.14, t) * P.trunkR;
  const youngTree = count < 20;
  const maxDepth = youngTree ? 1 : clamp(Math.floor(1 + 4 * Math.pow(t, 1.8)), 1, 5);
  const leafFromDepth = Math.max(1, maxDepth - 1);

  const segs = [];
  const anchors = [];
  let top = 0, reach = 0;
  const UP = new THREE.Vector3(0, 1, 0);

  function grow(start, dir, len, rad, depth) {
    const end = start.clone().addScaledVector(dir, len);
    const stageStart = depth === 0 ? 0 : 0.18 + 0.72 * (depth - 1) / maxDepth;
    const stageEnd = depth === 0 ? 0.28 : 0.18 + 0.72 * depth / maxDepth;
    const growthStart = Math.min(stageEnd - 0.06, stageStart + rng() * (stageEnd - stageStart) * 0.2);
    segs.push({
      a: start,
      b: end,
      r0: rad,
      r1: Math.max(rad * 0.72, 0.012),
      depth,
      growthStart,
      growthEnd: stageEnd
    });
    top = Math.max(top, end.y);
    reach = Math.max(reach, Math.hypot(end.x, end.z));

    if (depth >= leafFromDepth) {
      anchors.push(end);
      if (depth === maxDepth) anchors.push(start.clone().lerp(end, 0.55));
    }
    if (depth >= maxDepth) return;

    const kids = youngTree
      ? 2 + Math.floor(rng() * 2)
      : P.kids[0] + Math.floor(rng() * (P.kids[1] - P.kids[0] + 1));
    const ref = Math.abs(dir.y) < 0.92 ? UP : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(dir, ref).normalize();
    const v = new THREE.Vector3().crossVectors(dir, u).normalize();
    const phase = rng() * Math.PI * 2;

    for (let k = 0; k < kids; k++) {
      const phi = phase + (k / kids) * Math.PI * 2 + (rng() - 0.5) * 0.7;
      const axis = u.clone().multiplyScalar(Math.cos(phi)).addScaledVector(v, Math.sin(phi));
      const tilt = (k === 0 && P.leader ? 0.25 : 1) * P.angle * (0.75 + rng() * 0.5);
      const d = dir.clone().applyAxisAngle(axis, tilt);
      d.y += P.up - P.droop * depth;
      d.normalize();
      grow(end, d, len * P.lenDecay * (0.85 + rng() * 0.3), rad * P.radDecay, depth + 1);
    }
  }

  grow(new THREE.Vector3(0, 0, 0), UP.clone(), trunkLen, trunkRad, 0);
  const mirroredBranches = (youngTree ? [] : segs.slice(1))
    .filter((segment) => Math.hypot(segment.a.x, segment.a.z, segment.b.x, segment.b.z) > 0.02)
    .map((segment) => ({
      ...segment,
      a: new THREE.Vector3(-segment.a.x, segment.a.y, -segment.a.z),
      b: new THREE.Vector3(-segment.b.x, segment.b.y, -segment.b.z)
    }));
  const mirroredAnchors = (youngTree ? [] : anchors)
    .filter((anchor) => Math.hypot(anchor.x, anchor.z) > 0.02)
    .map((anchor) => new THREE.Vector3(-anchor.x, anchor.y, -anchor.z));
  segs.push(...mirroredBranches);
  anchors.push(...mirroredAnchors);
  return { segs, anchors, top, reach, t, maxDepth };
}

function branchGeometry(segs) {
  const list = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  const pos = new THREE.Vector3(), dir = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
  for (const s of segs) {
    dir.subVectors(s.b, s.a);
    const len = dir.length();
    dir.divideScalar(len);
    const geo = state.treeStyle === 'pixel'
      ? new THREE.BoxGeometry(Math.max(s.r0 * 1.8, 0.025), len * 1.04, Math.max(s.r0 * 1.8, 0.025))
      : new THREE.CylinderGeometry(s.r1, s.r0, len * 1.04, 10, 1, false);
    q.setFromUnitVectors(Y, dir);
    pos.addVectors(s.a, s.b).multiplyScalar(0.5);
    m.compose(pos, q, one);
    geo.applyMatrix4(m);
    const vertexCount = geo.attributes.position.count;
    const starts = new Float32Array(vertexCount * 3);
    const times = new Float32Array(vertexCount * 2);
    for (let i = 0; i < vertexCount; i++) {
      starts[i * 3] = s.a.x;
      starts[i * 3 + 1] = s.a.y;
      starts[i * 3 + 2] = s.a.z;
      times[i * 2] = s.growthStart;
      times[i * 2 + 1] = s.growthEnd;
    }
    geo.setAttribute('aStart', new THREE.BufferAttribute(starts, 3));
    geo.setAttribute('aTime', new THREE.BufferAttribute(times, 2));
    list.push(geo);
  }
  const merged = mergeGeometries(list, false);
  list.forEach((g) => g.dispose());
  return merged;
}

/* ------------------------------------------------------------------ */
/* Scene assembly                                                      */
/* ------------------------------------------------------------------ */

const FALLING_LEAF_COUNT = 36;
let treeGroup = null, barkMesh = null, leafMesh = null, fallingLeaves = null;
let leafJitter = null, leafActivityLevels = null, leafTotal = 0, drifting = [], treeTop = 4;
let leafColorTransition = null;
let leafColorsInitialized = false;
let reveal = null;
let cameraFit = null;
let cameraFitDistance = 0;

function disposeTree() {
  if (!treeGroup) return;
  scene.remove(treeGroup);
  if (barkMesh) barkMesh.geometry.dispose();
  if (leafMesh) {
    leafMesh.dispose();
    leafMesh.geometry.dispose();
  }
  if (fallingLeaves) {
    fallingLeaves.dispose();
    fallingLeaves.geometry.dispose();
  }
  treeGroup = barkMesh = leafMesh = fallingLeaves = null;
  drifting = [];
  leafActivityLevels = null;
  leafColorTransition = null;
  leafColorsInitialized = false;
  reveal = null;
}

function recolor() {
  const hex = leafHex();
  const base = new THREE.Color(hex), c = new THREE.Color();
  const transition = leafColorsInitialized && !reduceMotion
    ? { start: performance.now(), duration: 650, leavesFrom: [], leavesTo: [], fallingFrom: [], fallingTo: [] }
    : null;
  if (leafMesh) {
    const activityPalette = [0.18, 0.36, 0.56, 0.78, 1].map((amount) =>
      new THREE.Color('#ffffff').lerp(base, amount)
    );
    for (let i = 0; i < leafTotal; i++) {
      if (transition) {
        leafMesh.getColorAt(i, c);
        transition.leavesFrom.push(c.clone());
      }
      if (leafActivityLevels) c.copy(activityPalette[leafActivityLevels[i]]);
      else c.copy(base);
      c.offsetHSL(leafJitter[i * 3], leafJitter[i * 3 + 1], leafJitter[i * 3 + 2]);
      if (transition) transition.leavesTo.push(c.clone());
      else leafMesh.setColorAt(i, c);
    }
    if (!transition) leafMesh.instanceColor.needsUpdate = true;
  }
  if (fallingLeaves) {
    for (let i = 0; i < drifting.length; i++) {
      if (transition) {
        fallingLeaves.getColorAt(i, c);
        transition.fallingFrom.push(c.clone());
      }
      c.copy(base).offsetHSL((Math.random() - 0.5) * 0.035, 0.02, (Math.random() - 0.5) * 0.12);
      if (transition) transition.fallingTo.push(c.clone());
      else fallingLeaves.setColorAt(i, c);
    }
    if (!transition) fallingLeaves.instanceColor.needsUpdate = true;
  }
  leafColorTransition = transition;
  leafColorsInitialized = true;
}

function updateLeafColorTransition(now) {
  if (!leafColorTransition) return;
  const transition = leafColorTransition;
  const progress = clamp((now - transition.start) / transition.duration, 0, 1);
  const eased = progress * progress * (3 - 2 * progress);
  const color = new THREE.Color();
  if (leafMesh && leafMesh.instanceColor) {
    for (let i = 0; i < transition.leavesTo.length; i++) {
      color.lerpColors(transition.leavesFrom[i], transition.leavesTo[i], eased);
      leafMesh.setColorAt(i, color);
    }
    leafMesh.instanceColor.needsUpdate = true;
  }
  if (fallingLeaves && fallingLeaves.instanceColor) {
    for (let i = 0; i < transition.fallingTo.length; i++) {
      color.lerpColors(transition.fallingFrom[i], transition.fallingTo[i], eased);
      fallingLeaves.setColorAt(i, color);
    }
    fallingLeaves.instanceColor.needsUpdate = true;
  }
  if (progress === 1) leafColorTransition = null;
}

function spawnLeaf(leaf, randomHeight) {
  leaf.x = (Math.random() - 0.5) * 4;
  leaf.y = randomHeight ? Math.random() * treeTop : treeTop * (0.65 + Math.random() * 0.35);
  leaf.z = (Math.random() - 0.5) * 4;
}

function buildGrowthTimeline() {
  const contributions = new Map(state.calendarDays.map((day) => [day.date, day]));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days = [];
  for (let offset = 364; offset >= 0; offset--) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    const contribution = contributions.get(key);
    days.push({ date: key, count: contribution ? contribution.count : 0, level: contribution ? contribution.level : 0 });
  }
  const cumulative = [0];
  for (const day of days) cumulative.push(cumulative[cumulative.length - 1] + day.count);
  return { days, cumulative, total: cumulative[cumulative.length - 1] };
}

function rebuild({ refit = false, animate = false, fromCalendar = false } = {}) {
  const P = SPECIES[state.species];
  const seed = hashStr((state.user || 'sample') + ':' + state.species);
  const gen = generate(state.count, P, seed);
  cameraFit = gen;
  const calendarTimeline = state.calendarDays.length ? buildGrowthTimeline() : null;
  const timeline = fromCalendar ? calendarTimeline : null;
  const activityDays = calendarTimeline ? calendarTimeline.days : state.calendarDays;
  treeTop = gen.top;

  disposeTree();
  treeGroup = new THREE.Group();

  barkMat.color.set(P.trunk);
  barkMesh = new THREE.Mesh(branchGeometry(gen.segs), barkMat);
  barkMesh.castShadow = true;
  barkMesh.customDepthMaterial = barkDepthMat;
  treeGroup.add(barkMesh);

  // Leaves: one instance per contribution.
  leafTotal = Math.min(state.count, MAX_LEAVES);
  if (leafTotal > 0) {
    const rng = mulberry32(seed ^ 0x9e3779b9);
    const sizeFactor = clamp(1.4 - 0.22 * Math.log10(state.count + 1), 0.65, 1.3);
    const spread = P.leafSpread * (0.25 + 0.55 * gen.t);
    leafJitter = new Float32Array(leafTotal * 3);
    leafActivityLevels = activityDays.length ? new Uint8Array(leafTotal) : null;
    const calendarXp = activityDays.reduce((sum, day) => sum + day.count, 0);
    let calendarDayIndex = 0, xpBeforeDay = 0;
    const leafBirths = new Float32Array(leafTotal);
    const instanceGeometry = makeLeafGeometry(state.leafShape);
    instanceGeometry.setAttribute('aBirth', new THREE.InstancedBufferAttribute(leafBirths, 1));
    leafMesh = new THREE.InstancedMesh(instanceGeometry, leafMat, leafTotal);
    leafMesh.frustumCulled = false;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < leafTotal; i++) {
      const a = gen.anchors[(rng() * gen.anchors.length) | 0];
      let x, y, z;
      do { x = rng() * 2 - 1; y = rng() * 2 - 1; z = rng() * 2 - 1; } while (x * x + y * y + z * z > 1);
      dummy.position.set(a.x + x * spread, a.y + y * spread * P.flatten, a.z + z * spread);
      dummy.rotation.set((rng() - 0.5) * 0.7, (rng() - 0.5) * 0.7, rng() * 6.283);
      dummy.scale.setScalar(P.leafSize * sizeFactor * (0.8 + rng() * 0.4));
      dummy.updateMatrix();
      leafMesh.setMatrixAt(i, dummy.matrix);
      leafBirths[i] = (i + 1) / leafTotal;
      leafJitter[i * 3] = (rng() - 0.5) * 0.03;
      leafJitter[i * 3 + 1] = (rng() - 0.5) * 0.08;
      leafJitter[i * 3 + 2] = (rng() - 0.5) * 0.1;
      if (leafActivityLevels) {
        const targetXp = calendarXp > 0 ? ((i + 0.5) / leafTotal) * calendarXp : 0;
        if (calendarXp > 0) {
          while (calendarDayIndex < activityDays.length - 1 && xpBeforeDay + activityDays[calendarDayIndex].count <= targetXp) {
            xpBeforeDay += activityDays[calendarDayIndex].count;
            calendarDayIndex++;
          }
        }
        leafActivityLevels[i] = activityDays[calendarXp > 0 ? calendarDayIndex : Math.floor(i * activityDays.length / leafTotal)].level;
      }
    }
    treeGroup.add(leafMesh);
    leafMesh.castShadow = false;
    leafMesh.geometry.attributes.aBirth.needsUpdate = true;
  } else {
    leafMesh = null;
  }

  if (state.falling && state.count >= 50 && !reduceMotion && leafTotal > 0) {
    fallingLeaves = new THREE.InstancedMesh(
      makeLeafGeometry(state.leafShape),
      fallingLeafMaterials[state.leafShape],
      FALLING_LEAF_COUNT
    );
    fallingLeaves.frustumCulled = false;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < FALLING_LEAF_COUNT; i++) {
      const leaf = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 0.08 + Math.random() * 0.06, speed: 0.25 + Math.random() * 0.3, phase: Math.random() * 6.283 };
      spawnLeaf(leaf, true);
      drifting.push(leaf);
      dummy.position.set(leaf.x, leaf.y, leaf.z);
      dummy.rotation.set(leaf.rx, leaf.ry, leaf.rz);
      dummy.scale.setScalar(leaf.scale);
      dummy.updateMatrix();
      fallingLeaves.setMatrixAt(i, dummy.matrix);
    }
    treeGroup.add(fallingLeaves);
    fallingLeaves.castShadow = false;
  }

  scene.add(treeGroup);
  recolor();

  if (refit) fitCamera(gen);

  if (animate && !reduceMotion) {
    growthProgress.value = 0;
    reveal = {
      t0: performance.now(),
      dur: timeline ? 6500 : 1200,
      timeline,
      calendarFlow: Boolean(timeline),
      currentXp: 0,
      currentLeaves: 0,
      status: timeline ? `@${state.user}: ${state.count.toLocaleString()} contributions (${state.range === 'all' ? 'all time' : 'last 12 months'}).` : ''
    };
    treeGroup.scale.setScalar(0.92);
    if (timeline) setStatus('Your contributions are flowing from the calendar into the tree as XP.');
  } else {
    growthProgress.value = 1;
    reveal = null;
    setGrowthCalendarDay(null);
  }
  updateReadout();
}

function fitCamera(gen, preserveZoom = false) {
  controls.target.set(0, gen.top * 0.5, 0);
  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(0.7, 0.3, 0.9);
  const zoom = preserveZoom && cameraFitDistance > 0 ? dir.length() / cameraFitDistance : 1;
  const horizontalFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
  const dist = Math.max(gen.top * 1.7, gen.reach * 2.9, gen.reach * 1.1 / Math.tan(horizontalFov / 2), 5);
  cameraFitDistance = dist;
  dir.setLength(dist * zoom);
  camera.position.copy(controls.target).add(dir);
  controls.minDistance = dist * 0.35;
  controls.maxDistance = dist * 2.2;
}

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  const wasPortrait = camera.aspect < 1;
  camera.aspect = w / h;
  const isPortrait = camera.aspect < 1;
  if (wasPortrait !== isPortrait && cameraFit) fitCamera(cameraFit, true);
  camera.updateProjectionMatrix();
}
new ResizeObserver(() => {
  if (!sidebarTransitioning) resize();
}).observe(stage);
resize();

let last = performance.now();
function tick(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  updateLeafColorTransition(now);

  if (seasonalGroundTransition) {
    const progress = clamp((now - seasonalGroundTransition.start) / seasonalGroundTransition.duration, 0, 1);
    updateSeasonalGroundTransition(progress);
    if (progress === 1) seasonalGroundTransition = null;
  }

  if (reveal && treeGroup) {
    const p = clamp((now - reveal.t0) / reveal.dur, 0, 1);
    let progress = p;
    if (reveal.calendarFlow) {
      const { days, cumulative, total } = reveal.timeline;
      const dayPosition = p * days.length;
      const dayIndex = Math.min(days.length - 1, Math.floor(dayPosition));
      const activeDay = days[dayIndex];
      const withinDay = p >= 1 ? 1 : dayPosition - dayIndex;
      const earnedXp = total > 0
        ? cumulative[dayIndex] + activeDay.count * withinDay
        : p;
      progress = total > 0 ? earnedXp / total : p;
      reveal.currentXp = Math.floor(state.count * progress);
      setGrowthCalendarDay(activeDay.date);
      if (p >= 1) reveal.currentXp = state.count;
    }
    const e = 1 - Math.pow(1 - progress, 3);
    growthProgress.value = reveal.calendarFlow ? progress : e;
    reveal.currentLeaves = Math.floor(leafTotal * (reveal.calendarFlow ? progress : e));
    if (leafMesh) leafMesh.count = leafTotal;
    if (reveal.calendarFlow) {
      treeGroup.scale.setScalar(lerp(0.92, 1, e));
      els.hudCount.textContent = reveal.currentXp.toLocaleString();
      els.hudSub.textContent = `contribution XP · @${state.user}`;
      els.bar.style.width = `${Math.round(growthOf(reveal.currentXp) * 100)}%`;
      els.stageName.textContent = stageLabel(reveal.currentXp);
      const shown = Math.min(reveal.currentLeaves, MAX_LEAVES);
      els.leaves.textContent = `${shown.toLocaleString()} ${shown === 1 ? 'leaf' : 'leaves'}` + (reveal.currentXp > MAX_LEAVES ? ' (max)' : '');
    } else {
      treeGroup.scale.setScalar(lerp(0.88, 1, e));
    }
    if (p >= 1) {
      const finishedReveal = reveal;
      reveal = null;
      if (finishedReveal.calendarFlow) {
        setGrowthCalendarDay(null);
        els.hudCount.textContent = state.count.toLocaleString();
        els.hudSub.textContent = `contribution XP · @${state.user}`;
        if (finishedReveal.status) setStatus(finishedReveal.status);
      }
    }
  }

  if (fallingLeaves) {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < drifting.length; i++) {
      const leaf = drifting[i];
      leaf.x += Math.sin(now * 0.0015 + leaf.phase) * 0.22 * dt;
      leaf.y -= leaf.speed * dt;
      leaf.z += Math.cos(now * 0.0012 + leaf.phase) * 0.18 * dt;
      leaf.rx += 0.8 * dt;
      leaf.ry += 1.1 * dt;
      if (leaf.y < 0.03) spawnLeaf(leaf, true);
      dummy.position.set(leaf.x, leaf.y, leaf.z);
      dummy.rotation.set(leaf.rx, leaf.ry, leaf.rz);
      dummy.scale.setScalar(leaf.scale);
      dummy.updateMatrix();
      fallingLeaves.setMatrixAt(i, dummy.matrix);
    }
    fallingLeaves.instanceMatrix.needsUpdate = true;
  }

  if (!reduceMotion) {
    for (let i = 0; i < grassBlades.length; i++) {
      const blade = grassBlades[i];
      grassDummy.position.set(blade.x, 0.015, blade.z);
      grassDummy.rotation.set(0, blade.yaw, Math.sin(now * 0.0015 + blade.phase) * 0.12);
      grassDummy.scale.set(blade.width * grassBladeScales[i], blade.height * grassBladeScales[i], blade.width * grassBladeScales[i]);
      grassDummy.updateMatrix();
      grassMesh.setMatrixAt(i, grassDummy.matrix);
    }
    grassMesh.instanceMatrix.needsUpdate = true;
  }

  controls.update();
  const flowing = Boolean(reveal && reveal.calendarFlow);
  xpFlow.hidden = !flowing;
  if (flowing) {
    const stageRect = stage.getBoundingClientRect();
    const activeCell = activeGrowthDate
      ? els.treeCalendarGrid.querySelector(`[data-date="${activeGrowthDate}"]`)
      : null;
    const cellRect = activeCell && !els.treeCalendar.hidden ? activeCell.getBoundingClientRect() : null;
    const startX = cellRect
      ? clamp(cellRect.left + cellRect.width / 2 - stageRect.left, 8, stageRect.width - 8)
      : stageRect.width / 2;
    const startY = cellRect
      ? clamp(cellRect.top + cellRect.height / 2 - stageRect.top, 8, stageRect.height - 8)
      : stageRect.height - 48;
    const target = new THREE.Vector3(0, Math.min(treeTop * 0.55, 1.2), 0).project(camera);
    const targetX = (target.x + 1) * stageRect.width / 2;
    const targetY = (1 - target.y) * stageRect.height / 2;
    for (let i = 0; i < xpOrbs.length; i++) {
      const progress = ((now - reveal.t0) / 900 + i / xpOrbs.length) % 1;
      const x = lerp(startX, targetX, progress);
      const y = lerp(startY, targetY, progress) - Math.sin(progress * Math.PI) * Math.min(stageRect.height * 0.18, 70);
      xpOrbs[i].style.transform = `translate(${x}px, ${y}px)`;
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

/* ------------------------------------------------------------------ */
/* Fetching contributions                                              */
/* ------------------------------------------------------------------ */

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    let body = null;
    try { body = await res.json(); } catch (_) { /* not JSON */ }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeCalendarDays(days) {
  if (!Array.isArray(days)) return [];
  return days.reduce((normalized, day) => {
    const date = day && day.date;
    const count = Number(day && (day.count ?? day.contributionCount));
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(count) || count < 0) return normalized;
    const dateValue = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(dateValue.getTime()) || dateValue.toISOString().slice(0, 10) !== date) return normalized;
    const level = Number(day.level);
    normalized.push({
      date,
      count,
      level: Number.isInteger(level) && level >= 0 && level <= 4
        ? level
        : count === 0 ? 0 : count >= 10 ? 4 : count >= 6 ? 3 : count >= 3 ? 2 : 1
    });
    return normalized;
  }, []).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchTotal(user, range) {
  let officialTotal = null;
  // 1) Your own function (uses the official GitHub GraphQL API).
  if (location.protocol.startsWith('http')) {
    try {
      const r = await getJson(`${API_URL}?user=${encodeURIComponent(user)}&range=${range}`);
      if (r.ok && r.body && Number.isFinite(r.body.total)) {
        officialTotal = r.body.total;
        const calendarDays = normalizeCalendarDays(r.body.calendar);
        if (calendarDays.length) return { total: officialTotal, calendarDays };
      }
      if (r.status === 404 && r.body && r.body.error) throw new Error(r.body.error);
    } catch (e) {
      if (e.message && e.message.includes('not found')) throw e;
      /* function not deployed or unreachable: try the fallback */
    }
  }
  // 2) Public community API, no token needed.
  const r = await getJson(`${FALLBACK_API}${encodeURIComponent(user)}?y=${range === 'all' ? 'all' : 'last'}`);
  if (!r.ok || !r.body || !r.body.total) {
    if (officialTotal !== null) return { total: officialTotal, calendarDays: [] };
    throw new Error(r.status === 404 ? `GitHub user "${user}" was not found.` : 'Could not reach GitHub data. Try again in a moment.');
  }
  const t = r.body.total;
  const total = officialTotal !== null
    ? officialTotal
    : range === 'all'
      ? Object.keys(t).filter((k) => /^\d{4}$/.test(k)).reduce((s, k) => s + t[k], 0)
      : Number.isFinite(t.lastYear) ? t.lastYear : Object.values(t).reduce((s, v) => s + v, 0);
  const calendarDays = normalizeCalendarDays(r.body.contributions);
  if (calendarDays.length) return { total, calendarDays };
  if (officialTotal !== null) return { total: officialTotal, calendarDays: [] };
  if (range === 'all') {
    return { total, calendarDays: [] };
  }
  return { total, calendarDays: [] };
}

/* ------------------------------------------------------------------ */
/* UI                                                                  */
/* ------------------------------------------------------------------ */

const els = {
  form: $('#userForm'), user: $('#username'), range: $('#range'), status: $('#status'),
  seasons: $('#seasons'), chips: $('#chips'), treeStyles: $('#treeStyles'), leafShapes: $('#leafShapes'),
  leafColor: $('#leafColor'), swatches: $('#swatches'), resetLeaf: $('#resetLeaf'),
  hudCount: $('#hudCount'), hudSub: $('#hudSub'), stageName: $('#stageName'), leaves: $('#leavesLabel'), bar: $('#barFill'),
  pRange: $('#previewRange'), pNum: $('#previewNum'), previewHint: $('#previewHint'),
  rotate: $('#rotate'), falling: $('#falling'), generateQr: $('#generateQr'),
  stageCalendarToggle: $('#stageCalendarToggle'),
  fallingHint: $('#fallingHint'),
  qrPreview: $('#qrPreview'), downloadQr: $('#downloadQr'), qrStatus: $('#qrStatus'),
  motionNote: $('#motionNote'),
  calendarToggle: $('#calendarToggle'), calendarToggleLabel: $('#calendarToggleLabel'),
  calendarHint: $('#calendarHint'), calendarPanel: $('#calendarPanel'),
  calendarGrid: $('#calendarGrid'), calendarSummary: $('#calendarSummary'),
  treeCalendar: $('#treeCalendar'), treeCalendarGrid: $('#treeCalendarGrid'), treeCalendarSummary: $('#treeCalendarSummary'),
  shareUrl: $('#shareUrl'), embed: $('#embedCode'), copyUrl: $('#copyUrl'), copyEmbed: $('#copyEmbed')
};
const growthCalendarCells = new Map();
let activeGrowthDate = null;
let treeCalendarHideTimer = 0;

function setGrowthCalendarDay(date) {
  if (date === activeGrowthDate) return;
  if (activeGrowthDate) {
    for (const cell of growthCalendarCells.get(activeGrowthDate) || []) {
      cell.removeAttribute('data-growth-active');
      if (date) cell.dataset.growthDone = 'true';
    }
  }
  if (!date) {
    for (const cells of growthCalendarCells.values()) {
      for (const cell of cells) {
        cell.removeAttribute('data-growth-active');
        cell.removeAttribute('data-growth-done');
      }
    }
    activeGrowthDate = null;
    return;
  }
  for (const cell of growthCalendarCells.get(date) || []) {
    cell.removeAttribute('data-growth-done');
    cell.dataset.growthActive = 'true';
  }
  activeGrowthDate = date;
}

function setStatus(text, error = false) {
  els.status.textContent = text;
  els.status.classList.toggle('error', error);
}

function renderCalendar() {
  growthCalendarCells.clear();
  activeGrowthDate = null;
  const contributions = new Map(state.calendarDays.map((day) => [day.date, day]));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 364);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + 6 - end.getUTCDay());
  let total = 0;
  const renderGrid = (grid, countTotals) => {
    grid.replaceChildren();
    const cursor = new Date(start);
    while (cursor <= end) {
      const week = document.createElement('div');
      week.className = 'calendar-week';
      week.setAttribute('role', 'row');
      const month = document.createElement('span');
      month.className = 'calendar-month';
      month.setAttribute('aria-hidden', 'true');
      week.appendChild(month);

      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        const date = cursor.toISOString().slice(0, 10);
        const day = contributions.get(date);
        if (countTotals && cursor <= today && day) total += day.count;
        if (cursor.getUTCDate() === 1) {
          month.textContent = cursor.toLocaleString('en', { month: 'short', timeZone: 'UTC' });
        }

        const cell = document.createElement('span');
        cell.className = 'calendar-day';
        cell.setAttribute('role', 'gridcell');
        cell.dataset.date = date;
        if (!growthCalendarCells.has(date)) growthCalendarCells.set(date, []);
        growthCalendarCells.get(date).push(cell);
        if (cursor > today) {
          cell.setAttribute('aria-hidden', 'true');
          cell.style.visibility = 'hidden';
        } else {
          const count = day ? day.count : 0;
          const level = day ? day.level : 0;
          const readableDate = cursor.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
          cell.dataset.level = level;
          cell.title = `${count.toLocaleString()} contributions on ${readableDate}`;
          cell.setAttribute('aria-label', `${count.toLocaleString()} contributions on ${readableDate}`);
        }
        week.appendChild(cell);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      grid.appendChild(week);
    }
  };
  renderGrid(els.calendarGrid, true);
  renderGrid(els.treeCalendarGrid, false);
  const summary = `${total.toLocaleString()} contributions in the last 12 months`;
  els.calendarSummary.textContent = summary;
  els.treeCalendarSummary.textContent = summary;
}

function updateCalendarPalette() {
  const color = leafHex();
  app.style.setProperty('--leaf-accent', color);
  app.style.setProperty('--calendar-0', `color-mix(in srgb, ${color} 12%, var(--panel))`);
  app.style.setProperty('--calendar-1', `color-mix(in srgb, ${color} 34%, var(--panel))`);
  app.style.setProperty('--calendar-2', `color-mix(in srgb, ${color} 56%, var(--panel))`);
  app.style.setProperty('--calendar-3', `color-mix(in srgb, ${color} 78%, var(--panel))`);
  app.style.setProperty('--calendar-4', color);
}

function updateCalendarControls() {
  const hasCalendar = state.user && state.calendarDays.length > 0;
  const stageCalendarOpen = EMBED ? state.embedCalendarOpen : state.calendarOpen;
  const showTreeCalendar = Boolean(hasCalendar && stageCalendarOpen);
  els.calendarToggle.disabled = !hasCalendar;
  els.stageCalendarToggle.disabled = !hasCalendar;
  els.calendarToggle.setAttribute('aria-expanded', String(showTreeCalendar));
  els.stageCalendarToggle.setAttribute('aria-expanded', String(showTreeCalendar));
  els.calendarToggleLabel.textContent = stageCalendarOpen
    ? 'Hide contribution calendar'
    : 'Show contribution calendar';
  const stageCalendarLabel = stageCalendarOpen ? 'Hide contribution calendar' : 'Show contribution calendar';
  els.stageCalendarToggle.setAttribute('aria-label', stageCalendarLabel);
  els.stageCalendarToggle.title = hasCalendar
    ? stageCalendarLabel
    : 'Load a GitHub profile with contribution calendar data to view it';
  els.calendarPanel.hidden = !showTreeCalendar;
  clearTimeout(treeCalendarHideTimer);
  if (!hasCalendar) {
    app.classList.remove('embed-calendar-open');
    els.treeCalendar.hidden = true;
    els.treeCalendar.setAttribute('aria-hidden', 'true');
  } else if (showTreeCalendar) {
    els.treeCalendar.hidden = false;
    els.treeCalendar.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      if (EMBED ? state.embedCalendarOpen : state.calendarOpen) {
        app.classList.add('embed-calendar-open');
      }
    });
  } else {
    app.classList.remove('embed-calendar-open');
    els.treeCalendar.setAttribute('aria-hidden', 'true');
    treeCalendarHideTimer = setTimeout(() => {
      if (!(EMBED ? state.embedCalendarOpen : state.calendarOpen)) {
        els.treeCalendar.hidden = true;
      }
    }, 240);
  }
  els.calendarHint.hidden = Boolean(hasCalendar);
  els.calendarHint.textContent = state.user
    ? 'Daily contributions are unavailable. Try loading this profile again.'
    : 'Load a GitHub username to see daily contributions.';
}

const stageLabel = (n) => n === 0 ? 'Bare seed' : n < 10 ? 'Seedling' : n < 50 ? 'Sapling' : n < 200 ? 'Young tree' : n < 800 ? 'Mature tree' : 'Ancient tree';

function updateReadout() {
  const n = state.count;
  const displayCount = reveal && reveal.calendarFlow ? reveal.currentXp : n;
  els.hudCount.textContent = displayCount.toLocaleString();
  els.hudSub.textContent = state.user ? `contribution XP · @${state.user}` : 'contributions (sample)';
  els.stageName.textContent = stageLabel(displayCount);
  const shown = reveal && reveal.calendarFlow ? reveal.currentLeaves : Math.min(n, MAX_LEAVES);
  els.leaves.textContent = `${shown.toLocaleString()} ${shown === 1 ? 'leaf' : 'leaves'}` + (displayCount > MAX_LEAVES ? ' (max)' : '');
  els.bar.style.width = `${Math.round(growthOf(displayCount) * 100)}%`;
  els.pRange.value = Math.min(n, 2000);
  if (document.activeElement !== els.pNum) els.pNum.value = n;
  const profileLoaded = Boolean(state.user);
  els.pRange.disabled = profileLoaded;
  els.pNum.disabled = profileLoaded;
  els.previewHint.hidden = !profileLoaded;
  els.leafColor.value = leafHex();
  [...els.swatches.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === leafHex())));
  [...els.chips.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === state.species)));
  [...els.seasons.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === state.season)));
  [...els.treeStyles.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === state.treeStyle)));
  [...els.leafShapes.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === state.leafShape)));
  updateCalendarPalette();
  els.rotate.checked = state.rotate;
  els.falling.checked = state.falling;
  els.fallingHint.hidden = state.count >= 50;
  updateCalendarControls();
  updateShare();
}

function shareLink(embed) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  const q = new URLSearchParams();
  if (state.user) { q.set('u', state.user); if (state.range === 'year') q.set('range', 'year'); } else { q.set('n', String(state.count)); }
  q.set('type', state.species);
  q.set('season', state.season);
  if (state.treeStyle !== 'natural') q.set('tree', state.treeStyle);
  if (state.leafShape !== 'leaf') q.set('leaf', state.leafShape);
  if (state.customLeaf) q.set('color', state.customLeaf.slice(1));
  if (!state.falling) q.set('falling', '0');
  if (embed) q.set('embed', '1');
  return `${u.toString()}?${q.toString()}`;
}
function updateShare() {
  els.shareUrl.value = shareLink(false);
  els.embed.value = `<iframe src="${shareLink(true)}" width="100%" height="480" style="border:0" title="My GitHub contribution tree" loading="lazy"></iframe>`;
  if (qrTargetUrl && qrTargetUrl !== shareLink(false)) {
    clearQrPreview();
    els.qrStatus.textContent = 'Tree settings changed. Generate a new QR code to match.';
  }
}

async function copyText(input, btn) {
  try {
    await navigator.clipboard.writeText(input.value);
  } catch (_) {
    input.select();
    document.execCommand('copy');
  }
  const old = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = old; }, 1400);
}

let queued = false;
function queueRebuild() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; rebuild(); });
}

for (const [key, season] of Object.entries(SEASONS)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'season';
  b.dataset.key = key;
  b.setAttribute('aria-pressed', String(key === state.season));
  b.innerHTML = '<span class="season-icon" aria-hidden="true"></span><span></span>';
  b.firstElementChild.textContent = season.icon;
  b.lastElementChild.textContent = season.label;
  b.addEventListener('click', () => {
    state.season = key;
    applyTheme();
    updateReadout();
  });
  els.seasons.appendChild(b);
}

// Build controls
for (const [key, s] of Object.entries(SPECIES)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.dataset.key = key;
  b.style.setProperty('--trunk', s.trunk);
  b.style.setProperty('--leaf', s.leaf);
  b.innerHTML = '<span class="dots" aria-hidden="true"><i class="t"></i><i class="l"></i></span><span></span>';
  b.lastElementChild.textContent = s.label;
  b.addEventListener('click', () => {
    state.species = key;
    rebuild({ animate: true });
  });
  els.chips.appendChild(b);
}
function addStyleOptions(container, options, valueKey) {
  for (const [key, label] of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'style-option';
    button.dataset.key = key;
    button.setAttribute('aria-pressed', String(state[valueKey] === key));
    button.textContent = label;
    button.addEventListener('click', () => {
      if (state[valueKey] === key) return;
      state[valueKey] = key;
      rebuild({ animate: true });
    });
    container.appendChild(button);
  }
}
addStyleOptions(els.treeStyles, [['natural', 'Natural'], ['pixel', 'Pixel tree']], 'treeStyle');
addStyleOptions(els.leafShapes, [['leaf', 'Leaf'], ['circle', 'Circle'], ['pixel', 'Pixel']], 'leafShape');
for (const hex of SWATCHES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.dataset.color = hex;
  b.style.background = hex;
  b.setAttribute('aria-label', `Leaf color ${hex}`);
  b.addEventListener('click', () => { state.customLeaf = hex; recolor(); updateReadout(); });
  els.swatches.appendChild(b);
}

els.leafColor.addEventListener('input', () => { state.customLeaf = els.leafColor.value; recolor(); updateReadout(); });
els.resetLeaf.addEventListener('click', () => { state.customLeaf = null; recolor(); updateReadout(); });
els.calendarToggle.addEventListener('click', () => {
  state.calendarOpen = !state.calendarOpen;
  updateCalendarControls();
});
els.stageCalendarToggle.addEventListener('click', () => {
  if (EMBED) {
    state.embedCalendarOpen = !state.embedCalendarOpen;
  } else {
    state.calendarOpen = !state.calendarOpen;
  }
  updateCalendarControls();
});

els.pRange.addEventListener('input', () => { state.count = +els.pRange.value; state.user = ''; state.calendarDays = []; state.calendarOpen = false; setStatus('Previewing a sample number.'); queueRebuild(); updateReadoutLight(); });
els.pNum.addEventListener('input', () => {
  const v = clamp(parseInt(els.pNum.value, 10) || 0, 0, 100000);
  state.count = v; state.user = ''; state.calendarDays = []; state.calendarOpen = false; setStatus('Previewing a sample number.'); queueRebuild(); updateReadoutLight();
});
function updateReadoutLight() { updateReadout(); }

els.range.addEventListener('change', () => { state.range = els.range.value; if (els.user.value.trim()) load(); });
els.rotate.addEventListener('change', () => { state.rotate = els.rotate.checked; controls.autoRotate = state.rotate; updateShare(); });
els.falling.addEventListener('change', () => { state.falling = els.falling.checked; rebuild(); });
els.copyUrl.addEventListener('click', () => copyText(els.shareUrl, els.copyUrl));
els.copyEmbed.addEventListener('click', () => copyText(els.embed, els.copyEmbed));
let qrCodeLibraryPromise;
let qrBlobUrl = '';
let qrTargetUrl = '';
function loadQRCodeLibrary() {
  if (!qrCodeLibraryPromise) {
    qrCodeLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
      script.referrerPolicy = 'no-referrer';
      script.onload = () => {
        if (window.QRCode && window.QRCode.CorrectLevel) resolve(window.QRCode);
        else {
          qrCodeLibraryPromise = null;
          reject(new Error('The QR code generator did not load correctly.'));
        }
      };
      script.onerror = () => {
        qrCodeLibraryPromise = null;
        reject(new Error('Could not load the QR code generator. Check your connection and try again.'));
      };
      document.head.appendChild(script);
    });
  }
  return qrCodeLibraryPromise;
}

function qrUnavailableReason() {
  if (!/^https?:$/.test(location.protocol)) return 'Open the hosted tree page to download a QR code that works on other devices.';
  if (location.hostname === 'localhost' || location.hostname.endsWith('.localhost') || location.hostname === '127.0.0.1' || location.hostname === '::1') {
    return 'Open the publicly hosted tree page to download a QR code that works on other devices.';
  }
  return '';
}

function clearQrPreview() {
  if (qrBlobUrl) URL.revokeObjectURL(qrBlobUrl);
  qrBlobUrl = '';
  qrTargetUrl = '';
  els.qrPreview.removeAttribute('src');
  els.qrPreview.hidden = true;
  els.downloadQr.removeAttribute('href');
  els.downloadQr.removeAttribute('download');
  els.downloadQr.hidden = true;
}

els.generateQr.addEventListener('click', async () => {
  const unavailableReason = qrUnavailableReason();
  if (unavailableReason) {
    els.qrStatus.textContent = unavailableReason;
    return;
  }
  els.generateQr.disabled = true;
  clearQrPreview();
  els.qrStatus.textContent = 'Generating a QR code for this tree...';
  try {
    const QRCode = await loadQRCodeLibrary();
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-10000px;top:0';
    document.body.appendChild(container);
    let png, blob;
    const targetUrl = shareLink(false);
    try {
      new QRCode(container, {
        text: targetUrl,
        width: 640,
        height: 640,
        colorDark: '#1d2a22',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
      const canvas = container.querySelector('canvas');
      if (!canvas) throw new Error('Could not render the QR code.');
      png = canvas.toDataURL('image/png');
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not prepare the QR code download.');
    } finally {
      container.remove();
    }
    if (targetUrl !== shareLink(false)) {
      throw new Error('Tree settings changed while the QR code was being generated. Generate it again.');
    }
    qrBlobUrl = URL.createObjectURL(blob);
    qrTargetUrl = targetUrl;
    els.qrPreview.src = png;
    els.qrPreview.hidden = false;
    els.downloadQr.href = qrBlobUrl;
    els.downloadQr.download = `${state.user || 'my'}-contribution-tree-qr.png`;
    els.downloadQr.hidden = false;
    els.qrStatus.textContent = 'QR code ready. Scan it to open this tree, or select Download QR code to save it.';
  } catch (error) {
    els.qrStatus.textContent = error.message || 'Could not create the QR code. Try again.';
  } finally {
    els.generateQr.disabled = false;
  }
});

const USER_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

async function load() {
  const name = els.user.value.trim().replace(/^@/, '');
  if (!USER_RE.test(name)) { setStatus('Enter a valid GitHub username.', true); return; }
  const btn = $('#loadBtn');
  btn.disabled = true;
  setStatus(`Loading @${name}...`);
  try {
    const result = await fetchTotal(name, state.range);
    state.user = name;
    state.count = result.total;
    state.calendarDays = result.calendarDays;
    state.calendarOpen = state.calendarDays.length > 0 && !EMBED;
    state.embedCalendarOpen = false;
    renderCalendar();
    setStatus(`@${name}: ${result.total.toLocaleString()} contributions (${state.range === 'all' ? 'all time' : 'last 12 months'}).`);
    rebuild({ refit: true, animate: true, fromCalendar: state.calendarDays.length > 0 });
  } catch (e) {
    setStatus(e.message || 'Something went wrong.', true);
  } finally {
    btn.disabled = false;
  }
}
els.form.addEventListener('submit', (e) => { e.preventDefault(); load(); });

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

els.falling.disabled = reduceMotion;
els.motionNote.hidden = !reduceMotion;
const unavailableQrReason = qrUnavailableReason();
els.generateQr.disabled = Boolean(unavailableQrReason);
els.qrStatus.textContent = unavailableQrReason || 'Generate a QR code to preview it before downloading.';
els.range.value = state.range;
const urlUser = (params.get('u') || '').replace(/^@/, '');

rebuild({ refit: true, animate: true });
requestAnimationFrame(tick);

if (USER_RE.test(urlUser)) {
  els.user.value = urlUser;
  load();
} else {
  setStatus('Showing a sample tree. Enter a username to grow yours.');
}
if (EMBED) {
  document.body.classList.remove('intro-pending');
  $('#app').removeAttribute('aria-hidden');
  $('#app').removeAttribute('inert');
} else {
  setTimeout(() => {
    document.body.classList.remove('intro-pending');
    $('#app').removeAttribute('aria-hidden');
    $('#app').removeAttribute('inert');
  }, reduceMotion ? 250 : 1500);
}
