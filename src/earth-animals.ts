import { buildMiniature } from './earth-miniature'

export const ANIMAL_NAMES = ['루나', '코코', '모모', '별이', '토리', '보리']
export function gyaruTexture(canvas:HTMLCanvasElement,index=0){
  const c=canvas.getContext('2d')!;c.save();c.scale(canvas.width/384,canvas.height/384);c.globalCompositeOperation='source-atop'
  const oval=(x:number,y:number,rx:number,ry:number,color:string)=>{c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill()}
  // Blonde side-swept fringe, pink leopard knit, lashes and gold jewellery.
  c.fillStyle=['#ffe6a0','#f5c478','#f9c4df'][index%3];c.beginPath();c.moveTo(92,131);c.bezierCurveTo(93,35,284,38,290,132);c.quadraticCurveTo(229,127,222,89);c.quadraticCurveTo(177,150,92,131);c.fill()
  oval(192,278,75,50,'#ef80b1')
  c.strokeStyle='#76364f';c.lineWidth=4
  for(let y=248;y<314;y+=18)for(let x=134;x<256;x+=24){c.beginPath();c.ellipse(x+(y%36?7:0),y,6,4,.5,0,Math.PI*1.6);c.stroke()}
  for(const x of [159,225]){c.strokeStyle='#482b43';c.lineWidth=4;for(let i=0;i<3;i++){c.beginPath();c.moveTo(x-8+i*7,144);c.lineTo(x-13+i*9,133);c.stroke()}oval(x,163,11,3,'#fff5e2')}
  oval(137,182,17,8,'#f77baa');oval(247,182,17,8,'#f77baa')
  c.strokeStyle='#ffda6a';c.lineWidth=5;for(const x of [105,279]){c.beginPath();c.ellipse(x,181,9,14,0,0,Math.PI*2);c.stroke()}
  c.beginPath();c.arc(192,223,22,0,Math.PI);c.stroke();oval(192,247,6,7,'#fff0a0')
  for(let i=0;i<5;i++){const a=i*Math.PI*2/5;oval(255+Math.cos(a)*11,99+Math.sin(a)*11,8,8,'#fff3ed')}oval(255,99,6,6,'#ffd04c')
  c.restore()
}
// Original miniature silhouettes and illustrations, not game character assets.
export function createAnimal(index: number) {
  const shape = document.createElement('canvas'); shape.width = shape.height = 384
  const c = shape.getContext('2d')!, color = ['#b6ddf1', '#eac8a4', '#c2b2ea', '#e5a585', '#adc9ad', '#eed8a9'][index % 6]
  const oval = (x: number, y: number, rx: number, ry: number, fill: string) => { c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill() }
  if (index % 3 === 0) { oval(132, 65, 23, 60, color); oval(252, 65, 23, 60, color); oval(132, 60, 10, 40, '#e8c0d4'); oval(252, 60, 10, 40, '#e8c0d4') }
  else if (index % 3 === 1) { oval(118, 89, 34, 34, color); oval(266, 89, 34, 34, color); oval(118, 89, 17, 17, '#b9849f'); oval(266, 89, 17, 17, '#b9849f') }
  else {
    c.fillStyle = color; c.beginPath(); c.moveTo(91, 123); c.lineTo(112, 32); c.lineTo(170, 102); c.moveTo(214, 102); c.lineTo(272, 32); c.lineTo(293, 123); c.fill()
  }
  oval(147, 329, 31, 35, color); oval(237, 329, 31, 35, color)
  oval(106, 262, 26, 43, color); oval(278, 262, 26, 43, color)
  oval(192, 268, 78, 66, ['#6b7fbd', '#8ebcad', '#cd92a9'][index % 3])
  oval(192, 153, 102, 94, color)
  oval(159, 151, 8, 11, '#24314b'); oval(225, 151, 8, 11, '#24314b')
  oval(161, 147, 2.5, 3.5, '#fff'); oval(227, 147, 2.5, 3.5, '#fff')
  oval(192, 178, 9, 6, '#4a4260')
  c.strokeStyle = '#4a4260'; c.lineWidth = 3; c.beginPath(); c.arc(192, 183, 12, .2, Math.PI - .2); c.stroke()
  oval(138, 180, 12, 6, '#e7a7b8'); oval(246, 180, 12, 6, '#e7a7b8')
  oval(192, 271, 14, 14, '#f5ebb7'); oval(192, 271, 8, 8, '#91cfc9')
  gyaruTexture(shape,index)
  const model=buildMiniature(shape, { image: shape, landmarks: [], bounds: { x: 0, y: 0, width: 384, height: 384 }, color });model.actor.userData.gyaru=true;return model
}
