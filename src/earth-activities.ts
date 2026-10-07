import * as THREE from 'three'
import type { Resident } from './earth-residents'
import { VILLAGE_CLEARING, type createEarthGarden } from './earth-garden'

// Small reusable stage props; no textures, timers or additional render loops.
export function setupVillageActivities(scene:THREE.Scene,garden:ReturnType<typeof createEarthGarden>,residents:Resident[]){
  const group=new THREE.Group();group.name='Village homes and hobbies';scene.add(group)
  const materials=new Map<string,THREE.MeshStandardMaterial>(),geometries=new Set<THREE.BufferGeometry>()
  const mesh=(geometry:THREE.BufferGeometry,color:string,parent:THREE.Object3D,x=0,y=0,z=0)=>{
    geometries.add(geometry);if(!materials.has(color))materials.set(color,new THREE.MeshStandardMaterial({color,roughness:.7}))
    const m=new THREE.Mesh(geometry,materials.get(color));m.position.set(x,y,z);parent.add(m);return m
  }
  const box=(p:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,c:string)=>mesh(new THREE.BoxGeometry(w,h,d),c,p,x,y,z)
  const ball=(p:THREE.Object3D,x:number,y:number,z:number,r:number,c:string)=>mesh(new THREE.SphereGeometry(r,10,8),c,p,x,y,z)
  const sites:THREE.Vector3[]=[]
  for(let i=0;i<3;i++){
    let normal=VILLAGE_CLEARING.clone()
    for(let j=0;j<1500;j++){const a=i*2.1+j*2.39996,s=.48+j*.0006;normal.copy(VILLAGE_CLEARING).add(new THREE.Vector3(Math.cos(a)*s,Math.sin(a)*s,.1)).normalize();if(garden.walkable(normal)&&sites.every(n=>n.distanceTo(normal)>.3))break}
    sites.push(normal.clone());const house=new THREE.Group();house.position.copy(normal).multiplyScalar(garden.radiusAt(normal));house.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),normal);group.add(house)
    box(house,0,.22,0,.52,.44,.42,['#f6dcba','#d9c8ee','#c1dfd1'][i]);const roof=mesh(new THREE.ConeGeometry(.43,.28,4),'#b9728f',house,0,.58,0);roof.rotation.y=Math.PI/4
    box(house,0,.12,.217,.12,.24,.015,'#846047');for(const x of [-.17,.17])box(house,x,.3,.218,.09,.1,.018,'#ffe6a0')
  }
  type Activity={resident:Resident;prop:THREE.Group;age:number;kind:number;fruit?:THREE.Mesh;fish?:THREE.Mesh;tree?:THREE.Group}
  const active=new Map<Resident,Activity>();let clock=0,next=2,sequence=0
  const begin=(r:Resident,kind:number)=>{
    const prop=new THREE.Group();r.root.add(prop);const a:Activity={resident:r,prop,age:0,kind};active.set(r,a)
    if(kind===0){
      const pond=mesh(new THREE.CircleGeometry(.3,24),'#638ece',prop,.22,.005,.5);pond.rotation.x=-Math.PI/2
      const rod=mesh(new THREE.CylinderGeometry(.009,.012,.8,6),'#ba8d4d',prop,.22,.48,.24);rod.rotation.x=.65
      const line=mesh(new THREE.CylinderGeometry(.002,.002,.5,4),'#e9eef7',prop,.22,.53,.48);line.name='Fishing line'
      a.fish=ball(prop,.22,.27,.48,.055,'#86c9ee');a.fish.scale.set(.5,.6,1.7);a.fish.visible=false
    }else if(kind===1){
      const guitar=ball(prop,.12,.35,.22,.14,'#bd8049');guitar.scale.set(.8,1,.3)
      const neck=box(prop,.2,.53,.24,.035,.28,.025,'#65402f');neck.rotation.z=-.35
      const hole=ball(prop,.12,.37,.263,.04,'#35243c');hole.scale.z=.1
      for(let i=0;i<4;i++)box(prop,.1+i*.012,.4,.27,.002,.18,.003,'#f2d89b')
      for(let i=0;i<3;i++){const note=ball(prop,-.1+i*.14,.85+i*.12,.1,.024,'#f6b6df');note.name='Music note';box(note,.025,.055,0,.009,.11,.01,'#f6b6df')}
    }else{
      const tree=new THREE.Group();tree.position.set(.44,0,.14);prop.add(tree);a.tree=tree
      mesh(new THREE.CylinderGeometry(.035,.05,.62,7),'#8b6244',tree,0,.31,0);ball(tree,0,.8,0,.23,'#70a56a')
      for(let i=0;i<3;i++)ball(tree,Math.cos(i*2.1)*.15,.75,Math.sin(i*2.1)*.15,.046,'#f1a04f')
      a.fruit=ball(prop,.36,.78,.24,.055,'#f6b34d')
    }
    r.root.userData.activity=['낚시 중','기타 연주 중','나무 흔들어 과일 먹기'][kind]
  }
  const end=(a:Activity)=>{a.resident.root.remove(a.prop);a.prop.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();geometries.delete(o.geometry)}});active.delete(a.resident);delete a.resident.root.userData.activity}
  return {
    blocked:(normal:THREE.Vector3)=>sites.some(n=>n.distanceToSquared(normal)<.012),
    ownsMovement:(r:Resident)=>active.has(r),
    update(dt:number,paused:boolean,interacting:(r:Resident)=>boolean){
      if(paused)return;clock+=dt
      for(const a of active.values()){
        if(!residents.includes(a.resident)||interacting(a.resident)){end(a);continue}
        a.age+=dt
        if(a.kind===0&&a.fish){a.prop.rotation.x=Math.sin(a.age*2)*.025;if(a.age>5){a.fish.visible=true;a.fish.position.y=.27+Math.min(.4,(a.age-5)*.15);a.fish.rotation.z=Math.sin(a.age*15)*.3}}
        if(a.kind===1){a.prop.rotation.z=Math.sin(a.age*7)*.035;a.prop.children.filter(c=>c.name==='Music note').forEach((n,i)=>{n.position.y=.85+i*.12+Math.sin(a.age*2+i)*.06})}
        if(a.kind===2&&a.tree&&a.fruit){a.tree.rotation.z=a.age<3?Math.sin(a.age*16)*.09:0;const t=Math.max(0,Math.min(1,(a.age-3)/2));a.fruit.position.set(.36*(1-t),.78-.18*t,.24);if(a.age>6)a.fruit.scale.setScalar(Math.max(0,1-(a.age-6)/2))}
        if(a.age>10)end(a)
      }
      if(clock>next&&residents.length){next=clock+4;const kind=sequence++%3
        const r=residents.find(r=>!active.has(r)&&!interacting(r)&&!sites.some(n=>n.distanceTo(r.normal)<.2))
        if(r)begin(r,kind)
      }
    },
    dispose(){for(const a of active.values())end(a);scene.remove(group);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose())}
  }
}
