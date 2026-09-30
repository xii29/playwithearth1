import * as THREE from 'three'

type MachineState = 'idle' | 'lowering' | 'closing' | 'lifting' | 'moving' | 'releasing' | 'returning'
type Direction = 'front' | 'back' | 'left' | 'right'

type Toy = {
  group: THREE.Group
  label: string
  radius: number
  halfHeight: number
  floorOffset: number
  state: 'pile' | 'held' | 'falling' | 'showcase' | 'won'
  velocity: THREE.Vector3
  angularVelocity: THREE.Vector3
  fallingIntoExit: boolean
  showcaseTime: number
}

const HIGH_Y = 7.85
const LOW_Y = 4.18
const EXIT_X = 0
const EXIT_Z = 2.15
const HOME_X = 0
const HOME_Z = -0.35
// Exact top surface of the prize bed.
const FLOOR_Y = 2.37

const easeInOut = (value: number) => value * value * (3 - 2 * value)
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))
const randomBetween = (minimum: number, maximum: number) => minimum + Math.random() * (maximum - minimum)

function enableShadows(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true
      child.receiveShadow = true
    }
  })
}

function createSoftMaterial(color: THREE.ColorRepresentation) {
  const sheenColor = new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.38)
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.94,
    metalness: 0,
    sheen: 0.72,
    sheenColor,
    sheenRoughness: 0.92,
  })
}

function addPart(
  parent: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
) {
  const part = new THREE.Mesh(geometry, material)
  part.position.set(...position)
  part.scale.set(...scale)
  parent.add(part)
  return part
}

function addConnectedLimb(
  parent: THREE.Group,
  material: THREE.Material,
  start: [number, number, number],
  end: [number, number, number],
  radius: number,
  _endScale?: [number, number, number],
) {
  const startPoint = new THREE.Vector3(...start)
  const endPoint = new THREE.Vector3(...end)
  const direction = endPoint.clone().sub(startPoint)
  const distance = direction.length()
  const limb = new THREE.Mesh(
    // Extend the capsule deeply through its anchors. The hidden overlap makes
    // arms and legs read as stuffed continuations of the torso, not ball joints.
    new THREE.CapsuleGeometry(radius, Math.max(0.01, distance - radius * 0.2), 14, 28),
    material,
  )
  limb.position.copy(startPoint).add(endPoint).multiplyScalar(0.5)
  limb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
  parent.add(limb)

  return limb
}

function addStitchedMouth(parent: THREE.Group, material: THREE.Material, y: number, z: number) {
  const stitch = (curve: THREE.Curve<THREE.Vector3>) => {
    const thread = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.008, 7, false), material)
    parent.add(thread)
  }
  const surfaceZ = z - 0.018
  stitch(new THREE.LineCurve3(
    new THREE.Vector3(0, y + 0.055, surfaceZ),
    new THREE.Vector3(0, y, surfaceZ),
  ))
  stitch(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, y, surfaceZ),
    new THREE.Vector3(-0.038, y - 0.035, surfaceZ),
    new THREE.Vector3(-0.078, y - 0.003, surfaceZ),
  ))
  stitch(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, y, surfaceZ),
    new THREE.Vector3(0.038, y - 0.035, surfaceZ),
    new THREE.Vector3(0.078, y - 0.003, surfaceZ),
  ))
}

type PlushBase = {
  group: THREE.Group
  sphere: THREE.SphereGeometry
  body: THREE.MeshPhysicalMaterial
  belly: THREE.MeshPhysicalMaterial
  limb: THREE.MeshPhysicalMaterial
  dark: THREE.MeshPhysicalMaterial
}

function createPlushBase(bodyColor: THREE.ColorRepresentation, bellyColor: THREE.ColorRepresentation, limbColor = bodyColor): PlushBase {
  const group = new THREE.Group()
  const sphere = new THREE.SphereGeometry(0.5, 32, 24)
  const body = createSoftMaterial(bodyColor)
  const belly = createSoftMaterial(bellyColor)
  const limb = createSoftMaterial(limbColor)
  const dark = createSoftMaterial('#2e2930')

  // Compact pear-shaped body and oversized head match the supplied toy reference.
  addPart(group, sphere, body, [0, 0.7, 0], [0.78, 0.98, 0.64])
  // No separate neck mesh: the head sinks directly into the upper torso.
  addPart(group, sphere, body, [0, 1.34, 0.015], [0.82, 0.74, 0.68])
  addPart(group, sphere, belly, [0, 0.7, 0.305], [0.37, 0.54, 0.1])

  addConnectedLimb(group, limb, [-0.22, 0.86, 0], [-0.57, 0.81, 0.035], 0.12, [1.05, 0.94, 1])
  addConnectedLimb(group, limb, [0.22, 0.86, 0], [0.57, 0.81, 0.035], 0.12, [1.05, 0.94, 1])
  addConnectedLimb(group, limb, [-0.15, 0.44, 0.015], [-0.24, 0.12, 0.1], 0.14, [1.25, 0.72, 1.25])
  addConnectedLimb(group, limb, [0.15, 0.44, 0.015], [0.24, 0.12, 0.1], 0.14, [1.25, 0.72, 1.25])
  return { group, sphere, body, belly, limb, dark }
}

function addPlushFace(base: PlushBase, muzzle: THREE.Material, noseScale: [number, number, number] = [0.075, 0.07, 0.075]) {
  const { group, sphere, dark } = base
  addPart(group, sphere, muzzle, [0, 1.2, 0.285], [0.33, 0.24, 0.23])
  addPart(group, sphere, dark, [-0.21, 1.4, 0.31], [0.052, 0.07, 0.075])
  addPart(group, sphere, dark, [0.21, 1.4, 0.31], [0.052, 0.07, 0.075])
  addPart(group, sphere, dark, [0, 1.23, 0.385], noseScale)
  addStitchedMouth(group, dark, 1.12, 0.372)
}

function addPointEars(base: PlushBase, outer: THREE.Material, inner: THREE.Material) {
  // Soft oval drops replace the rigid triangular prisms. Their lower halves
  // are buried in the head so the silhouette stays continuous from every side.
  const leftEar = addPart(base.group, base.sphere, outer, [-0.31, 1.64, -0.015], [0.3, 0.44, 0.25])
  const rightEar = addPart(base.group, base.sphere, outer, [0.31, 1.64, -0.015], [0.3, 0.44, 0.25])
  leftEar.rotation.z = -0.18
  rightEar.rotation.z = 0.18

  const leftInner = addPart(base.group, base.sphere, inner, [-0.315, 1.65, 0.095], [0.16, 0.27, 0.07])
  const rightInner = addPart(base.group, base.sphere, inner, [0.315, 1.65, 0.095], [0.16, 0.27, 0.07])
  leftInner.rotation.z = -0.18
  rightInner.rotation.z = 0.18
}

