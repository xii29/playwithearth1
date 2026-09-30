import { readFile, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'

const compress = promisify(gzip)
const types = { wasm: 'application/wasm', js: 'text/javascript', css: 'text/css', task: 'application/octet-stream', tflite: 'application/octet-stream' }

// Cache only public AI assets (and hashed build assets in preview), never keys
// or source files. Revalidate so replacing a model never leaves a stale copy.
export function assetMiddleware(root, preview = false) {
  const cache = new Map()
  return async (req, res, next) => {
    const pathname = (req.url || '').split('?')[0]
    const match = /^\/(mediapipe|assets)\/([a-zA-Z0-9_./-]+)\.(wasm|js|css|task|tflite)$/.exec(pathname)
    if (!match || (match[1] === 'assets' && !preview) || !['GET', 'HEAD'].includes(req.method) || req.headers.range) return next()
    const file = resolve(root, `.${pathname}`)
    if (!file.startsWith(resolve(root) + sep)) return next()
    try {
      const info = await stat(file)
      if (!info.isFile()) return next()
      const etag = `W/"${info.size}-${info.mtimeMs}"`
      res.setHeader('Vary', 'Accept-Encoding')
      const contentHashed = preview && match[1] === 'assets' && /-[\w-]{8}\.(js|css)$/.test(pathname)
      res.setHeader('Cache-Control', contentHashed ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate')
      res.setHeader('ETag', etag)
      if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return }
      const acceptsGzip = (req.headers['accept-encoding'] || '').split(',').some((part) => {
        const [encoding, ...params] = part.trim().split(';')
        return encoding === 'gzip' && !params.some((param) => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(param))
      })
      if (!acceptsGzip) return next()
      let entry = cache.get(file)
      if (!entry || entry.etag !== etag) {
        if (cache.size >= 20) cache.delete(cache.keys().next().value)
        entry = { etag, body: readFile(file).then((body) => compress(body, { level: 4 })) }
        cache.set(file, entry)
      }
      const body = await entry.body
      if (res.destroyed) return
      res.setHeader('Content-Type', types[match[3]])
      res.setHeader('Content-Encoding', 'gzip')
      res.setHeader('Content-Length', body.length)
      res.end(req.method === 'HEAD' ? undefined : body)
    } catch {
      cache.delete(file)
      if (!res.headersSent) next()
    }
  }
}

export function lanAssets() {
  let config
  return {
    name: 'lan-assets',
    configResolved(value) { config = value },
    configureServer(server) { server.middlewares.use(assetMiddleware(config.publicDir)) },
    configurePreviewServer(server) { server.middlewares.use(assetMiddleware(resolve(config.root, config.build.outDir), true)) },
  }
}
