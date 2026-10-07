import * as THREE from 'three'

// Fine veins, mottling and speckles stay on the deforming surface.
function petalSurface(){
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=512
  const c=canvas.getContext('2d')!,pixels=c.createImageData(256,512)
  let seed=9137
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  for(let y=0;y<512;y++)for(let x=0;x<256;x++){
    const k=(y*256+x)*4,value=239+random()*16
    pixels.data[k]=value;pixels.data[k+1]=value;pixels.data[k+2]=value;pixels.data[k+3]=255
  }
  c.putImageData(pixels,0,0)
  for(let i=0;i<29;i++){
    const x=8+i*8.5
    c.strokeStyle=i%3===0?'#90354830':'#85445117';c.lineWidth=i%3===0?.8:.45
    c.beginPath();c.moveTo(128+(x-128)*.15,512);c.bezierCurveTo(x,380,x+(random()-.5)*12,150,x,0);c.stroke()
  }
  for(let i=0;i<90;i++){
    const y=280+random()*175,x=128+(random()-.5)*Math.sin((512-y)/512*Math.PI)*130
    c.fillStyle='#973146'+(i%3===0?'65':'30');c.beginPath();c.ellipse(x,y,.5+random(),1+random()*2,.25,0,Math.PI*2);c.fill()
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace
  return texture
}
export function createFlowerSculpture(canvas:HTMLCanvasElement){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true})
  renderer.setClearColor(0x000000);renderer.outputColorSpace=THREE.SRGBColorSpace
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-4,4,3,-3,.1,40)
  camera.position.set(0,2.4,9);camera.lookAt(0,-.15,0)
  scene.add(new THREE.HemisphereLight(0xffe9ed,0x263d21,1.25))
  const key=new THREE.DirectionalLight(0xffebde,2.3);key.position.set(-3,5,5);scene.add(key)
  const rim=new THREE.DirectionalLight(0xffd5df,1.1);rim.position.set(4,2,-2);scene.add(rim)
  const stemMaterial=new THREE.MeshStandardMaterial({color:0x65742d,roughness:.75})
  const leafMaterial=new THREE.MeshStandardMaterial({color:0x638e32,vertexColors:true,side:THREE.DoubleSide,roughness:.48})
  const surface=petalSurface()
  const petalMaterial=new THREE.MeshPhysicalMaterial({vertexColors:true,map:surface,bumpMap:surface,bumpScale:.012,side:THREE.DoubleSide,roughness:.52,clearcoat:.12})
  const pollenMaterial=new THREE.MeshStandardMaterial({color:0x9a4425,roughness:.8})
  const filamentMaterial=new THREE.MeshStandardMaterial({color:0xe2d697,roughness:.7})
  const geometries:THREE.BufferGeometry[]=[]
  const anchors=[new THREE.Vector3(-1.65,-.45,0),new THREE.Vector3(0,.65,-.3),new THREE.Vector3(1.65,-.35,-.05)]
  const trunk=new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-.27,-2.85,0),new THREE.Vector3(-.13,-1.8,-.1),new THREE.Vector3(.03,-.7,-.18),anchors[1]]),40,.06,10,false)
  geometries.push(trunk);scene.add(new THREE.Mesh(trunk,stemMaterial))
  const flowers=anchors.map((anchor,flowerIndex)=>{
    if(flowerIndex!==1){const stem=new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-.08,-1.1+flowerIndex*.15,-.15),new THREE.Vector3(anchor.x*.5,-.95,-.1),anchor]),24,.032,8,false);geometries.push(stem);scene.add(new THREE.Mesh(stem,stemMaterial))}
    const group=new THREE.Group();group.position.copy(anchor);group.rotation.x=.85;group.rotation.z=(flowerIndex-1)*-.18;scene.add(group)
    const petals=Array.from({length:6},(_,index)=>{
      const geometry=new THREE.BufferGeometry(),positions=new Float32Array(25*13*3),colors=new Float32Array(positions.length),uv=new Float32Array(25*13*2),indices:number[]=[]
      for(let y=0;y<24;y++)for(let x=0;x<12;x++){const a=y*13+x,b=a+13;indices.push(a,b,a+1,b,b+1,a+1)}
      geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage))
      geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.setIndex(indices);geometries.push(geometry)
      for(let y=0;y<25;y++)for(let x=0;x<13;x++){const k=(y*13+x)*2;uv[k]=x/12;uv[k+1]=y/24}
      geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2))
      const mesh=new THREE.Mesh(geometry,petalMaterial);mesh.rotation.y=index*Math.PI/3;group.add(mesh)
      const blush=new THREE.Color(flowerIndex===1?0xef77a3:0xe34c88),throat=new THREE.Color(0xe1dc90),tip=new THREE.Color(0xffd0bd)
      for(let y=0;y<25;y++)for(let x=0;x<13;x++){
        const t=y/24,u=x/6-1,c=throat.clone().lerp(blush,Math.min(1,t*2.6))
        c.lerp(tip,Math.pow(Math.abs(u),4)*.28+Math.pow(t,12)*.32)
        c.multiplyScalar(1-.08*Math.cos(u*31+t*4)**12);c.toArray(colors,(y*13+x)*3)
      }
      return {positions,geometry,index}
    })
    const center=new THREE.Group();group.add(center)
    for(let i=0;i<6;i++){
      const angle=i*Math.PI/3,tip=new THREE.Vector3(Math.cos(angle)*.23,.82+(i%2)*.09,Math.sin(angle)*.2)
      const g=new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0,.03,0),new THREE.Vector3(Math.cos(angle)*.09,.42,Math.sin(angle)*.08),tip]),12,.012,5,false);geometries.push(g)
      center.add(new THREE.Mesh(g,filamentMaterial))
      const pg=new THREE.SphereGeometry(.065,12,8);geometries.push(pg)
      const pollen=new THREE.Mesh(pg,pollenMaterial);pollen.scale.set(.55,1.9,.7);pollen.position.copy(tip);pollen.rotation.z=.55+(i%2)*.25;center.add(pollen)
    }
    const pistil=new THREE.Mesh(new THREE.CylinderGeometry(.018,.023,1.05,8),filamentMaterial);pistil.position.y=.53;center.add(pistil);geometries.push(pistil.geometry)
    for(let j=0;j<3;j++){const stigma=new THREE.Mesh(new THREE.SphereGeometry(.045,8,6),filamentMaterial);stigma.position.set(Math.cos(j*2.094)*.025,1.06,Math.sin(j*2.094)*.025);center.add(stigma);geometries.push(stigma.geometry)}
    return {petals,center}
  })
  for(let i=0;i<5;i++){
    const g=new THREE.BufferGeometry(),p:number[]=[],colors:number[]=[],indices:number[]=[],side=i%2?-1:1,y=-2.35+i*.31
    const length=i<2?1.55:1.15
    for(let j=0;j<=24;j++){
      const t=j/24,w=Math.sin(Math.PI*t)**.9*(i%2?.22:.32)
      for(let k=0;k<=8;k++){
        const edge=k/4-1,ridge=(1-Math.abs(edge))*.07*Math.sin(Math.PI*t)
        p.push(-.2+i*.035+side*t*length,y+t*(i%2?.95:.4)+Math.sin(Math.PI*t)*.4-edge*w,.08+edge*w*.45+ridge-t*t*.13)
        const shade=.72+ridge*3+.12*Math.cos(edge*25+t*5)**8
        colors.push(shade,shade,shade*.88)
      }
      if(j<24)for(let k=0;k<8;k++){const a=j*9+k;indices.push(a,a+9,a+1,a+9,a+10,a+1)}
    }
    g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();geometries.push(g);scene.add(new THREE.Mesh(g,leafMaterial))
  }
  const current=[-1,-1,-1]
  const update=(values:number[])=>{
    flowers.forEach((flower,i)=>{
      const open=values[i];if(Math.abs(open-current[i])<.0005)return;current[i]=open
      flower.center.scale.setScalar(.06+.94*open);flower.center.visible=open>.13
      for(const {positions,geometry,index} of flower.petals){
        for(let y=0;y<25;y++)for(let x=0;x<13;x++){
          const t=y/24,u=x/6-1,shape=Math.sin(Math.PI*t)**.8
          const length=1.55+(index%2)*.18
          const radius=(.014+Math.sin(Math.PI*t)*.23)*(1-open)+(.03+length*t+.08*Math.sin(Math.PI*t))*open
          const width=shape*(.18*(1-open)+(.48+(index%2)*.045)*open),k=(y*13+x)*3
          positions[k]=u*width
          positions[k+1]=1.65*t*(1-open)+(1.12*Math.sin(t*Math.PI*.78)-.54*t*t*t)*open+u*u*shape*.17*open
          positions[k+2]=radius+Math.cos(u*Math.PI/2)*shape*.045
        }
        geometry.attributes.position.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere()
      }
    })
  }
  update([0,0,0])
  return {
    update,
    resize(width:number,height:number){
      renderer.setPixelRatio(Math.min(devicePixelRatio,1.75,2200/width,2200/height));renderer.setSize(width,height,false)
      const aspect=width/height,viewHeight=Math.max(6.7,7.9/aspect)
      camera.left=-viewHeight*aspect/2;camera.right=viewHeight*aspect/2;camera.top=viewHeight/2;camera.bottom=-viewHeight/2;camera.updateProjectionMatrix()
    },
    render(){renderer.render(scene,camera)},
    dispose(){geometries.forEach(g=>g.dispose());surface.dispose();[stemMaterial,leafMaterial,petalMaterial,pollenMaterial,filamentMaterial].forEach(m=>m.dispose());renderer.dispose()},
  }
}