function addRoundEars(base: PlushBase, outer: THREE.Material, inner?: THREE.Material, scale = 0.28) {
  addPart(base.group, base.sphere, outer, [-0.35, 1.59, -0.01], [scale, scale, scale * 0.78])
  addPart(base.group, base.sphere, outer, [0.35, 1.59, -0.01], [scale, scale, scale * 0.78])
  if (inner) {
    addPart(base.group, base.sphere, inner, [-0.37, 1.59, 0.095], [scale * 0.56, scale * 0.56, scale * 0.28])
    addPart(base.group, base.sphere, inner, [0.37, 1.59, 0.095], [scale * 0.56, scale * 0.56, scale * 0.28])
  }
}

function addStubTail(base: PlushBase, material: THREE.Material, x = 0, y = 0.7, size = 0.13) {
  addPart(base.group, base.sphere, material, [x, y, -0.3], [size, size, size * 0.78])
}

function addCurvedTail(base: PlushBase, material: THREE.Material, radius = 0.085, tipMaterial?: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.24, 0.68, -0.2),
    new THREE.Vector3(0.5, 0.67, -0.34),
    new THREE.Vector3(0.66, 0.85, -0.36),
    new THREE.Vector3(0.55, 1.02, -0.31),
  ])
  const tail = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, radius, 12, false), material)
  base.group.add(tail)
  addPart(base.group, base.sphere, tipMaterial ?? material, [0.55, 1.02, -0.31], [radius * 2.4, radius * 2.1, radius * 2.2])
}

function finishPlush(base: PlushBase) {
  enableShadows(base.group)
  return base.group
}

function createPanda(_color: THREE.ColorRepresentation, _accent: THREE.ColorRepresentation) {
  const base = createPlushBase('#f5f1e9', '#ffffff', '#29272d')
  addRoundEars(base, base.dark, undefined, 0.29)
  addPart(base.group, base.sphere, base.dark, [-0.21, 1.43, 0.305], [0.17, 0.2, 0.075]).rotation.z = -0.2
  addPart(base.group, base.sphere, base.dark, [0.21, 1.43, 0.305], [0.17, 0.2, 0.075]).rotation.z = 0.2
  addPlushFace(base, base.belly, [0.078, 0.078, 0.078])
  addStubTail(base, base.belly)
  return finishPlush(base)
}

function createCat(color: THREE.ColorRepresentation, accent: THREE.ColorRepresentation) {
  const base = createPlushBase(color, accent)
  addPointEars(base, base.body, base.belly)
  addPlushFace(base, base.belly)
  addCurvedTail(base, base.body)
  return finishPlush(base)
}

function createKoala(color: THREE.ColorRepresentation, accent: THREE.ColorRepresentation) {
  const gray = new THREE.Color(color).lerp(new THREE.Color('#aaa9af'), 0.72)
  const base = createPlushBase(gray, accent)
  addRoundEars(base, base.body, base.belly, 0.36)
  addPlushFace(base, base.belly, [0.12, 0.16, 0.1])
  addStubTail(base, base.body, 0, 0.68, 0.11)
  return finishPlush(base)
}

function createLeopard(_color: THREE.ColorRepresentation, _accent: THREE.ColorRepresentation) {
  const base = createPlushBase('#e99a42', '#f6dbad')
  addPointEars(base, base.body, base.belly)
  addPlushFace(base, base.belly)
  addCurvedTail(base, base.body, 0.075, base.dark)
  const spotPositions: [number, number, number][] = [
    [-0.24, 1.58, 0.3], [0.27, 1.53, 0.31], [0, 1.67, 0.32],
    [-0.2, 0.86, 0.3], [0.23, 0.69, 0.31], [-0.12, 0.49, 0.28],
    [-0.24, 1.51, -0.3], [0.26, 1.38, -0.31], [0, 0.78, -0.3],
  ]
  spotPositions.forEach((position, index) => {
    const spot = addPart(base.group, base.sphere, base.dark, position, [0.065, 0.05, 0.025])
    spot.rotation.z = index * 0.64
  })
  return finishPlush(base)
}

function createElephant(_color: THREE.ColorRepresentation, _accent: THREE.ColorRepresentation) {
  const base = createPlushBase('#e7a9d4', '#f4c8df')
  addPart(base.group, base.sphere, base.body, [-0.36, 1.39, -0.03], [0.4, 0.49, 0.18])
  addPart(base.group, base.sphere, base.body, [0.36, 1.39, -0.03], [0.4, 0.49, 0.18])
  addPart(base.group, base.sphere, base.belly, [-0.38, 1.39, 0.075], [0.25, 0.34, 0.08])
  addPart(base.group, base.sphere, base.belly, [0.38, 1.39, 0.075], [0.25, 0.34, 0.08])
  addPart(base.group, base.sphere, base.dark, [-0.2, 1.46, 0.33], [0.05, 0.067, 0.055])
  addPart(base.group, base.sphere, base.dark, [0.2, 1.46, 0.33], [0.05, 0.067, 0.055])
  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.3, 0.28), new THREE.Vector3(0, 1.14, 0.43),
    new THREE.Vector3(-0.02, 0.97, 0.46), new THREE.Vector3(0.1, 0.87, 0.42),
  ])
  base.group.add(new THREE.Mesh(new THREE.TubeGeometry(trunkCurve, 24, 0.09, 14, false), base.body))
  addPart(base.group, base.sphere, base.body, [0.1, 0.87, 0.42], [0.19, 0.16, 0.18])
  addStubTail(base, base.body, 0.08, 0.68, 0.09)
  return finishPlush(base)
}

function createHippo(_color: THREE.ColorRepresentation, _accent: THREE.ColorRepresentation) {
  const base = createPlushBase('#625d6e', '#ae788c')
  addRoundEars(base, base.body, base.belly, 0.17)
  addPart(base.group, base.sphere, base.belly, [0, 1.21, 0.35], [0.4, 0.27, 0.23])
  addPart(base.group, base.sphere, base.dark, [-0.2, 1.46, 0.33], [0.052, 0.068, 0.055])
  addPart(base.group, base.sphere, base.dark, [0.2, 1.46, 0.33], [0.052, 0.068, 0.055])
  addPart(base.group, base.sphere, base.dark, [-0.13, 1.23, 0.455], [0.026, 0.022, 0.03])
  addPart(base.group, base.sphere, base.dark, [0.13, 1.23, 0.455], [0.026, 0.022, 0.03])
  addStitchedMouth(base.group, base.dark, 1.11, 0.43)
  addStubTail(base, base.body, 0, 0.69, 0.09)
  return finishPlush(base)
}

function createWhiteCat(_color: THREE.ColorRepresentation, _accent: THREE.ColorRepresentation) {
  return createCat('#f2f0eb', '#efafbf')
}

function createRedPanda(_color: THREE.ColorRepresentation, _accent: THREE.ColorRepresentation) {
  const base = createPlushBase('#dd6b2f', '#f4e3cf', '#653329')
  addPointEars(base, base.dark, base.belly)
  addPart(base.group, base.sphere, base.belly, [-0.22, 1.42, 0.31], [0.15, 0.2, 0.075])
  addPart(base.group, base.sphere, base.belly, [0.22, 1.42, 0.31], [0.15, 0.2, 0.075])
  addPlushFace(base, base.belly)
  addCurvedTail(base, base.body, 0.13, base.dark)
  return finishPlush(base)
}

