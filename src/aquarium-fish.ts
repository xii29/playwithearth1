type LuminousFish = { x: number; y: number; vx: number; vy: number; size: number; hue: number; depth: number; kind: number; phase: number; scared: number }

// Small, shared bitmap sprites: no per-fish shadow blur or gradient allocation
// in the animation loop. The gradients are emitted light, not body markings.
export function createLuminousFishPainter() {
  const sprites = new Map<string, HTMLCanvasElement>()
  const sprite = (hue: number, kind: number) => {
    const key = `${hue}:${kind}`
    const existing = sprites.get(key)
    if (existing) return existing
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 192
    const c = canvas.getContext('2d')!
    c.translate(128, 96); c.scale(64, 64)
    const halo = c.createRadialGradient(0, 0, .12, 0, 0, 1.45)
    halo.addColorStop(0, `hsla(${hue} 100% 80% / .65)`)
    halo.addColorStop(.38, `hsla(${hue} 100% 70% / .24)`)
    halo.addColorStop(1, `hsla(${hue} 100% 60% / 0)`)
    c.fillStyle = halo; c.fillRect(-2, -1.5, 4, 3)
    const tall = kind === 0 ? .76 : kind === 2 ? .59 : .4
    c.fillStyle = `hsla(${hue} 100% 85% / .5)`
    c.beginPath(); c.moveTo(-.55, 0)
    c.quadraticCurveTo(-.12, -tall * 2.15, .45, -.2)
    c.lineTo(.4, .2); c.quadraticCurveTo(-.08, tall * 2, -.55, 0); c.fill()
    c.fillStyle = `hsl(${hue} 88% 80%)`
    c.beginPath(); c.moveTo(-.8, 0)
    c.bezierCurveTo(-.35, -tall, .64, -tall, 1, 0)
    c.bezierCurveTo(.65, tall, -.34, tall, -.8, 0); c.fill()
    // Eyes only: no mouth, cheek, stripe, spot or body outline.
    c.fillStyle = '#082630'; c.beginPath(); c.arc(.65, -.095, .075, 0, Math.PI * 2); c.fill()
    c.fillStyle = '#f6ffff'; c.beginPath(); c.arc(.672, -.117, .024, 0, Math.PI * 2); c.fill()
    sprites.set(key, canvas); return canvas
  }
  return (context: CanvasRenderingContext2D, fish: LuminousFish, time: number) => {
    const size = fish.size * (.72 + fish.depth * .38), hue = Math.round(fish.hue / 30) * 30
    const wave = Math.sin(time * .008 + fish.phase)
    context.save(); context.translate(fish.x, fish.y); context.rotate(Math.atan2(fish.vy, fish.vx)); context.scale(size, size)
    context.globalAlpha = (.58 + fish.depth * .4) * (.92 + .08 * Math.sin(time * .0014 + fish.phase))
    context.fillStyle = `hsla(${hue} 100% 82% / .7)`
    context.beginPath(); context.moveTo(-.65, 0)
    context.bezierCurveTo(-1.15, -.16, -1.62, -.72 + wave * .13, -1.48, -.47 + wave * .1)
    context.quadraticCurveTo(-1.12, wave * .14, -1.48, .47 + wave * .1)
    context.bezierCurveTo(-1.62, .72 + wave * .13, -1.15, .16, -.65, 0); context.fill()
    context.drawImage(sprite(hue, fish.kind % 4), -2, -1.5, 4, 3)
    context.restore()
  }
}
