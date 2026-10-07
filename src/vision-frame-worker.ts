/** One transferable frame in flight; late frames never survive a camera restart. */
export class VisionFrameWorker {
  private worker: Worker
  private busy = false
  private closed = false
  private timer = 0
  private onFailure: () => void
  private rejectReady: ((error: Error) => void) | null = null
  readonly ready: Promise<void>
  constructor(worker: Worker, init: object, receive: (message: any) => void, failed: () => void) {
    this.onFailure = failed
    this.worker = worker
    this.ready = new Promise((resolve, reject) => {
      this.rejectReady = reject
      this.timer = window.setTimeout(() => this.fail(failed), 30000)
      this.worker.onmessage = ({ data }) => {
        if (this.closed) return
        if (data.type === 'ready') { clearTimeout(this.timer); this.rejectReady = null; resolve(); return }
        if (data.type === 'error') { this.fail(failed); return }
        if (data.type === 'result') { clearTimeout(this.timer); this.busy = false; receive(data) }
      }
      this.worker.onerror = () => this.fail(failed)
    })
    this.worker.postMessage({ type: 'init', ...init })
  }
  submit(video: HTMLVideoElement, timestamp: number, extra: object = {}) {
    if (this.closed || this.busy || this.rejectReady) return false
    this.busy = true
    this.timer = window.setTimeout(() => this.fail(this.onFailure), 5000)
    void createImageBitmap(video).then(bitmap => {
      if (this.closed) { bitmap.close(); return }
      this.worker.postMessage({ type: 'frame', bitmap, timestamp, ...extra }, [bitmap])
    }).catch(() => { clearTimeout(this.timer); this.busy = false })
    return true
  }
  private fail(failed: () => void) { this.close(); failed() }
  close() {
    if (this.closed) return
    this.closed = true; clearTimeout(this.timer)
    this.rejectReady?.(new Error('Vision worker stopped')); this.rejectReady = null
    this.worker.terminate()
  }
}