function createHusky(_color: THREE.ColorRepresentation, _accent: THREE.ColorRepresentation) {
  const base = createPlushBase('#697486', '#f2f3f1')
  addPointEars(base, base.body, base.belly)
  addPart(base.group, base.sphere, base.belly, [0, 1.5, 0.3], [0.15, 0.3, 0.08])
  addPlushFace(base, base.belly)
  addCurvedTail(base, base.body, 0.105, base.belly)
  return finishPlush(base)
}

function createDeer(_color: THREE.ColorRepresentation, _accent: THREE.ColorRepresentation) {
  const base = createPlushBase('#9b5b34', '#e4bb7a')
  addRoundEars(base, base.body, base.belly, 0.2)
  addPlushFace(base, base.belly)
  const antlerMaterial = createSoftMaterial('#694129')
  addConnectedLimb(base.group, antlerMaterial, [-0.24, 1.67, -0.03], [-0.3, 1.99, -0.02], 0.04)
  addConnectedLimb(base.group, antlerMaterial, [0.24, 1.67, -0.03], [0.3, 1.99, -0.02], 0.04)
  addConnectedLimb(base.group, antlerMaterial, [-0.28, 1.89, -0.02], [-0.43, 2, -0.01], 0.035)
  addConnectedLimb(base.group, antlerMaterial, [0.28, 1.89, -0.02], [0.43, 2, -0.01], 0.035)
  addStubTail(base, base.belly, 0, 0.72, 0.12)
  return finishPlush(base)
}

function createSiamese(_color: THREE.ColorRepresentation, _accent: THREE.ColorRepresentation) {
  const base = createPlushBase('#eee0c9', '#f6ead8', '#5a433b')
  addPointEars(base, base.limb, base.dark)
  addPart(base.group, base.sphere, base.limb, [0, 1.36, 0.285], [0.34, 0.31, 0.1])
  addPlushFace(base, base.limb)
  addCurvedTail(base, base.limb, 0.085)
  return finishPlush(base)
}

function createPenguin(_color: THREE.ColorRepresentation, _accent: THREE.ColorRepresentation) {
  const base = createPlushBase('#252b35', '#f5f3ed')
  addPart(base.group, base.sphere, base.belly, [-0.14, 1.33, 0.305], [0.25, 0.32, 0.08])
  addPart(base.group, base.sphere, base.belly, [0.14, 1.33, 0.305], [0.25, 0.32, 0.08])
  addPart(base.group, base.sphere, base.dark, [-0.18, 1.45, 0.35], [0.05, 0.066, 0.055])
  addPart(base.group, base.sphere, base.dark, [0.18, 1.45, 0.35], [0.05, 0.066, 0.055])
  const orange = createSoftMaterial('#ed9138')
  const beak = addPart(base.group, new THREE.ConeGeometry(0.09, 0.2, 4), orange, [0, 1.27, 0.42])
  beak.rotation.x = Math.PI / 2
  addPart(base.group, base.sphere, orange, [-0.2, 0.1, 0.14], [0.2, 0.06, 0.18])
  addPart(base.group, base.sphere, orange, [0.2, 0.1, 0.14], [0.2, 0.06, 0.18])
  addStubTail(base, base.body, 0, 0.62, 0.1)
  return finishPlush(base)
}

function createRhino(_color: THREE.ColorRepresentation, _accent: THREE.ColorRepresentation) {
  const base = createPlushBase('#7d7b7c', '#aaa5a1')
  addRoundEars(base, base.body, base.belly, 0.17)
  addPlushFace(base, base.belly, [0.085, 0.065, 0.07])
  const hornMaterial = createSoftMaterial('#d8c99f')
  const horn = addPart(base.group, new THREE.ConeGeometry(0.085, 0.34, 16), hornMaterial, [0, 1.34, 0.49])
  horn.rotation.x = Math.PI / 2
  addStubTail(base, base.body, 0, 0.68, 0.085)
  return finishPlush(base)
}

