import { buildMiniature } from './earth-miniature'

export const ANIMAL_NAMES = ['루나', '코코', '모모', '별이', '토리', '보리']
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
  return buildMiniature(shape, { image: shape, landmarks: [], bounds: { x: 0, y: 0, width: 384, height: 384 }, color })
}
