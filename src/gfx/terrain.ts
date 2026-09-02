import * as THREE from 'three';
import { clamp01, fbm, ridge, smoothstep, value2 } from './noise';
import { pavingSurface, rockSurface, runeRing, tiled, turfSurface } from './textures';

/**
 * The arena is built, not loaded.
 *
 * It is a sunken amphitheatre: a dead-level paved floor (gameplay lives here
 * and nowhere else, so every ground indicator can hug it without a height
 * query), a stone kerb, three terraces climbing back to ground level, then
 * turf and cliffs closing the horizon. The terraces are the whole trick — at
 * a 57° camera they are what tells your eye this is a place with depth
 * instead of a picture of a floor.
 */

export interface Arena {
  /** Everything, positioned so child coordinates are raw world units. */
  group: THREE.Group;
  floor: THREE.Mesh;
  update(t: number): void;
  dispose(): void;
}

const KERB = 44; // stone frame hugging the playfield
const STEP_W = 58; // depth of one terrace
const STEP_H = 40; // rise of one terrace
const STEPS = 3;
const TERRACE_OUT = KERB + STEP_W * STEPS; // outer edge of the seating
const GROUND = STEP_H * STEPS; // height of the surrounding land
const APRON = 240; // level turf before the ground starts climbing

/** Distance from a point to the playfield rectangle, negative inside. */
const rectDist = (x: number, z: number, w: number, h: number): number => {
  const dx = Math.max(-x, x - w, 0);
  const dz = Math.max(-z, z - h, 0);
  if (dx === 0 && dz === 0) return -Math.min(x, w - x, z, h - z);
  return Math.hypot(dx, dz);
};

const terrainHeight = (d: number, x: number, z: number, seed: number): { y: number; rock: number } => {
  // Under the arena and its terraces the land is pushed out of sight.
  if (d < TERRACE_OUT + 8) return { y: -300, rock: 0 };

  const o = d - TERRACE_OUT;
  const undulate = (fbm(x * 0.0016, z * 0.0016, { seed: seed + 5, octaves: 4 }) - 0.5) * 52;
  const detail = (fbm(x * 0.0072, z * 0.0072, { seed: seed + 15, octaves: 3 }) - 0.5) * 14;

  if (o < APRON) {
    const t = smoothstep(0, APRON, o);
    return { y: GROUND - 6 + undulate * t * 0.4 + detail * t, rock: 0 };
  }

  // The rise starts close on purpose: only a few hundred units of ground past
  // the terraces is ever on screen, so cliffs further out would not exist.
  const rise = smoothstep(APRON, APRON + 470, o);
  const crest = ridge(x * 0.0013, z * 0.0013, { seed: seed + 25, octaves: 4 });
  const jag = fbm(x * 0.0045, z * 0.0045, { seed: seed + 35, octaves: 4 });
  const wall = rise ** 1.3 * (300 + crest * 360 + jag * 120);
  const far = smoothstep(APRON + 470, APRON + 1600, o) * 480;

  return { y: GROUND - 6 + undulate * 0.6 + detail + wall + far, rock: 0 };
};

/**
 * Rock shows where the ground is steep. Deriving it from the local gradient
 * rather than from distance is what stops the cliff faces from wearing
 * vertically-smeared grass.
 */
const terrainRock = (x: number, z: number, w: number, h: number, seed: number): number => {
  const e = 26;
  const at = (px: number, pz: number) => terrainHeight(rectDist(px, pz, w, h), px, pz, seed).y;
  const c = at(x, z);
  if (c < 0) return 0;
  const dx = (at(x + e, z) - at(x - e, z)) / (2 * e);
  const dz = (at(x, z + e) - at(x, z - e)) / (2 * e);
  const slope = Math.hypot(dx, dz);
  const elevation = smoothstep(GROUND + 90, GROUND + 340, c);
  return clamp01(smoothstep(0.34, 0.95, slope) * 0.85 + elevation * 0.5);
};

/**
 * Blends two full material sets across the terrain with a per-vertex weight.
 * Patching MeshStandardMaterial keeps three's lighting and shadow receiving —
 * as a raw ShaderMaterial this would mean reimplementing both.
 */