function createSignTexture() {
  const signCanvas = document.createElement('canvas')
  signCanvas.width = 1024
  signCanvas.height = 256
  const context = signCanvas.getContext('2d')!
  const gradient = context.createLinearGradient(0, 0, signCanvas.width, 0)
  gradient.addColorStop(0, '#6fd6cf')
  gradient.addColorStop(0.48, '#8eb9ff')
  gradient.addColorStop(1, '#ff91ac')
  context.fillStyle = gradient
  context.fillRect(0, 0, signCanvas.width, signCanvas.height)
  context.fillStyle = '#fffdf8'
  context.font = '900 100px system-ui, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.shadowColor = 'rgba(255,255,255,.65)'
  context.shadowBlur = 22
  context.fillText('PLUSH PLANET', 512, 132)
  const texture = new THREE.CanvasTexture(signCanvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function setupClawMachine(
  canvas: HTMLCanvasElement,
  statusElement: HTMLElement,
  prizeCountElement: HTMLElement,
  controlsElement: HTMLElement,
  dropButton: HTMLButtonElement,
  prizeRevealElement: HTMLElement,
  prizeListButton: HTMLButtonElement,
  prizePanel: HTMLElement,
  prizeListElement: HTMLElement,
  prizePanelClose: HTMLButtonElement,
  prizeViewerLabel: HTMLElement,
) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#12101b')
  scene.fog = new THREE.Fog('#12101b', 15, 30)

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
  camera.position.set(0, 7.2, 18.5)
  camera.lookAt(0, 4.55, 0)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08

  const hemisphereLight = new THREE.HemisphereLight('#dce8ff', '#372638', 2.1)
  scene.add(hemisphereLight)

  const keyLight = new THREE.DirectionalLight('#fff1e8', 4.5)
  keyLight.position.set(6, 14, 10)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(2048, 2048)
  keyLight.shadow.camera.left = -8
  keyLight.shadow.camera.right = 8
  keyLight.shadow.camera.top = 10
  keyLight.shadow.camera.bottom = -3
  scene.add(keyLight)

  const pinkLight = new THREE.PointLight('#ff6f9e', 26, 14, 2)
  pinkLight.position.set(-4, 7.4, 3.4)
  scene.add(pinkLight)
  const blueLight = new THREE.PointLight('#7396ff', 22, 13, 2)
  blueLight.position.set(4, 7.5, -2)
  scene.add(blueLight)

  const worldFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: '#191522', roughness: 0.7, metalness: 0.1 }),
  )
  worldFloor.rotation.x = -Math.PI / 2
  worldFloor.position.y = -0.03
  worldFloor.receiveShadow = true
  scene.add(worldFloor)

  const displayRoot = new THREE.Group()
  scene.add(displayRoot)
  const machine = new THREE.Group()
  displayRoot.add(machine)

  const frameMaterial = new THREE.MeshPhysicalMaterial({
    color: '#78cfc9',
    roughness: 0.25,
    metalness: 0.18,
    clearcoat: 0.82,
    clearcoatRoughness: 0.16,
  })
  const cabinetMaterial = new THREE.MeshPhysicalMaterial({
    color: '#f7eee9', roughness: 0.38, metalness: 0.06, clearcoat: 0.55, clearcoatRoughness: 0.22,
  })
  const accentMaterial = new THREE.MeshPhysicalMaterial({
    color: '#ff8faa', roughness: 0.28, metalness: 0.08, clearcoat: 0.7, clearcoatRoughness: 0.18,
  })
  const trimMaterial = new THREE.MeshStandardMaterial({ color: '#fff7ed', roughness: 0.3, metalness: 0.2 })
  const insideMaterial = new THREE.MeshStandardMaterial({ color: '#d8ece9', roughness: 0.78, metalness: 0.04 })
  const darkMaterial = new THREE.MeshStandardMaterial({ color: '#24343d', roughness: 0.42, metalness: 0.28 })
  const ledMaterial = new THREE.MeshStandardMaterial({
    color: '#fff5d7', emissive: '#ffb9d0', emissiveIntensity: 2.1, roughness: 0.3,
  })
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: '#dbeeff', transparent: true, opacity: 0.13, roughness: 0.08,
    metalness: 0.08, transmission: 0.35, depthWrite: false, side: THREE.DoubleSide,
  })

  const addBox = (
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material,
    parent: THREE.Group = machine,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
    mesh.position.set(...position)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  addBox([8.8, 2.2, 6.7], [0, 1.1, 0], cabinetMaterial)
  addBox([8.18, 1.72, 0.18], [0, 1.15, 3.38], accentMaterial)
  addBox([7.72, 1.38, 0.12], [0, 1.15, 3.5], cabinetMaterial)
  addBox([8.1, 0.18, 6], [0, FLOOR_Y - 0.09, 0], insideMaterial)
  addBox([8.8, 0.66, 6.7], [0, 9.18, 0], accentMaterial)
  addBox([8.25, 0.15, 6.15], [0, 8.75, 0], trimMaterial)

  const postPositions: [number, number, number][] = [
    [-4.2, 5.7, -3.05], [4.2, 5.7, -3.05], [-4.2, 5.7, 3.05], [4.2, 5.7, 3.05],
  ]
  postPositions.forEach((position) => addBox([0.28, 6.9, 0.28], position, frameMaterial))
  postPositions.forEach(([x, y, z]) => addBox([0.075, 6.45, 0.075], [x + Math.sign(x) * 0.17, y, z + Math.sign(z) * 0.17], ledMaterial))
  addBox([8.15, 6.35, 0.08], [0, 5.55, -3], glassMaterial)
  addBox([0.08, 6.35, 5.8], [-4.05, 5.55, 0], glassMaterial)
  addBox([0.08, 6.35, 5.8], [4.05, 5.55, 0], glassMaterial)
  addBox([8.15, 4.7, 0.08], [0, 6.38, 3], glassMaterial)

  const signTexture = createSignTexture()
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(6.8, 1.7),
    new THREE.MeshBasicMaterial({ map: signTexture, toneMapped: false }),
  )
  sign.position.set(0, 9.19, 3.36)
  machine.add(sign)

  addBox([2.72, 1.18, 0.25], [0, 1.17, 3.55], frameMaterial)
  addBox([2.26, 0.77, 0.18], [0, 1.18, 3.7], new THREE.MeshStandardMaterial({ color: '#17232a', roughness: 0.9 }))
  addBox([2.98, 0.2, 0.88], [0, 0.47, 3.64], accentMaterial)
  addBox([2.15, 0.24, 0.82], [2.47, 2.12, 3.55], frameMaterial).rotation.x = -0.12
  const joystickStem = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.48, 16), darkMaterial)
  joystickStem.position.set(2.25, 2.39, 3.56)
  joystickStem.rotation.x = -0.12
  machine.add(joystickStem)
  addPart(machine, new THREE.SphereGeometry(0.17, 24, 18), accentMaterial, [2.25, 2.66, 3.59])
  addPart(machine, new THREE.CylinderGeometry(0.2, 0.2, 0.08, 24), ledMaterial, [2.75, 2.3, 3.72]).rotation.x = Math.PI / 2
  addBox([0.42, 0.62, 0.08], [-2.92, 1.25, 3.67], darkMaterial)
  addBox([0.23, 0.045, 0.05], [-2.92, 1.37, 3.73], ledMaterial)

  const railMaterial = new THREE.MeshStandardMaterial({ color: '#c8ccd8', roughness: 0.2, metalness: 0.88 })
  addBox([7.1, 0.11, 0.14], [0, 8.52, -1.95], railMaterial)
  addBox([7.1, 0.11, 0.14], [0, 8.52, 1.95], railMaterial)
  addBox([1.75, 0.035, 1.1], [0, FLOOR_Y + 0.02, EXIT_Z], darkMaterial)

  const toys: Toy[] = []
  const toyFactories = [
    createLeopard, createElephant, createHippo, createWhiteCat,
    createRedPanda, createKoala, createHusky, createDeer,
    createSiamese, createPenguin, createRhino, createPanda,
  ]
  const toyLabels = [
    '표범 인형', '코끼리 인형', '하마 인형', '흰고양이 인형',
    '레서판다 인형', '코알라 인형', '허스키 인형', '사슴 인형',
    '샴고양이 인형', '펭귄 인형', '코뿔소 인형', '판다 인형',
  ]
  const toyCenters = [1.08, 1.03, 1.05, 1.08, 1.08, 1.03, 1.08, 1.05, 1.08, 1.02, 1.03, 1.02]
  const toyFloorOffsets = [1.1, 1.06, 1.06, 1.1, 1.1, 1.05, 1.1, 1.07, 1.1, 1.04, 1.05, 1.04]
  const palettes: [THREE.ColorRepresentation, THREE.ColorRepresentation][] = [
    ['#f7b2c8', '#fff0f5'], ['#8fcde5', '#fff2a8'], ['#c8a9ef', '#ffd2e0'],
    ['#f4cc69', '#f28a71'], ['#95d5b2', '#fff1c4'], ['#f2a477', '#ffe5ca'],
    ['#aebef2', '#f6c0dc'], ['#e8e2d2', '#d9839f'],
  ]
  for (let index = 0; index < 72; index += 1) {
    const typeIndex = index % toyFactories.length
    const palette = palettes[index % palettes.length]
    const visual = toyFactories[typeIndex](...palette)
    const group = new THREE.Group()
    const scale = randomBetween(0.48, 0.62)
    const estimatedFloorOffset = toyFloorOffsets[typeIndex] * scale
    const pose = index % 7
    const rotationX = pose === 1 ? 0.72 : pose === 2 ? -0.58 : randomBetween(-0.2, 0.22)
    const rotationZ = pose === 3 ? 0.9 : pose === 4 ? -0.82 : randomBetween(-0.28, 0.28)

    visual.scale.setScalar(scale)
    visual.position.y = -toyCenters[typeIndex] * scale
    group.add(visual)
    group.position.set(
      randomBetween(-3.15, 3.15),
      FLOOR_Y + estimatedFloorOffset + 0.06 + Math.floor(index / 36) * 0.58 + randomBetween(0, 0.16),
      randomBetween(-2.05, 1.58),
    )
    group.rotation.set(rotationX, randomBetween(-Math.PI, Math.PI), rotationZ)
    machine.add(group)
    group.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(group)
    const boundsSize = bounds.getSize(new THREE.Vector3())
    const floorOffset = group.position.y - bounds.min.y
    // Collision dimensions come from the posed model rather than an oversized
    // invisible sphere. The slight reduction mimics soft plush compression.
    const radius = Math.max(boundsSize.x, boundsSize.z) * 0.43
    const halfHeight = boundsSize.y * 0.39
    toys.push({
      group,
      label: toyLabels[typeIndex],
      radius,
      halfHeight,
      floorOffset,
      state: 'pile',
      velocity: new THREE.Vector3(randomBetween(-0.15, 0.15), 0, randomBetween(-0.15, 0.15)),
      angularVelocity: new THREE.Vector3(
        randomBetween(-0.24, 0.24),
        randomBetween(-0.18, 0.18),
        randomBetween(-0.24, 0.24),
      ),
      fallingIntoExit: false,
      showcaseTime: 0,
    })
  }

  const clawRoot = new THREE.Group()
  machine.add(clawRoot)

  const carriage = addBox([0.88, 0.34, 0.82], [0, 8.42, 0], darkMaterial, clawRoot)
  const carriageCap = addBox([0.58, 0.22, 0.56], [0, 8.18, 0], frameMaterial, clawRoot)
  carriage.castShadow = carriageCap.castShadow = true

  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 10), darkMaterial)
  cable.castShadow = true
  clawRoot.add(cable)

  const clawHead = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.42, 20), railMaterial)
  clawHead.castShadow = true
  clawRoot.add(clawHead)

  const fingerRigs: Array<{
    direction: THREE.Group
    upper: THREE.Mesh
    lower: THREE.Mesh
    elbow: THREE.Mesh
    tip: THREE.Mesh
  }> = []
  for (let index = 0; index < 3; index += 1) {
    const direction = new THREE.Group()
    direction.rotation.y = (index / 3) * Math.PI * 2
    clawRoot.add(direction)

    const hinge = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 10), darkMaterial)
    hinge.position.x = 0.27
    direction.add(hinge)

    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.72, 12), railMaterial)
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 0.68, 12), railMaterial)
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), darkMaterial)
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), railMaterial)
    upper.castShadow = lower.castShadow = elbow.castShadow = tip.castShadow = true
    tip.scale.set(1.5, 0.72, 0.9)
    direction.add(upper, lower, elbow, tip)
    fingerRigs.push({ direction, upper, lower, elbow, tip })
  }

  let state: MachineState = 'idle'
  let stateTime = 0
  let clawX = HOME_X
  let clawZ = HOME_Z
  let clawY = HIGH_Y
  let fingerOpen = 1
  let moveStartX = HOME_X
  let moveStartZ = HOME_Z
  let grabbedToy: Toy | null = null
  let heldOffsetX = 0
  let heldOffsetZ = 0
  let unstableGrip = false
  let unstableDropPoint = 1
  let prizeReleased = false
  let prizeCount = 0
  let disposed = false
  let animationFrameId = 0
  let previousTime = performance.now()
  let isDragging = false
  let dragPointerX = 0
  let dragPointerY = 0
  let targetRotationX = 0
  let targetRotationY = 0
  let viewedToy: Toy | null = null
  const wonPrizes: Toy[] = []
  const heldDirections = new Set<Direction>()
  const directionButtons = Array.from(controlsElement.querySelectorAll<HTMLButtonElement>('[data-direction]'))
  const allControlButtons = Array.from(controlsElement.querySelectorAll<HTMLButtonElement>('button'))
  const prizeRevealName = prizeRevealElement.querySelector<HTMLElement>('strong')!

  const updateClawModel = () => {
    clawRoot.position.x = clawX
    clawRoot.position.z = clawZ
    cable.position.y = (8.42 + clawY) / 2
    cable.scale.y = Math.max(0.05, 8.42 - clawY)
    clawHead.position.y = clawY
    fingerRigs.forEach(({ direction, upper, lower, elbow, tip }) => {
      const hingeX = 0.27
      const upperLength = 0.72
      const lowerLength = 0.68
      const upperAngle = THREE.MathUtils.lerp(0.16, 0.65, fingerOpen)
      const lowerAngle = THREE.MathUtils.lerp(-0.72, 0.32, fingerOpen)
      const upperEndX = hingeX + Math.sin(upperAngle) * upperLength
      const upperEndY = -Math.cos(upperAngle) * upperLength
      const lowerEndX = upperEndX + Math.sin(lowerAngle) * lowerLength
      const lowerEndY = upperEndY - Math.cos(lowerAngle) * lowerLength

      direction.position.y = clawY - 0.2
      upper.position.set((hingeX + upperEndX) / 2, upperEndY / 2, 0)
      upper.rotation.z = upperAngle
      elbow.position.set(upperEndX, upperEndY, 0)
      lower.position.set((upperEndX + lowerEndX) / 2, (upperEndY + lowerEndY) / 2, 0)
      lower.rotation.z = lowerAngle
      tip.position.set(lowerEndX, lowerEndY, 0)
      tip.rotation.z = lowerAngle
    })

    if (grabbedToy) {
      grabbedToy.group.position.set(clawX + heldOffsetX, clawY - 1.32, clawZ + heldOffsetZ)
      grabbedToy.group.rotation.z = Math.sin(stateTime * 8) * (unstableGrip ? 0.16 : 0.045)
    }
  }

  const setStatus = (message: string) => {
    statusElement.textContent = message
  }

  const renderPrizeList = () => {
    if (!wonPrizes.length) {
      prizeListElement.innerHTML = '<p class="prize-list__empty">아직 뽑은 인형이 없어요.</p>'
      return
    }

    prizeListElement.innerHTML = wonPrizes.map((toy, index) => `
      <button type="button" data-prize-index="${index}">
        <span class="prize-list__number">${String(index + 1).padStart(2, '0')}</span>
        <strong>${toy.label}</strong>
        <span aria-hidden="true">3D 보기 →</span>
      </button>
    `).join('')
  }

  const stopViewingPrize = () => {
    if (viewedToy?.state === 'won') viewedToy.group.visible = false
    viewedToy = null
    prizeViewerLabel.hidden = true
  }

  const closePrizePanel = () => {
    prizePanel.hidden = true
    prizeListButton.setAttribute('aria-expanded', 'false')
    stopViewingPrize()
  }

  const togglePrizePanel = () => {
    if (!prizePanel.hidden) {
      closePrizePanel()
      return
    }
    renderPrizeList()
    prizePanel.hidden = false
    prizeListButton.setAttribute('aria-expanded', 'true')
  }

  const selectPrize = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-prize-index]')
    if (!button) return
    const toy = wonPrizes[Number(button.dataset.prizeIndex)]
    if (!toy) return

    stopViewingPrize()
    viewedToy = toy
    toy.group.visible = true
    toy.group.position.set(0, 4.55, 7.05)
    toy.group.rotation.set(0.08, -0.45, 0)
    toy.group.scale.setScalar(2.05)
    prizeViewerLabel.querySelector('strong')!.textContent = toy.label
    prizeViewerLabel.hidden = false
  }

  const setControlsLocked = (locked: boolean) => {
    controlsElement.classList.toggle('is-locked', locked)
    allControlButtons.forEach((button) => { button.disabled = locked })
    if (locked) {
      heldDirections.clear()
      directionButtons.forEach((button) => button.classList.remove('is-pressed'))
    }
  }

  const transition = (nextState: MachineState) => {
    state = nextState
    stateTime = 0
  }

  const attemptGrab = () => {
    const availableToys = toys.filter((toy) => toy.state === 'pile')
    let nearest: Toy | null = null
    let nearestDistance = Number.POSITIVE_INFINITY

    for (const toy of availableToys) {
      const distance = Math.hypot(toy.group.position.x - clawX, toy.group.position.z - clawZ)
      if (distance < nearestDistance) {
        nearest = toy
        nearestDistance = distance
      }
    }

    if (!nearest || nearestDistance > 1.08) {
      grabbedToy = null
      setStatus('아쉽게도 집게가 인형을 놓쳤어요')
      return
    }

    const grabChance = clamp(1.08 - nearestDistance * 0.42, 0.48, 0.94)
    if (Math.random() > grabChance) {
      grabbedToy = null
      setStatus('인형이 집게 사이로 빠졌어요')
      return
    }

    grabbedToy = nearest
    grabbedToy.state = 'held'
    grabbedToy.velocity.set(0, 0, 0)
    grabbedToy.angularVelocity.set(0, 0, 0)
    heldOffsetX = (grabbedToy.group.position.x - clawX) * 0.24
    heldOffsetZ = (grabbedToy.group.position.z - clawZ) * 0.24
    const stability = clamp(1 - nearestDistance * 0.63 + randomBetween(-0.26, 0.18), 0, 1)
    unstableGrip = stability < 0.56
    unstableDropPoint = randomBetween(0.35, 0.82)
    setStatus(unstableGrip ? '잡혔지만 조금 불안정해 보여요…' : '인형을 안정적으로 잡았어요!')
  }

  const dropHeldToy = (intoExit: boolean) => {
    if (!grabbedToy) return
    grabbedToy.state = 'falling'
    grabbedToy.velocity.set(intoExit ? 0 : randomBetween(-0.16, 0.16), intoExit ? -0.8 : 0, intoExit ? 0 : randomBetween(-0.16, 0.16))
    grabbedToy.angularVelocity.set(randomBetween(-1, 1), randomBetween(-0.7, 0.7), randomBetween(-1, 1))
    grabbedToy.fallingIntoExit = intoExit
    grabbedToy = null
    unstableGrip = false
  }

  const startDrop = () => {
    if (state !== 'idle') return
    setControlsLocked(true)
    setStatus('집게가 내려가고 있어요')
    transition('lowering')
  }

  const collisionDelta = new THREE.Vector3()
  const collisionVelocity = new THREE.Vector3()
  const measuredBounds = new THREE.Box3()
  const childBounds = new THREE.Box3()
  const inverseParentMatrix = new THREE.Matrix4()
  const relativeChildMatrix = new THREE.Matrix4()

  const refreshToyFloorOffset = (toy: Toy) => {
    const parent = toy.group.parent
    if (!parent) return
    parent.updateWorldMatrix(true, false)
    toy.group.updateWorldMatrix(true, true)
    inverseParentMatrix.copy(parent.matrixWorld).invert()
    measuredBounds.makeEmpty()
    toy.group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
      if (!child.geometry.boundingBox) return
      relativeChildMatrix.multiplyMatrices(inverseParentMatrix, child.matrixWorld)
      childBounds.copy(child.geometry.boundingBox).applyMatrix4(relativeChildMatrix)
      measuredBounds.union(childBounds)
    })
    if (!measuredBounds.isEmpty()) toy.floorOffset = toy.group.position.y - measuredBounds.min.y
  }

  const pileToys: Toy[] = []
  const updatePilePhysics = (deltaTime: number) => {
    pileToys.length = 0
    for (const toy of toys) if (toy.state === 'pile') pileToys.push(toy)
    const slideDamping = Math.exp(-1.7 * deltaTime)
    const rotationDamping = Math.exp(-2.8 * deltaTime)

    pileToys.forEach((toy) => {
      toy.velocity.y -= 13.5 * deltaTime
      toy.velocity.x *= slideDamping
      toy.velocity.z *= slideDamping
      toy.angularVelocity.multiplyScalar(rotationDamping)
      toy.group.position.addScaledVector(toy.velocity, deltaTime)
      toy.group.rotation.x += toy.angularVelocity.x * deltaTime
      toy.group.rotation.y += toy.angularVelocity.y * deltaTime
      toy.group.rotation.z += toy.angularVelocity.z * deltaTime

      const minimumY = FLOOR_Y + toy.floorOffset
      if (toy.group.position.y < minimumY) {
        toy.group.position.y = minimumY
        if (toy.velocity.y < 0) toy.velocity.y *= -0.025
        toy.velocity.x *= 0.7
        toy.velocity.z *= 0.7
        toy.angularVelocity.multiplyScalar(0.72)
        if (Math.abs(toy.velocity.y) < 0.08) toy.velocity.y = 0
      }

      const minimumX = -3.58 + toy.radius
      const maximumX = 3.58 - toy.radius
      const minimumZ = -2.42 + toy.radius
      const maximumZ = 1.78 - toy.radius
      if (toy.group.position.x < minimumX || toy.group.position.x > maximumX) {
        toy.group.position.x = clamp(toy.group.position.x, minimumX, maximumX)
        toy.velocity.x *= -0.18
      }
      if (toy.group.position.z < minimumZ || toy.group.position.z > maximumZ) {
        toy.group.position.z = clamp(toy.group.position.z, minimumZ, maximumZ)
        toy.velocity.z *= -0.18
      }
    })

    for (let pass = 0; pass < 3; pass += 1) {
      for (let firstIndex = 0; firstIndex < pileToys.length; firstIndex += 1) {
        const first = pileToys[firstIndex]
        for (let secondIndex = firstIndex + 1; secondIndex < pileToys.length; secondIndex += 1) {
          const second = pileToys[secondIndex]
          collisionDelta.subVectors(second.group.position, first.group.position)
          const horizontalRadius = (first.radius + second.radius) * 0.94
          const verticalRadius = (first.halfHeight + second.halfHeight) * 0.96
          const normalizedX = collisionDelta.x / horizontalRadius
          const normalizedY = collisionDelta.y / verticalRadius
          const normalizedZ = collisionDelta.z / horizontalRadius
          const normalizedDistance = Math.hypot(normalizedX, normalizedY, normalizedZ)
          if (normalizedDistance >= 1) continue

          if (normalizedDistance < 0.0001) {
            collisionDelta.set(randomBetween(-1, 1), 0.18, randomBetween(-1, 1)).normalize()
          } else {
            // Normal of an ellipsoid: wide enough to touch, short enough that
            // reclining toys do not appear to rest on an invisible ball.
            collisionDelta.set(
              collisionDelta.x / (horizontalRadius * horizontalRadius),
              collisionDelta.y / (verticalRadius * verticalRadius),
              collisionDelta.z / (horizontalRadius * horizontalRadius),
            ).normalize()
          }

          const effectiveRadius = 1 / Math.sqrt(
            (collisionDelta.x * collisionDelta.x + collisionDelta.z * collisionDelta.z) / (horizontalRadius * horizontalRadius)
            + (collisionDelta.y * collisionDelta.y) / (verticalRadius * verticalRadius),
          )
          // Resolve only part of the penetration so plush bodies look softly
          // compressed together rather than separated by a rigid air gap.
          const overlap = (1 - normalizedDistance) * effectiveRadius * 0.62
          first.group.position.addScaledVector(collisionDelta, -overlap * 0.5)
          second.group.position.addScaledVector(collisionDelta, overlap * 0.5)

          collisionVelocity.subVectors(second.velocity, first.velocity)
          const normalSpeed = collisionVelocity.dot(collisionDelta)
          if (normalSpeed < 0) {
            const impulse = -(1.015 * normalSpeed) / 2
            first.velocity.addScaledVector(collisionDelta, -impulse)
            second.velocity.addScaledVector(collisionDelta, impulse)
          }
          first.angularVelocity.multiplyScalar(0.985)
          second.angularVelocity.multiplyScalar(0.985)
        }
      }
    }

    pileToys.forEach((toy) => {
      toy.group.position.y = Math.max(toy.group.position.y, FLOOR_Y + toy.floorOffset)
    })
  }

  const updateFallingToys = (deltaTime: number) => {
    toys.forEach((toy) => {
      if (toy.state === 'showcase') {
        toy.showcaseTime += deltaTime
        const enterScale = clamp(toy.showcaseTime / 0.24, 0, 1)
        const exitScale = clamp((2 - toy.showcaseTime) / 0.24, 0, 1)
        const revealScale = easeInOut(Math.min(enterScale, exitScale))
        toy.group.scale.setScalar(2.05 * revealScale)
        toy.group.position.y = 4.55 + Math.sin(toy.showcaseTime * 3.4) * 0.08
        toy.group.rotation.y += deltaTime * 0.75

        if (toy.showcaseTime >= 2) {
          toy.state = 'won'
          toy.group.visible = false
          prizeRevealElement.hidden = true
          wonPrizes.push(toy)
          renderPrizeList()
        }
        return
      }

      if (toy.state !== 'falling') return
      toy.velocity.y -= 7.8 * deltaTime
      toy.group.position.addScaledVector(toy.velocity, deltaTime)
      toy.group.rotation.x += toy.angularVelocity.x * deltaTime
      toy.group.rotation.y += toy.angularVelocity.y * deltaTime
      toy.group.rotation.z += toy.angularVelocity.z * deltaTime

      if (toy.fallingIntoExit && toy.group.position.y < 0.62) {
        stopViewingPrize()
        toy.state = 'showcase'
        toy.velocity.set(0, 0, 0)
        toy.showcaseTime = 0
        scene.attach(toy.group)
        toy.group.position.set(0, 4.55, 7.1)
        toy.group.rotation.set(0, -0.35, 0)
        toy.group.visible = true
        prizeRevealName.textContent = toy.label
        prizeRevealElement.hidden = false
        prizeCount += 1
        prizeCountElement.textContent = String(prizeCount)
        setStatus('성공! 인형이 출구로 나왔어요')
      } else if (!toy.fallingIntoExit && toy.group.position.y <= FLOOR_Y + toy.floorOffset) {
        toy.state = 'pile'
        toy.velocity.set(0, 0, 0)
        refreshToyFloorOffset(toy)
        toy.group.position.y = FLOOR_Y + toy.floorOffset
        toy.angularVelocity.set(0, 0, 0)
        setStatus('인형이 도중에 떨어졌어요')
      }
    })
  }

  const updateMachine = (deltaTime: number) => {
    stateTime += deltaTime

    if (state === 'idle') {
      const moveSpeed = 2.7 * deltaTime
      if (heldDirections.has('left')) clawX -= moveSpeed
      if (heldDirections.has('right')) clawX += moveSpeed
      if (heldDirections.has('back')) clawZ -= moveSpeed
      if (heldDirections.has('front')) clawZ += moveSpeed
      clawX = clamp(clawX, -2.95, 2.95)
      clawZ = clamp(clawZ, -1.95, 1.75)
    } else if (state === 'lowering') {
      const progress = clamp(stateTime / 1.35, 0, 1)
      clawY = THREE.MathUtils.lerp(HIGH_Y, LOW_Y, easeInOut(progress))
      if (progress >= 1) {
        setStatus('집게가 인형 주변에서 접히고 있어요')
        transition('closing')
      }
    } else if (state === 'closing') {
      const progress = clamp(stateTime / 0.72, 0, 1)
      fingerOpen = 1 - easeInOut(progress)
      if (progress >= 1) {
        attemptGrab()
        transition('lifting')
      }
    } else if (state === 'lifting') {
      const progress = clamp(stateTime / 1.5, 0, 1)
      clawY = THREE.MathUtils.lerp(LOW_Y, HIGH_Y, easeInOut(progress))
      if (grabbedToy && unstableGrip && progress >= unstableDropPoint) dropHeldToy(false)
      if (progress >= 1) {
        moveStartX = clawX
        moveStartZ = clawZ
        if (grabbedToy) setStatus('인형을 출구로 옮기고 있어요')
        else setStatus('빈 집게가 출구로 이동하고 있어요')
        transition('moving')
      }
    } else if (state === 'moving') {
      const progress = clamp(stateTime / 1.7, 0, 1)
      clawX = THREE.MathUtils.lerp(moveStartX, EXIT_X, easeInOut(progress))
      clawZ = THREE.MathUtils.lerp(moveStartZ, EXIT_Z, easeInOut(progress))
      if (grabbedToy && unstableGrip && progress >= unstableDropPoint) dropHeldToy(false)
      if (progress >= 1) {
        prizeReleased = false
        setStatus(grabbedToy ? '출구 위에서 집게를 펼칩니다' : '집게를 다시 펼칩니다')
        transition('releasing')
      }
    } else if (state === 'releasing') {
      const progress = clamp(stateTime / 0.82, 0, 1)
      fingerOpen = easeInOut(progress)
      if (progress > 0.4 && !prizeReleased) {
        prizeReleased = true
        dropHeldToy(true)
      }
      if (progress >= 1) {
        moveStartX = clawX
        moveStartZ = clawZ
        transition('returning')
      }
    } else if (state === 'returning') {
      const progress = clamp(stateTime / 1.35, 0, 1)
      clawX = THREE.MathUtils.lerp(moveStartX, HOME_X, easeInOut(progress))
      clawZ = THREE.MathUtils.lerp(moveStartZ, HOME_Z, easeInOut(progress))
      if (progress >= 1) {
        setControlsLocked(false)
        setStatus('방향키로 집게를 움직여 보세요')
        transition('idle')
      }
    }

    updatePilePhysics(deltaTime)
    updateFallingToys(deltaTime)
    updateClawModel()
  }

  const directionByKey: Record<string, Direction | undefined> = {
    ArrowUp: 'back', ArrowDown: 'front', ArrowLeft: 'left', ArrowRight: 'right',
  }

  const handleKeydown = (event: KeyboardEvent) => {
    const direction = directionByKey[event.key]
    if (direction) {
      event.preventDefault()
      if (state === 'idle') {
        heldDirections.add(direction)
        directionButtons.forEach((button) => button.classList.toggle('is-pressed', heldDirections.has(button.dataset.direction as Direction)))
      }
      return
    }
    if (event.code === 'Space') {
      event.preventDefault()
      dropButton.classList.add('is-pressed')
      if (!event.repeat) startDrop()
    }
  }

  const handleKeyup = (event: KeyboardEvent) => {
    const direction = directionByKey[event.key]
    if (direction) {
      heldDirections.delete(direction)
      directionButtons.forEach((button) => button.classList.toggle('is-pressed', heldDirections.has(button.dataset.direction as Direction)))
    }
    if (event.code === 'Space') dropButton.classList.remove('is-pressed')
  }

  const handleDirectionDown = (event: PointerEvent) => {
    if (state !== 'idle') return
    const button = (event.currentTarget as HTMLButtonElement)
    const direction = button.dataset.direction as Direction
    heldDirections.add(direction)
    button.classList.add('is-pressed')
    button.setPointerCapture(event.pointerId)
  }

  const handleDirectionUp = (event: PointerEvent) => {
    const button = event.currentTarget as HTMLButtonElement
    heldDirections.delete(button.dataset.direction as Direction)
    button.classList.remove('is-pressed')
  }

  const clearDirections = () => {
    heldDirections.clear()
    directionButtons.forEach((button) => button.classList.remove('is-pressed'))
    dropButton.classList.remove('is-pressed')
  }

  const startMachineDrag = (event: PointerEvent) => {
    isDragging = true
    dragPointerX = event.clientX
    dragPointerY = event.clientY
    canvas.classList.add('is-dragging')
    canvas.setPointerCapture(event.pointerId)
  }

  const rotateMachine = (event: PointerEvent) => {
    if (!isDragging) return
    const deltaX = event.clientX - dragPointerX
    const deltaY = event.clientY - dragPointerY
    dragPointerX = event.clientX
    dragPointerY = event.clientY
    targetRotationY = clamp(targetRotationY + deltaX * 0.008, -1.05, 1.05)
    targetRotationX = clamp(targetRotationX + deltaY * 0.004, -0.16, 0.22)
  }

  const stopMachineDrag = () => {
    isDragging = false
    canvas.classList.remove('is-dragging')
  }

  const resize = () => {
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    if (camera.aspect < 0.82) {
      camera.fov = 48
      camera.position.set(0, 8.4, 22)
    } else {
      camera.fov = 38
      camera.position.set(0, 7.2, 18.5)
    }
    camera.lookAt(0, 4.55, 0)
    camera.updateProjectionMatrix()
  }

  const render = (time: number) => {
    if (disposed) return
    if (document.hidden) { previousTime = time; animationFrameId = requestAnimationFrame(render); return }
    const deltaTime = Math.min(0.033, (time - previousTime) / 1000)
    previousTime = time
    updateMachine(deltaTime)
    if (viewedToy?.state === 'won') {
      viewedToy.group.position.set(0, 4.55 + Math.sin(time * 0.0018) * 0.06, 7.05)
      viewedToy.group.rotation.y += deltaTime * 0.72
    }
    displayRoot.rotation.x += (targetRotationX - displayRoot.rotation.x) * Math.min(1, deltaTime * 12)
    displayRoot.rotation.y += (targetRotationY - displayRoot.rotation.y) * Math.min(1, deltaTime * 12)
    renderer.render(scene, camera)
    animationFrameId = requestAnimationFrame(render)
  }

  window.addEventListener('resize', resize)
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('keyup', handleKeyup)
  window.addEventListener('blur', clearDirections)
  canvas.addEventListener('pointerdown', startMachineDrag)
  canvas.addEventListener('pointermove', rotateMachine)
  canvas.addEventListener('pointerup', stopMachineDrag)
  canvas.addEventListener('pointercancel', stopMachineDrag)
  dropButton.addEventListener('click', startDrop)
  prizeListButton.addEventListener('click', togglePrizePanel)
  prizePanelClose.addEventListener('click', closePrizePanel)
  prizeListElement.addEventListener('click', selectPrize)
  directionButtons.forEach((button) => {
    button.addEventListener('pointerdown', handleDirectionDown)
    button.addEventListener('pointerup', handleDirectionUp)
    button.addEventListener('pointercancel', handleDirectionUp)
  })

  // 첫 화면부터 인형이 공중에 떠 있지 않도록 짧은 물리 시간을 미리 계산한다.
  for (let step = 0; step < 420; step += 1) updatePilePhysics(1 / 90)
  toys.forEach((toy) => {
    refreshToyFloorOffset(toy)
    if (toy.group.position.y < FLOOR_Y + toy.floorOffset + 0.035) {
      toy.group.position.y = FLOOR_Y + toy.floorOffset
    }
    toy.velocity.set(0, 0, 0)
    toy.angularVelocity.set(0, 0, 0)
  })

  updateClawModel()
  resize()
  // Local transforms of decorative parts never change. Their world matrices
  // still follow moving parents, including toys held by the claw or showcased.
  const movingParts = new Set<THREE.Object3D>([scene, displayRoot, clawRoot, clawHead, cable, ...toys.map((toy) => toy.group)])
  for (const rig of fingerRigs) for (const part of Object.values(rig)) movingParts.add(part)
  scene.traverse((object) => {
    if (!movingParts.has(object)) { object.updateMatrix(); object.matrixAutoUpdate = false }
  })
  animationFrameId = requestAnimationFrame(render)

  return () => {
    disposed = true
    cancelAnimationFrame(animationFrameId)
    window.removeEventListener('resize', resize)
    window.removeEventListener('keydown', handleKeydown)
    window.removeEventListener('keyup', handleKeyup)
    window.removeEventListener('blur', clearDirections)
    canvas.removeEventListener('pointerdown', startMachineDrag)
    canvas.removeEventListener('pointermove', rotateMachine)
    canvas.removeEventListener('pointerup', stopMachineDrag)
    canvas.removeEventListener('pointercancel', stopMachineDrag)
    dropButton.removeEventListener('click', startDrop)
    prizeListButton.removeEventListener('click', togglePrizePanel)
    prizePanelClose.removeEventListener('click', closePrizePanel)
    prizeListElement.removeEventListener('click', selectPrize)
    directionButtons.forEach((button) => {
      button.removeEventListener('pointerdown', handleDirectionDown)
      button.removeEventListener('pointerup', handleDirectionUp)
      button.removeEventListener('pointercancel', handleDirectionUp)
    })

    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      geometries.add(object.geometry)
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
      objectMaterials.forEach((material) => materials.add(material))
    })
    geometries.forEach((geometry) => geometry.dispose())
    materials.forEach((material) => material.dispose())
    signTexture.dispose()
    renderer.dispose()
  }
}
