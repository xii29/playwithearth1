import * as THREE from 'three'

// Continuous 3D fields wrap the entire sphere without texture seams or repeated tiles.
const fract = (x: number) => x - Math.floor(x)
const hash = (x: number, y: number, z: number) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453)
const smooth = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
export const VILLAGE_CLEARING = new THREE.Vector3(.55, .58, -.6).normalize()
export const VILLAGE_HOLE = new THREE.Vector3(.15, .58, -.82).normalize()
const reserved = (n: THREE.Vector3) => n.distanceTo(VILLAGE_CLEARING) < .41 || n.distanceTo(VILLAGE_HOLE) < .14
function noise(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const fx = smooth(0, 1, x - ix), fy = smooth(0, 1, y - iy), fz = smooth(0, 1, z - iz)
  const mix = THREE.MathUtils.lerp
  return mix(mix(mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), fx), mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), fx), fy), mix(mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), fx), mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), fx), fy), fz)
}
export function gardenSample(n: THREE.Vector3) {
  const { x, y, z } = n
  const bend = noise(x * 3 + 9, y * 3 - 5, z * 3 + 2) - .5
  const river = Math.min(
    Math.abs(x * .68 + y * .37 + z * .63 + bend * .55 - .13),
    Math.abs(x * -.33 + y * .87 + z * .36 + (noise(x * 4 - 4, y * 4, z * 4 + 7) - .5) * .35 + .27),
  )
  const biome = noise(x * 2.3 + 18, y * 2.3 + 3, z * 2.3 - 2)
  const hills = noise(x * 5 + 4, y * 5 + 3, z * 5)
  let bank = smooth(.023, .065, river)
  let radius = 2.955 + bank * (.205 + hills * .16) + smooth(.73, .93, biome) * .12 * bank
  const clearing = 1 - smooth(.36, .46, n.distanceTo(VILLAGE_CLEARING))
  const holeLand = 1 - smooth(.1, .2, n.distanceTo(VILLAGE_HOLE))
  const reserve = Math.max(clearing, holeLand)
  bank = THREE.MathUtils.lerp(bank, 1, reserve)
  radius = THREE.MathUtils.lerp(radius, 3.28, reserve)
  radius -= (1 - smooth(.035, .085, n.distanceTo(VILLAGE_HOLE))) * .22
  return { radius, river, biome, hills, bank }
}

