import * as THREE from 'three'
import type { Resident } from './earth-residents'
import { VILLAGE_CLEARING, type createEarthGarden } from './earth-garden'

export function setupSpaceEdition(scene: THREE.Scene, root: HTMLElement, residents: Resident[], garden: ReturnType<typeof createEarthGarden>) {
  const group = new THREE.Group(); group.name = 'Space edition'; scene.add(group)
  const coordinates = new Float32Array(1500 * 3), colors = new Float32Array(1500 * 3)
  const direction = new THREE.Vector3(), tint = new THREE.Color()
  for (let i = 0; i < 1500; i++) {
    direction.randomDirection().multiplyScalar(35 + Math.random() * 9); direction.toArray(coordinates, i * 3)
    tint.setHSL(.56 + Math.random() * .23, .3, .6 + Math.random() * .35); tint.toArray(colors, i * 3)
  }
  const starGeometry = new THREE.BufferGeometry(); starGeometry.setAttribute('position', new THREE.BufferAttribute(coordinates, 3)); starGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ size: .045, vertexColors: true, transparent: true, opacity: .85, depthWrite: false })); group.add(stars)
  const material = (color: string, glow = false) => new THREE.MeshStandardMaterial({ color, roughness: .42, metalness: .25, emissive: glow ? color : '#000000', emissiveIntensity: glow ? .75 : 0 })
  const ship = new THREE.Group(); ship.name = 'Visiting UFO'
  const saucer = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), material('#959ccc')); saucer.scale.set(.62, .12, .62); ship.add(saucer)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), material('#82f4e9', true)); dome.scale.set(.28, .21, .28); dome.position.y = .1; ship.add(dome)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.53, .025, 6, 32), material('#c2a0ff', true)); ring.rotation.x = Math.PI / 2; ship.add(ring)
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.09, .42, 1.2, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#b0ffe5', transparent: true, opacity: .13, side: THREE.DoubleSide, depthWrite: false }))
  beam.position.y = -.7; ship.add(beam); group.add(ship); ship.visible = false
  const aliens = Array.from({ length: 3 }, (_, i) => {
    const actor = new THREE.Group(); actor.name = `Visitor ${i + 1}`
    const head = new THREE.Mesh(new THREE.SphereGeometry(.085, 12, 8), material('#9df4c0', true)); head.position.y = .22; head.scale.set(1, 1.2, .9); actor.add(head)
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.055, .08, 3, 8), material('#6877a8')); body.position.y = .09; actor.add(body)
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(.022, 8, 6), material('#19213e')); eye.scale.set(.8, 1.4, .4); eye.position.set(side * .032, .235, .072); actor.add(eye)
      const foot = new THREE.Mesh(new THREE.SphereGeometry(.036, 8, 6), material('#b1c4dc')); foot.scale.set(.6, .5, 1.3); foot.position.set(side * .04, .015, .025); actor.add(foot)
    }
    const blaster = new THREE.Mesh(new THREE.CylinderGeometry(.018, .025, .11, 8), material('#f6a2ea', true)); blaster.rotation.x = Math.PI / 2; blaster.position.set(.075, .12, .075); actor.add(blaster)
    actor.visible = false; group.add(actor); return { actor, normal: VILLAGE_CLEARING.clone() }
  })
  const bolts = Array.from({ length: 6 }, () => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(.026, 6, 4), material('#ffa7ee', true)); mesh.visible = false; group.add(mesh)
    return { mesh, from: new THREE.Vector3(), to: new THREE.Vector3(), age: 1 }
  })
  const eventText = root.querySelector<HTMLElement>('#earth-event-status')!
  let countdown = 12 + Math.random() * 8, age = -1, clock = 0, lastShot = 0, boltIndex = 0
  const landing = VILLAGE_CLEARING.clone(), from = new THREE.Vector3(), at = new THREE.Vector3(), forward = new THREE.Vector3(), right = new THREE.Vector3(), basis = new THREE.Matrix4()
  const encounter = () => {
    if (!residents.length || age >= 0) return
    const resident = residents[Math.floor(Math.random() * residents.length)]
    landing.copy(resident.normal); from.copy(landing).multiplyScalar(15).add(new THREE.Vector3(7, 2, -5))
    ship.visible = true; beam.visible = false; age = 0; lastShot = 0
    ship.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), landing)
    aliens.forEach((alien, i) => { alien.normal.copy(landing).add(new THREE.Vector3(Math.sin(i * 2.1) * .08, .03, Math.cos(i * 2.1) * .08)).normalize() })
    eventText.textContent = '미확인 우주선 접근 중… 작은 방문객들이 찾아왔어요!'
  }
  return {
    setDaylight: (amount:number) => {stars.material.opacity=.85*(1-amount);stars.visible=amount<.99},
    encounter,
    update: (delta: number, paused: boolean) => {
      if (paused) return
      clock += delta
      if (age < 0) { countdown -= delta; if (countdown <= 0) encounter(); return }
      age += delta
      at.copy(landing).multiplyScalar(garden.radiusAt(landing) + 1.05)
      if (age < 4) { const t = age / 4; ship.position.lerpVectors(from, at, 1 - (1 - t) ** 3) }
      else if (age < 15) { ship.position.copy(at).addScaledVector(landing, Math.sin(clock * 2) * .045); beam.visible = age < 7 }
      else { beam.visible = true; ship.position.lerpVectors(at, from, Math.min(1, ((age - 15) / 3) ** 2)) }
      ring.rotation.z += delta * .8
      if (age >= 4 && age < 15) {
        aliens.forEach((alien, i) => {
          alien.actor.visible = true
          const target = residents.reduce<Resident | null>((best, resident) => !best || resident.normal.distanceToSquared(alien.normal) < best.normal.distanceToSquared(alien.normal) ? resident : best, null)
          if (target) {
            forward.copy(target.normal).addScaledVector(alien.normal, -target.normal.dot(alien.normal)).normalize()
            if (age > 6 && alien.normal.distanceTo(target.normal) > .12) {
              direction.copy(alien.normal).addScaledVector(forward, delta * .045).normalize()
              if (garden.walkable(direction)) alien.normal.copy(direction)
            }
          }
          if (forward.lengthSq() < .01) forward.set(1, 0, 0).projectOnPlane(alien.normal).normalize()
          right.crossVectors(alien.normal, forward).normalize(); basis.makeBasis(right, alien.normal, forward); alien.actor.quaternion.setFromRotationMatrix(basis)
          alien.actor.position.copy(alien.normal).multiplyScalar(garden.radiusAt(alien.normal) + Math.max(0, 6 - age) * .38 + Math.abs(Math.sin(clock * 8 + i)) * .015)
        })
        if (age > 6 && age - lastShot > 1.25 && residents.length) {
          lastShot = age; const alien = aliens[boltIndex % aliens.length]
          const target = residents.reduce((best, resident) => resident.normal.distanceToSquared(alien.normal) < best.normal.distanceToSquared(alien.normal) ? resident : best)
          const bolt = bolts[boltIndex++ % bolts.length]; bolt.from.copy(alien.actor.position).addScaledVector(alien.normal, .16); bolt.to.copy(target.root.position).addScaledVector(target.normal, .3); bolt.age = 0; bolt.mesh.visible = true
          target.root.userData.scaredUntil = clock + 4
          target.direction.copy(target.normal).sub(alien.normal).projectOnPlane(target.normal).normalize()
          eventText.textContent = `우주인이 별빛 광선을 발사했어요! ${target.name} 주민이 달아납니다. (주민은 사라지지 않아요)`
        }
      } else if (age >= 15) aliens.forEach(alien => { alien.actor.visible = false })
      for (const bolt of bolts) {
        if (!bolt.mesh.visible) continue
        bolt.age += delta; const progress = Math.min(1, bolt.age / .4); bolt.mesh.position.lerpVectors(bolt.from, bolt.to, progress); bolt.mesh.scale.setScalar(1 + Math.sin(progress * Math.PI) * 2)
        if (progress === 1) bolt.mesh.visible = false
      }
      if (age >= 18) { ship.visible = false; beam.visible = false; aliens.forEach(alien => { alien.actor.visible = false }); bolts.forEach(bolt => { bolt.mesh.visible = false }); age = -1; countdown = 25 + Math.random() * 25; eventText.textContent = '우주선이 떠났어요. 다시 평화로운 산책 시간이에요.' }
    },
    frightened: (resident: Resident) => Number(resident.root.userData.scaredUntil ?? 0) > clock,
    dispose: () => {
      scene.remove(group)
      group.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.Points) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(m => m.dispose()) } })
    },
  }
}