const blendedTerrainMaterial = (seed: number, tile: number): THREE.MeshStandardMaterial => {
  const turf = turfSurface(seed);
  const rock = rockSurface(seed);

  const mat = new THREE.MeshStandardMaterial({
    map: turf.albedo,
    roughness: 0.99,
    metalness: 0,
    dithering: true,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRockMap = { value: rock.albedo };
    shader.uniforms.uTile = { value: 1 / tile };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aRock;\nvarying float vRock;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRock = aRock;
        vWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        vWNormal = normalize( mat3( modelMatrix ) * objectNormal );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uRockMap;
        uniform float uTile;
        varying float vRock;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        // Triplanar: project the texture down all three axes and weight by the
        // surface normal. Without it every cliff face wears vertically smeared
        // grass, which is the single most obvious "this is a displaced plane"
        // tell there is.
        vec4 triplanar( sampler2D tex, vec3 p, vec3 n, float s ) {
          vec3 w = pow( abs( n ), vec3( 5.0 ) );
          w /= ( w.x + w.y + w.z );
          return texture2D( tex, p.xz * s ) * w.y
               + texture2D( tex, p.zy * s ) * w.x
               + texture2D( tex, p.xy * s ) * w.z;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `
        vec3 tpN = normalize( vWNormal );
        vec4 turfTexel = triplanar( map, vWPos, tpN, uTile );
        vec4 rockTexel = triplanar( uRockMap, vWPos, tpN, uTile * 1.9 );
        // Steep ground is rock regardless of the painted weight.
        float steep = 1.0 - clamp( tpN.y, 0.0, 1.0 );
        float rockMix = clamp( max( vRock, smoothstep( 0.25, 0.62, steep ) ), 0.0, 1.0 );
        diffuseColor *= mix( turfTexel, rockTexel, rockMix );
        `,
      );
  };
  mat.customProgramCacheKey = () => 'rift-terrain-triplanar';
  return mat;
};

const roundedRect = (w: number, h: number, r: number): THREE.Shape => {
  const s = new THREE.Shape();
  s.moveTo(r, 0);
  s.lineTo(w - r, 0);
  s.quadraticCurveTo(w, 0, w, r);
  s.lineTo(w, h - r);
  s.quadraticCurveTo(w, h, w - r, h);
  s.lineTo(r, h);
  s.quadraticCurveTo(0, h, 0, h - r);
  s.lineTo(0, r);
  s.quadraticCurveTo(0, 0, r, 0);
  return s;
};

/** A frame: rounded rect with a rounded rect punched out of it. */
const frameShape = (outerW: number, outerH: number, band: number, r: number): THREE.Shape => {
  const shape = roundedRect(outerW, outerH, r);
  const innerW = outerW - band * 2;
  const innerH = outerH - band * 2;
  const inner = roundedRect(innerW, innerH, Math.max(4, r - band * 0.6));
  const pts = inner.getPoints(48).map((p) => new THREE.Vector2(p.x + band, p.y + band));
  pts.reverse();
  shape.holes.push(new THREE.Path(pts));
  return shape;
};

export const buildArena = (w: number, h: number, seed = 7, accent = '#58e0ff'): Arena => {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const accentColor = new THREE.Color(accent);
  const rockSurf = rockSurface(seed);
  const paveSurf = pavingSurface(seed);

  const rand = (() => {
    let s = seed * 9301 + 49297;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  })();

  // ------------------------------------------------------------- playfield
  const TILE = 380; // world units per texture tile: ~95-unit ashlar blocks
  const floorMat = track(
    new THREE.MeshStandardMaterial({
      map: track(tiled(paveSurf.albedo, w / TILE, h / TILE)),
      normalMap: track(tiled(paveSurf.normal, w / TILE, h / TILE)),
      roughnessMap: track(tiled(paveSurf.roughness, w / TILE, h / TILE)),
      roughness: 1,
      metalness: 0.02,
      normalScale: new THREE.Vector2(0.95, 0.95),
      color: 0x7c8798,
    }),
  );
  floorMat.vertexColors = true;
  const floorGeo = track(new THREE.PlaneGeometry(w, h, 72, 44));
  {
    // Baked contact shadow where the kerb meets the floor, and a slow mottle
    // across the middle. Uniform stone is what makes a floor look printed.
    const fp = floorGeo.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(fp.count * 3);
    for (let i = 0; i < fp.count; i++) {
      const px = fp.getX(i) + w / 2;
      const pz = -fp.getY(i) + h / 2;
      const edge = Math.min(px, w - px, pz, h - pz);
      const ao = 0.42 + 0.58 * smoothstep(0, 190, edge);
      const mottle = 0.9 + fbm(px * 0.0022, pz * 0.0022, { seed: seed + 71, octaves: 3 }) * 0.22;
      // A faint warm pool of light in the centre, where the fight happens.
      const centre = 1 + smoothstep(700, 0, Math.hypot(px - w / 2, pz - h / 2)) * 0.16;
      const v = ao * mottle * centre;
      col[i * 3] = v * 1.02;
      col[i * 3 + 1] = v;
      col[i * 3 + 2] = v * 0.98;
    }
    floorGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(w / 2, 0, h / 2);
  floor.receiveShadow = true;
  group.add(floor);

  // The engraved ring. Additive, so it glows without lighting the stone.
  const runeSize = Math.min(w, h) * 0.62;
  const runeMat = track(
    new THREE.MeshBasicMaterial({
      map: runeRing(),
      transparent: true,
      opacity: 0.11,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: accentColor.clone().lerp(new THREE.Color('#ffffff'), 0.4),
    }),
  );
  const rune = new THREE.Mesh(track(new THREE.PlaneGeometry(runeSize, runeSize)), runeMat);
  rune.rotation.x = -Math.PI / 2;
  rune.position.set(w / 2, 0.6, h / 2);
  rune.renderOrder = 1;
  group.add(rune);

  // ------------------------------------------------------- kerb + terraces
  // Extruded frames carry world-space UVs, so the repeat is per unit.
  const STONE_TILE = 1 / 300;
  const stoneMat = track(
    new THREE.MeshStandardMaterial({
      map: track(tiled(paveSurf.albedo, STONE_TILE)),
      normalMap: track(tiled(paveSurf.normal, STONE_TILE)),
      roughnessMap: track(tiled(paveSurf.roughness, STONE_TILE)),
      roughness: 1,
      metalness: 0.05,
      color: 0x6d7684,
    }),
  );
  const stoneDarkMat = track(stoneMat.clone());
  stoneDarkMat.color = new THREE.Color(0x59616d);

  const addFrame = (band: number, inset: number, top: number, thickness: number, mat: THREE.Material) => {
    const ow = w + inset * 2;
    const oh = h + inset * 2;
    const shape = frameShape(ow, oh, band, Math.min(60, inset + band * 0.5));
    const geo = track(
      new THREE.ExtrudeGeometry(shape, {
        depth: thickness,
        bevelEnabled: true,
        bevelSize: 7,
        bevelThickness: 6,
        bevelSegments: 1,
        curveSegments: 6,
      }),
    );
    const mesh = new THREE.Mesh(geo, mat);
    // Rotating -90° about X maps the shape's local +y onto world -z, so the
    // frame lands on the arena instead of being flung out past its far edge.
    // The extrusion then runs up +y, hence the -thickness on the origin.
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(-inset, top - thickness, h + inset);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // Kerb, flush with the floor.
  addFrame(KERB, KERB, STEP_H * 0.42, STEP_H * 0.42, stoneMat);
  // Three terraces climbing back to ground level.
  for (let i = 0; i < STEPS; i++) {
    const inset = KERB + STEP_W * (i + 1);
    addFrame(STEP_W, inset, STEP_H * (i + 1), STEP_H, i % 2 === 0 ? stoneDarkMat : stoneMat);
  }

  // A thin emissive inlay on the inner lip. The boundary is information.
  const lipMat = track(
    new THREE.MeshBasicMaterial({ color: accentColor, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  const lipGeo = track(new THREE.PlaneGeometry(1, 1));
  const lips: Array<[number, number, number, number]> = [
    [w / 2, -2, w + 4, 6],
    [w / 2, h + 2, w + 4, 6],
    [-2, h / 2, 6, h + 4],
    [w + 2, h / 2, 6, h + 4],
  ];
  for (const [x, z, sx, sz] of lips) {
    const m = new THREE.Mesh(lipGeo, lipMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.9, z);
    m.scale.set(sx, sz, 1);
    m.renderOrder = 2;
    group.add(m);
  }

  // -------------------------------------------------------- outer landscape
  const EXT = 2400;
  const landGeo = track(new THREE.PlaneGeometry(w + EXT * 2, h + EXT * 2, 160, 140));
  const pos = landGeo.attributes.position as THREE.BufferAttribute;
  const rockAttr = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i) + w / 2;
    const pz = -pos.getY(i) + h / 2;
    pos.setZ(i, terrainHeight(rectDist(px, pz, w, h), px, pz, seed).y);
    rockAttr[i] = terrainRock(px, pz, w, h, seed);
  }
  landGeo.setAttribute('aRock', new THREE.BufferAttribute(rockAttr, 1));
  landGeo.computeVertexNormals();
  const land = new THREE.Mesh(landGeo, track(blendedTerrainMaterial(seed, 780)));
  land.rotation.x = -Math.PI / 2;
  land.position.set(w / 2, 0, h / 2);
  land.receiveShadow = true;
  group.add(land);

  // ------------------------------------------------------------------ props
  const dummy = new THREE.Object3D();

  // Sparse boulders sitting on the turf behind the terraces — scenery, not a wall.
  const rockGeo = track(new THREE.IcosahedronGeometry(1, 1));
  const rp = rockGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < rp.count; i++) {
    const n = value2(rp.getX(i) * 3.1, rp.getY(i) * 3.1 + rp.getZ(i) * 1.7, seed);
    const k = 0.7 + n * 0.62;
    rp.setXYZ(i, rp.getX(i) * k, rp.getY(i) * k * 0.7, rp.getZ(i) * k);
  }
  rockGeo.computeVertexNormals();
  const boulderMat = track(
    new THREE.MeshStandardMaterial({
      map: track(tiled(rockSurf.albedo, 1.4)),
      normalMap: track(tiled(rockSurf.normal, 1.4)),
      roughness: 0.95,
      metalness: 0,
      color: 0x9aa2b0,
      flatShading: true,
    }),
  );
  const perimeterPoint = (spread: number, minOut: number, maxOut: number): { x: number; z: number } => {
    const per = 2 * (w + h);
    let u = rand() * per;
    let ex: number;
    let ez: number;
    if (u < w) { ex = u; ez = 0; }
    else if ((u -= w) < h) { ex = w; ez = u; }
    else if ((u -= h) < w) { ex = w - u; ez = h; }
    else { ex = 0; ez = h - (u - w); }
    const nx = ex < w * 0.5 ? -1 : 1;
    const nz = ez < h * 0.5 ? -1 : 1;
    const out = minOut + rand() * rand() * (maxOut - minOut);
    return {
      x: ex + (ex <= 1 || ex >= w - 1 ? nx * out : (rand() - 0.5) * spread),
      z: ez + (ez <= 1 || ez >= h - 1 ? nz * out : (rand() - 0.5) * spread),
    };
  };

  const BOULDERS = 54;
  const boulders = new THREE.InstancedMesh(rockGeo, boulderMat, BOULDERS);
  boulders.castShadow = true;
  boulders.receiveShadow = true;
  let bi = 0;
  for (let i = 0; i < BOULDERS * 4 && bi < BOULDERS; i++) {
    const p = perimeterPoint(140, TERRACE_OUT + 90, TERRACE_OUT + 900);
    const d = rectDist(p.x, p.z, w, h);
    if (d < TERRACE_OUT + 60) continue;
    const t = terrainHeight(d, p.x, p.z, seed);
    const s = 22 + rand() * 52;
    dummy.position.set(p.x, t.y + s * 0.3, p.z);
    dummy.rotation.set(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    boulders.setMatrixAt(bi++, dummy.matrix);
  }
  boulders.count = bi;
  boulders.instanceMatrix.needsUpdate = true;
  group.add(boulders);

  // Grass tufts: crossed billboards that catch the rim light.
  const grassCanvas = document.createElement('canvas');
  grassCanvas.width = 64;
  grassCanvas.height = 64;
  {
    const g = grassCanvas.getContext('2d')!;
    for (let i = 0; i < 16; i++) {
      const x = 4 + rand() * 56;
      const hgt = 24 + rand() * 36;
      const lean = (rand() - 0.5) * 22;
      const grad = g.createLinearGradient(x, 64, x + lean, 64 - hgt);
      grad.addColorStop(0, 'rgba(30,52,28,1)');
      grad.addColorStop(1, 'rgba(122,178,92,0.92)');
      g.strokeStyle = grad;
      g.lineWidth = 1.5 + rand() * 2;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, 64);
      g.quadraticCurveTo(x + lean * 0.4, 64 - hgt * 0.6, x + lean, 64 - hgt);
      g.stroke();
    }
  }
  const grassTex = track(new THREE.CanvasTexture(grassCanvas));
  grassTex.colorSpace = THREE.SRGBColorSpace;
  const grassMat = track(
    new THREE.MeshStandardMaterial({ map: grassTex, transparent: true, alphaTest: 0.32, side: THREE.DoubleSide, roughness: 1, metalness: 0 }),
  );
  const GRASS = 620;
  const grass = new THREE.InstancedMesh(track(new THREE.PlaneGeometry(1, 1)), grassMat, GRASS);
  grass.receiveShadow = true;
  let gi = 0;
  for (let i = 0; i < GRASS * 4 && gi < GRASS; i++) {
    const p = perimeterPoint(120, TERRACE_OUT + 20, TERRACE_OUT + 620);
    const d = rectDist(p.x, p.z, w, h);
    if (d < TERRACE_OUT + 16) continue;
    const t = terrainHeight(d, p.x, p.z, seed);
    if (t.rock > 0.35) continue;
    const s = 44 + rand() * 46;
    dummy.position.set(p.x, t.y + s / 2 - 5, p.z);
    dummy.rotation.set(0, rand() * Math.PI, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    grass.setMatrixAt(gi++, dummy.matrix);
  }
  grass.count = gi;
  grass.instanceMatrix.needsUpdate = true;
  group.add(grass);

  // ------------------------------------------------------- braziers & banners
  const braziers: Array<{ light: THREE.PointLight; flame: THREE.Mesh; phase: number }> = [];
  const pillarGeo = track(new THREE.CylinderGeometry(17, 25, 150, 8, 1));
  const bowlGeo = track(new THREE.CylinderGeometry(31, 16, 28, 10, 1, true));
  const metalMat = track(new THREE.MeshStandardMaterial({ color: 0x6d5f45, roughness: 0.52, metalness: 0.65 }));
  const flameGeo = track(new THREE.SphereGeometry(27, 10, 8));
  const flameMat = track(
    new THREE.MeshBasicMaterial({ color: 0xffb257, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
  );

  const braziersAt: Array<[number, number]> = [];
  const inset = TERRACE_OUT + 44;
  braziersAt.push([-inset, -inset], [w + inset, -inset], [-inset, h + inset], [w + inset, h + inset]);
  // Two more along each long edge so the light wraps the arena.
  braziersAt.push([w * 0.32, -inset], [w * 0.68, -inset], [w * 0.32, h + inset], [w * 0.68, h + inset]);

  for (const [px, pz] of braziersAt) {
    const base = GROUND;
    const pillar = new THREE.Mesh(pillarGeo, stoneMat);
    pillar.position.set(px, base + 75, pz);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    group.add(pillar);

    const bowl = new THREE.Mesh(bowlGeo, metalMat);
    bowl.position.set(px, base + 158, pz);
    bowl.castShadow = true;
    group.add(bowl);

    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(px, base + 176, pz);
    group.add(flame);

    const light = new THREE.PointLight(0xffa445, 2.2, 1150, 1.8);
    light.position.set(px, base + 192, pz);
    group.add(light);
    braziers.push({ light, flame, phase: rand() * 10 });
  }

  // Banner poles on the top terrace, cloth hanging toward the floor.
  const poleGeo = track(new THREE.CylinderGeometry(5, 5, 260, 6));
  const clothGeo = track(new THREE.PlaneGeometry(62, 190, 1, 5));
  const clothMat = track(
    new THREE.MeshStandardMaterial({
      color: accentColor.clone().lerp(new THREE.Color('#0d1728'), 0.72),
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
      emissive: accentColor.clone().multiplyScalar(0.12),
    }),
  );
  const banners: THREE.Mesh[] = [];
  const bannerAt: Array<[number, number]> = [];
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4;
    bannerAt.push([w * t, -TERRACE_OUT - 172]);
    bannerAt.push([w * t, h + TERRACE_OUT + 172]);
  }
  for (let i = 0; i < 3; i++) {
    const t = (i + 0.5) / 3;
    bannerAt.push([-TERRACE_OUT - 172, h * t]);
    bannerAt.push([w + TERRACE_OUT + 172, h * t]);
  }
  for (const [px, pz] of bannerAt) {
    const pole = new THREE.Mesh(poleGeo, metalMat);
    pole.position.set(px, GROUND + 130, pz);
    pole.castShadow = true;
    group.add(pole);
    const cloth = new THREE.Mesh(clothGeo, clothMat);
    // Cloth hangs from the top of the pole, facing the arena floor.
    const facingZ = Math.abs(pz - h / 2) > Math.abs(px - w / 2) * (h / w);
    cloth.position.set(px + (facingZ ? 0 : (px < w / 2 ? 7 : -7)), GROUND + 178, pz + (facingZ ? (pz < h / 2 ? 7 : -7) : 0));
    cloth.rotation.y = facingZ ? 0 : Math.PI / 2;
    cloth.castShadow = true;
    group.add(cloth);
    banners.push(cloth);
  }

  // Drifting motes over the playfield: depth cues for almost nothing.
  const MOTES = 280;
  const moteGeo = track(new THREE.BufferGeometry());
  const mpos = new Float32Array(MOTES * 3);
  const mseed = new Float32Array(MOTES);
  for (let i = 0; i < MOTES; i++) {
    mpos[i * 3] = -KERB + rand() * (w + KERB * 2);
    mpos[i * 3 + 1] = 20 + rand() * 380;
    mpos[i * 3 + 2] = -KERB + rand() * (h + KERB * 2);
    mseed[i] = rand() * 100;
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(mpos, 3));
  moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(mseed, 1));
  const moteMat = track(
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: accentColor.clone().lerp(new THREE.Color('#ffe6b0'), 0.5) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float aSeed;
        uniform float uTime;
        varying float vFade;
        void main() {
          vec3 p = position;
          p.y += sin( uTime * 0.35 + aSeed ) * 28.0;
          p.x += sin( uTime * 0.22 + aSeed * 1.7 ) * 36.0;
          p.z += cos( uTime * 0.19 + aSeed * 2.3 ) * 36.0;
          vec4 mv = modelViewMatrix * vec4( p, 1.0 );
          vFade = 0.35 + 0.65 * ( 0.5 + 0.5 * sin( uTime * 0.9 + aSeed * 3.1 ) );
          gl_PointSize = ( 3.0 + 3.0 * vFade ) * ( 900.0 / -mv.z );
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vFade;
        void main() {
          float d = length( gl_PointCoord - 0.5 );
          if ( d > 0.5 ) discard;
          float a = smoothstep( 0.5, 0.0, d );
          gl_FragColor = vec4( uColor, a * a * vFade * 0.5 );
        }`,
    }),
  );
  group.add(new THREE.Points(moteGeo, moteMat));

  return {
    group,
    floor,
    update(t: number) {
      (moteMat.uniforms.uTime as { value: number }).value = t;
      for (const b of braziers) {
        const f = 0.78 + Math.sin(t * 9.1 + b.phase) * 0.11 + Math.sin(t * 21.7 + b.phase * 2.3) * 0.07;
        b.light.intensity = 1.8 + f * 1.5;
        b.flame.scale.set(0.82 + f * 0.3, 1.05 + f * 0.45, 0.82 + f * 0.3);
      }
      for (let i = 0; i < banners.length; i++) {
        banners[i].rotation.z = Math.sin(t * 1.1 + i * 1.7) * 0.035;
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
      boulders.dispose();
      grass.dispose();
    },
  };
};

/** Ground height at a world point. Zero everywhere gameplay can reach. */
export const arenaHeightAt = (x: number, z: number, w: number, h: number, seed = 7): number => {
  const d = rectDist(x, z, w, h);
  if (d < TERRACE_OUT + 8) return 0;
  return terrainHeight(d, x, z, seed).y;
};

export const ARENA_MARGIN = TERRACE_OUT;
