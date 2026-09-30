import { createSpaceParticles } from './space-particles-engine'

let engine: ReturnType<typeof createSpaceParticles> | undefined
self.addEventListener('message', (event: MessageEvent) => {
  const message = event.data
  try {
    if (message.type === 'init') {
      if (typeof requestAnimationFrame !== 'function') throw new Error('Worker animation frames unavailable')
      const canvas = new OffscreenCanvas(1, 1)
      engine = createSpaceParticles(canvas, undefined, () => {
        const bitmap = canvas.transferToImageBitmap()
        ;(self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage({ type: 'frame', bitmap }, [bitmap])
        // At most one bitmap is in flight. The UI acknowledges presentation
        // before we render another frame, avoiding a growing GPU work queue.
        return false
      })
      engine.resize(message.width, message.height, message.ratio)
      engine.setVisible(message.visible)
      self.postMessage({ type: 'ready' })
    } else if (message.type === 'ack') engine?.requestFrame()
    else if (message.type === 'resize') engine?.resize(message.width, message.height, message.ratio)
    else if (message.type === 'visible') engine?.setVisible(message.visible)
    else if (message.type === 'pointer') {
      if (message.action === 'down') engine?.gather(message.x, message.y)
      else if (message.action === 'move') engine?.movePointer(message.x, message.y)
      else engine?.explode(message.x, message.y)
    }
  } catch (error) {
    engine?.dispose()
    self.postMessage({ type: 'error', message: String(error) })
  }
})