function grain(material: THREE.MeshStandardMaterial, bark = false) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vGardenPoint;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vGardenPoint = position;')
    shader.fragmentShader = 'varying vec3 vGardenPoint;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float fleck = fract(sin(dot(floor(vGardenPoint * ${bark ? 'vec3(52., 5., 52.)' : 'vec3(240.)'}), vec3(12.9898,78.233,45.164))) * 43758.5453);
      diffuseColor.rgb *= .91 + fleck * .15;
    `)
  }
  material.customProgramCacheKey = () => bark ? 'garden-bark' : 'garden-grass'
}

export function createEarthGarden(scene: THREE.Scene) {
  let seed = 91374
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296 }
  const normal = () => { const y = random() * 2 - 1, a = random() * Math.PI * 2, r = Math.sqrt(1 - y * y); return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r) }
  const group = new THREE.Group(); group.name = 'Spherical woodland garden'; scene.add(group)
  const terrainGeometry = new THREE.SphereGeometry(1, 256, 160)
  const positions = terrainGeometry.getAttribute('position')
  const colors = new Float32Array(positions.count * 3)
  const point = new THREE.Vector3(), color = new THREE.Color()
  const grassDark = new THREE.Color('#315d78'), grassLight = new THREE.Color('#83bdc9')
  const soilDark = new THREE.Color('#5c507c'), soilLight = new THREE.Color('#b0a1cf')
  const trailColor = new THREE.Color('#b9afd7')
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).normalize()
    const sample = gardenSample(point)
    const variation = noise(point.x * 29, point.y * 29, point.z * 29)
    if (sample.bank < .91) color.copy(soilDark).lerp(soilLight, .3 + sample.bank * .5 + variation * .2)
    else {
      color.copy(grassDark).lerp(grassLight, sample.hills * .45 + sample.biome * .35 + variation * .2)
      const trail = Math.abs(noise(point.x * 6 + 81, point.y * 6, point.z * 6) - .5)
      if (trail < .018 && sample.biome < .56) color.lerp(trailColor, (1 - trail / .018) * .7)
      if (point.distanceTo(VILLAGE_CLEARING) < .36) color.lerp(trailColor, .75)
    }
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b
    point.multiplyScalar(sample.radius); positions.setXYZ(i, point.x, point.y, point.z)
  }
  terrainGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); terrainGeometry.computeVertexNormals()
  const groundMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .96 })
  grain(groundMaterial)
  const ground = new THREE.Mesh(terrainGeometry, groundMaterial); ground.receiveShadow = true; group.add(ground)

  const waterMaterial = new THREE.MeshStandardMaterial({ color: '#5867ca', emissive: '#33457a', emissiveIntensity: .25, roughness: .27, metalness: .2 })
  const waterTime = { value: 0 }
  waterMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.gardenTime = waterTime
    shader.vertexShader = 'varying vec3 vWaterPoint;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWaterPoint = position;')
    shader.fragmentShader = 'varying vec3 vWaterPoint; uniform float gardenTime;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float wave = sin(vWaterPoint.x*45. + vWaterPoint.z*21. + gardenTime*.8) * sin(vWaterPoint.y*39. - vWaterPoint.z*17. + gardenTime*.5);
      diffuseColor.rgb += vec3(.10,.15,.13) * smoothstep(.70,1.,wave);
    `)
  }
  const water = new THREE.Mesh(new THREE.SphereGeometry(3.02, 128, 80), waterMaterial); group.add(water)

  type Instance = { matrix: THREE.Matrix4; color: THREE.Color }
  const batches = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material; instances: Instance[] }>()
  const standard = (roughness = .85) => new THREE.MeshStandardMaterial({ color: 'white', roughness })
  const leafGeometry = new THREE.SphereGeometry(1, 7, 5)
  const leafPositions = leafGeometry.getAttribute('position')
  for (let i = 0; i < leafPositions.count; i++) {
    const y = leafPositions.getY(i)
    const taper = .55 + (1 - Math.abs(y)) * .45
    leafPositions.setX(i, leafPositions.getX(i) * taper)
  }
  leafGeometry.computeVertexNormals()
  const barkMaterial = standard(); grain(barkMaterial, true)
  batches.set('trunk', { geometry: new THREE.CylinderGeometry(.68, 1, 1, 9, 2), material: barkMaterial, instances: [] })
  batches.set('crown', { geometry: new THREE.IcosahedronGeometry(1, 2), material: standard(), instances: [] })
  batches.set('leaf', { geometry: leafGeometry, material: standard(), instances: [] })
  batches.set('pine', { geometry: new THREE.ConeGeometry(1, 1, 13, 1), material: standard(), instances: [] })
  batches.set('stem', { geometry: new THREE.CylinderGeometry(1, 1, 1, 5), material: standard(), instances: [] })
  batches.set('petal', { geometry: new THREE.SphereGeometry(1, 7, 5), material: standard(), instances: [] })
  batches.set('rock', { geometry: new THREE.IcosahedronGeometry(1, 1), material: standard(), instances: [] })
  batches.set('cap', { geometry: new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), material: standard(), instances: [] })
  batches.set('shade', { geometry: new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), material: new THREE.MeshBasicMaterial({ color: '#34552d', transparent: true, opacity: .15, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }), instances: [] })
  const transform = new THREE.Object3D(), frame = new THREE.Matrix4(), rotation = new THREE.Quaternion()
  const spaceTint = new THREE.Color('#879ad6')
  const localY = new THREE.Vector3(0, 1, 0), origin = new THREE.Vector3()
  const yawRotation = new THREE.Quaternion(), unitScale = new THREE.Vector3(1, 1, 1)
  const setFrame = (n: THREE.Vector3, yaw: number, radius: number) => {
    rotation.setFromUnitVectors(localY, n)
    rotation.multiply(yawRotation.setFromAxisAngle(localY, yaw))
    frame.compose(origin.copy(n).multiplyScalar(radius), rotation, unitScale)
  }
  const add = (name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, tint: THREE.ColorRepresentation, rx = 0, ry = 0, rz = 0) => {
    transform.position.set(x, y, z); transform.scale.set(sx, sy, sz); transform.rotation.set(rx, ry, rz); transform.updateMatrix()
    batches.get(name)!.instances.push({ matrix: new THREE.Matrix4().multiplyMatrices(frame, transform.matrix), color: new THREE.Color(tint).lerp(spaceTint, .36) })
  }
  const trees: { normal: THREE.Vector3; clearance: number }[] = []
  const leafColors = ['#477e98', '#73a7ae', '#b4a4d9', '#58779f', '#9bbed0']
  for (let attempt = 0; attempt < 2800 && trees.length < 155; attempt++) {
    const n = normal(), sample = gardenSample(n)
    if (reserved(n) || sample.bank < .99 || sample.biome < .3 || (sample.biome < .46 && random() < .75)) continue
    if (trees.some((tree) => tree.normal.distanceToSquared(n) < .006)) continue
    const scale = .8 + random() * .65, tall = .38 * scale
    trees.push({ normal: n, clearance: .06 * scale })
    setFrame(n, random() * Math.PI * 2, sample.radius)
    add('shade', 0, .007, 0, .19 * scale, 1, .17 * scale, 'white')
    add('trunk', 0, tall * .43, 0, .035 * scale, tall * .86, .035 * scale, '#a67a43')
    for (let r = 0; r < 4; r++) {
      const a = r * Math.PI / 2
      add('rock', Math.sin(a) * .028 * scale, .016, Math.cos(a) * .028 * scale, .024 * scale, .026, .052 * scale, '#a67a43', 0, a)
    }
    const pine = sample.biome > .6 || (n.y < -.35 && random() > .4)
    if (pine) {
      for (let layer = 0; layer < 4; layer++) {
        const w = (.19 - layer * .035) * scale, h = (.2 - layer * .022) * scale, y = tall * .6 + layer * .077 * scale
        add('pine', 0, y, 0, w, h, w, ['#397f57', '#48955b', '#59a25c', '#75b56a'][layer])
        for (let l = 0; l < 10; l++) {
          const a = l / 10 * Math.PI * 2 + layer * .25
          add('leaf', Math.cos(a) * w * .67, y - h * .24, Math.sin(a) * w * .67, w * .31, h * .47, w * .18, '#509957', .4 * Math.sin(a), -a, -.4 * Math.cos(a))
        }
      }
    } else {
      const blossom = sample.biome < .43 && n.z > .1
      const shade = blossom ? '#e7b7c3' : leafColors[Math.floor(random() * leafColors.length)]
      for (let c = 0; c < 7; c++) {
        const a = c * 2.399, r = c === 0 ? 0 : .09 * scale
        const cx = Math.cos(a) * r, cz = Math.sin(a) * r, cy = tall + (c === 0 ? .12 : random() * .085) * scale
        add('crown', cx, cy, cz, .115 * scale, .125 * scale, .115 * scale, shade)
        for (let l = 0; l < 8; l++) {
          const angle = l * 2.399 + c, ly = (random() - .4) * .12 * scale
          add('leaf', cx + Math.cos(angle) * .096 * scale, cy + ly, cz + Math.sin(angle) * .096 * scale, .038 * scale, .067 * scale, .016 * scale, blossom ? '#f3cdd6' : leafColors[(l + c) % leafColors.length], .6 * Math.sin(angle), -angle, -.6 * Math.cos(angle))
        }
      }
    }
  }
  const flowerColors = ['#fff1c8', '#fff9e9', '#efd071', '#c3a8e5', '#efadbb', '#ee946e']
  let flowerCount = 0, grassCount = 0
  for (let i = 0; i < 5400; i++) {
    const n = normal(), sample = gardenSample(n)
    if (reserved(n) || sample.bank < .98) continue
    setFrame(n, random() * Math.PI * 2, sample.radius)
    const patch = noise(n.x * 9 + 21, n.y * 9, n.z * 9)
    if (patch > .56 && flowerCount < 760) {
      flowerCount++
      const h = .055 + random() * .055
      const tint = flowerColors[Math.min(5, Math.floor(sample.biome * 9))]
      add('stem', 0, h / 2, 0, .005, h, .005, '#48883e')
      add('leaf', -.017, h * .4, 0, .011, .026, .005, '#579d42', 0, 0, -.9)
      add('leaf', .017, h * .5, 0, .011, .024, .005, '#7ab74d', 0, 0, .9)
      for (let petal = 0; petal < 5; petal++) {
        const a = petal / 5 * Math.PI * 2
        add('petal', Math.cos(a) * .019, h, Math.sin(a) * .019, .023, .011, .014, tint, 0, -a)
      }
      add('petal', 0, h + .006, 0, .012, .009, .012, '#e4b847')
    } else if (grassCount < 1800) {
      grassCount++
      for (let blade = 0; blade < 3; blade++) add('leaf', (blade - 1) * .012, .025 + random() * .012, 0, .007, .036 + random() * .015, .003, blade % 2 ? '#8ac653' : '#64a745', .2, blade, (blade - 1) * -.4)
    }
  }
  for (let i = 0; i < 340; i++) {
    const n = normal(), sample = gardenSample(n)
    if (reserved(n) || sample.bank < .96) continue
    setFrame(n, random() * Math.PI * 2, sample.radius)
    if (i % 3 === 0) {
      const s = .03 + random() * .055
      add('rock', 0, s * .35, 0, s, s * .75, s * .85, ['#a6ad93', '#b8bba3', '#969e8c'][i % 3], .1, random() * 3)
    } else if (sample.biome > .48) {
      for (let m = 0; m < 3; m++) {
        const x = (random() - .5) * .09, z = (random() - .5) * .09, h = .025 + random() * .035
        add('stem', x, h / 2, z, .008, h, .008, '#f2ddba')
        add('cap', x, h, z, .025, .016, .025, i % 2 ? '#cd8259' : '#d7b78b')
      }
    }
  }
  const visibilityBatches: { mesh: THREE.InstancedMesh; matrices: Float32Array; colors: Float32Array; bounds: Float64Array }[] = []
  batches.forEach(({ geometry, material, instances }, name) => {
    if (!instances.length) { geometry.dispose(); material.dispose(); return }
    const mesh = new THREE.InstancedMesh(geometry, material, instances.length)
    mesh.name = `Garden ${name}`
    instances.forEach((instance, i) => { mesh.setMatrixAt(i, instance.matrix); mesh.setColorAt(i, instance.color) })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere(); group.add(mesh)
    geometry.computeBoundingSphere()
    const bounds = new Float64Array(instances.length * 4)
    const sphere = new THREE.Sphere()
    instances.forEach((instance, i) => {
      sphere.copy(geometry.boundingSphere!).applyMatrix4(instance.matrix)
      bounds[i * 4] = sphere.center.x; bounds[i * 4 + 1] = sphere.center.y; bounds[i * 4 + 2] = sphere.center.z
      bounds[i * 4 + 3] = sphere.radius + .0001
    })
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage)
    visibilityBatches.push({ mesh, matrices: (mesh.instanceMatrix.array as Float32Array).slice(), colors: (mesh.instanceColor!.array as Float32Array).slice(), bounds })
  })
  // Every point of the terrain lies outside this solid core. Cull only bounding
  // spheres wholly inside its shadow cone AND behind the planet's centre.
  // The conservative margin preserves trees and leaves on the visible horizon.
  const lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity)
  const updateVisibility = (camera: THREE.Vector3) => {
    if (lastCamera.equals(camera)) return
    lastCamera.copy(camera)
    const distance = camera.length(), core = 2.94
    if (distance <= core) return
    const nx = camera.x / distance, ny = camera.y / distance, nz = camera.z / distance
    const slope = core / Math.sqrt(distance * distance - core * core)
    visibilityBatches.forEach(({ mesh, matrices, colors: originalColors, bounds }) => {
      const targetMatrices = mesh.instanceMatrix.array, targetColors = mesh.instanceColor!.array
      let visible = 0
      for (let i = 0; i < bounds.length / 4; i++) {
        const x = bounds[i * 4], y = bounds[i * 4 + 1], z = bounds[i * 4 + 2], radius = bounds[i * 4 + 3]
        const along = x * nx + y * ny + z * nz
        if (along + radius < 0) {
          const perpendicular = Math.sqrt(Math.max(0, x * x + y * y + z * z - along * along))
          if (perpendicular + radius < (distance - along - radius) * slope) continue
        }
        for (let k = 0; k < 16; k++) targetMatrices[visible * 16 + k] = matrices[i * 16 + k]
        for (let k = 0; k < 3; k++) targetColors[visible * 3 + k] = originalColors[i * 3 + k]
        visible++
      }
      mesh.count = visible
      mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceColor!.clearUpdateRanges()
      if (visible) {
        mesh.instanceMatrix.addUpdateRange(0, visible * 16)
        mesh.instanceColor!.addUpdateRange(0, visible * 3)
        mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true
      }
    })
  }
  group.updateMatrixWorld(true)
  group.traverse((object) => { object.matrixAutoUpdate = false; object.matrixWorldAutoUpdate = false })
  return {
    radiusAt: (n: THREE.Vector3) => gardenSample(n).radius,
    ground,
    walkable: (n: THREE.Vector3) => n.distanceTo(VILLAGE_HOLE) > .1 && gardenSample(n).bank > .98 && !trees.some((tree) => tree.normal.distanceToSquared(n) < tree.clearance ** 2),
    stepRadius: (n: THREE.Vector3) => {
      const sample = gardenSample(n)
      return n.distanceTo(VILLAGE_HOLE) > .1 && sample.bank > .98 && !trees.some((tree) => tree.normal.distanceToSquared(n) < tree.clearance ** 2) ? sample.radius : null
    },
    update: (time: number, camera?: THREE.Vector3) => {
      waterTime.value = time
      if (camera) updateVisibility(camera)
    },
    boundsRadius: 4.2,
  }
}
