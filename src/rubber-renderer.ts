type Point = { x: number; y: number }
type Pull = { anchorIndex: number; offset: Point; displacement: Point }
const FACE_CONTOUR = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]

// One continuous camera surface: local pulls stretch the face without a
// second unwarped camera/face layer appearing beneath it.
export function createRubberRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false })
  if (!gl) throw new Error('WebGL을 사용할 수 없습니다.')
  const shaders: WebGLShader[] = []
  const shader = (type: number, source: string) => {
    const value = gl.createShader(type)!
    gl.shaderSource(value, source); gl.compileShader(value)
    if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(value)
      gl.deleteShader(value); shaders.forEach(item => gl.deleteShader(item))
      throw new Error(error || '셰이더 컴파일 실패')
    }
    shaders.push(value); return value
  }
  const vertex = shader(gl.VERTEX_SHADER, `
    attribute vec2 a_position;
    varying vec2 v_screen;
    void main() { gl_Position = vec4(a_position, 0., 1.); v_screen = vec2(a_position.x * .5 + .5, .5 - a_position.y * .5); }
  `)
  const fragment = shader(gl.FRAGMENT_SHADER, `
    precision highp float;
    uniform sampler2D u_camera;
    uniform vec2 u_size;
    uniform vec4 u_cover;
    uniform vec4 u_pull[2];
    uniform vec2 u_radius;
    uniform sampler2D u_faceMask;
    uniform vec4 u_faceBounds;
    varying vec2 v_screen;
    float faceWeight(vec2 p) {
      vec2 uv = (p - u_faceBounds.xy) / u_faceBounds.zw;
      if (any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) return 0.;
      vec4 mask = texture2D(u_faceMask, vec2(uv.x, 1. - uv.y));
      return mask.r * mask.a;
    }
    vec2 unpull(vec2 p, vec4 pull, float radius) {
      if (radius < 1.) return p;
      vec2 low = min(pull.xy, pull.xy + pull.zw) - vec2(radius);
      vec2 high = max(pull.xy, pull.xy + pull.zw) + vec2(radius);
      if (any(lessThan(p, low)) || any(greaterThan(p, high))) return p;
      // Backwards integrate a translating compact-support velocity field.
      // Sixteen small steps prevent the foldovers of direct mesh displacement.
      for (int step = 0; step < 16; step++) {
        float t = 1. - (float(step) + .5) / 16.;
        vec2 relative = (p - pull.xy - pull.zw * t) / radius;
        float weight = 1. - smoothstep(0., 1., dot(relative, relative));
        p -= pull.zw * (weight / 16.);
      }
      return p;
    }
    void main() {
      vec2 p = v_screen * u_size;
      vec2 warped = unpull(p, u_pull[1], u_radius.y);
      warped = unpull(warped, u_pull[0], u_radius.x);
      vec2 faceUv = (warped - u_cover.xy) / u_cover.zw;
      vec4 face = texture2D(u_camera, vec2(1. - faceUv.x, 1. - faceUv.y));
      gl_FragColor = face;
    }
  `)
  const program = gl.createProgram()!
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program)
    shaders.forEach(item => gl.deleteShader(item)); gl.deleteProgram(program)
    throw new Error(error || '셰이더 연결 실패')
  }
  gl.useProgram(program)
  const buffer = gl.createBuffer()!, texture = gl.createTexture()!
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.uniform1i(gl.getUniformLocation(program, 'u_camera'), 0)
  const sizeLocation = gl.getUniformLocation(program, 'u_size')
  const coverLocation = gl.getUniformLocation(program, 'u_cover')
  const pullsLocation = gl.getUniformLocation(program, 'u_pull[0]')
  const radiusLocation = gl.getUniformLocation(program, 'u_radius')
  const boundsLocation = gl.getUniformLocation(program, 'u_faceBounds')
  const maskTexture = gl.createTexture()!
  const maskCanvas = document.createElement('canvas'), innerCanvas = document.createElement('canvas')
  maskCanvas.width = maskCanvas.height = innerCanvas.width = innerCanvas.height = 192
  const maskContext = maskCanvas.getContext('2d')!, innerContext = innerCanvas.getContext('2d')!
  const bounds = new Float32Array([0, 0, 1, 1])
  let maskKey = ''
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, maskTexture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas)
  gl.uniform1i(gl.getUniformLocation(program, 'u_faceMask'), 1)
  gl.activeTexture(gl.TEXTURE0)
  const updateMask = (points: Point[] | null) => {
    const key = points ? FACE_CONTOUR.map(i => `${points[i].x.toFixed(2)},${points[i].y.toFixed(2)}`).join(';') : ''
    if (key === maskKey) return
    maskKey = key
    maskContext.clearRect(0, 0, 192, 192)
    if (points) {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
      for (const i of FACE_CONTOUR) { left = Math.min(left, points[i].x); top = Math.min(top, points[i].y); right = Math.max(right, points[i].x); bottom = Math.max(bottom, points[i].y) }
      bounds.set([left - 2, top - 2, Math.max(1, right - left + 4), Math.max(1, bottom - top + 4)])
      const path = new Path2D()
      FACE_CONTOUR.forEach((i, n) => {
        const x = (points[i].x - bounds[0]) / bounds[2] * 192, y = (points[i].y - bounds[1]) / bounds[3] * 192
        if (n) path.lineTo(x, y); else path.moveTo(x, y)
      })
      path.closePath()
      innerContext.clearRect(0, 0, 192, 192)
      innerContext.fillStyle = '#fff'; innerContext.fill(path)
      innerContext.strokeStyle = '#000'; innerContext.lineWidth = 3; innerContext.lineJoin = 'round'; innerContext.stroke(path)
      maskContext.save(); maskContext.clip(path); maskContext.filter = 'blur(2px)'
      maskContext.drawImage(innerCanvas, 0, 0); maskContext.restore()
    }
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, maskTexture)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas)
    gl.activeTexture(gl.TEXTURE0)
  }
  const handles = new Float32Array(8), radii = new Float32Array(2)
  let uploadedTime = -1, textureWidth = 0, textureHeight = 0
  const draw = (video: HTMLVideoElement, width: number, height: number, points: Point[] | null, pulls: Iterable<Pull>) => {
    gl.viewport(0, 0, canvas.width, canvas.height)
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) {
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); return
    }
    if (uploadedTime !== video.currentTime || textureWidth !== video.videoWidth || textureHeight !== video.videoHeight) {
      if (textureWidth !== video.videoWidth || textureHeight !== video.videoHeight) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
        textureWidth = video.videoWidth; textureHeight = video.videoHeight
      } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video)
      uploadedTime = video.currentTime
    }
    const scale = Math.max(width / textureWidth, height / textureHeight)
    const drawnWidth = textureWidth * scale, drawnHeight = textureHeight * scale
    gl.uniform2f(sizeLocation, width, height)
    gl.uniform4f(coverLocation, (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight)
    updateMask(points)
    gl.uniform4fv(boundsLocation, bounds)
    handles.fill(0); radii.fill(0)
    if (points) {
      const faceWidth = Math.max(80, Math.hypot(points[234].x - points[454].x, points[234].y - points[454].y))
      let i = 0
      for (const pull of pulls) {
        if (i === 2) break
        const anchor = points[pull.anchorIndex]
        const stretch = Math.hypot(pull.displacement.x, pull.displacement.y)
        handles[i * 4] = anchor.x + pull.offset.x; handles[i * 4 + 1] = anchor.y + pull.offset.y
        handles[i * 4 + 2] = pull.displacement.x; handles[i * 4 + 3] = pull.displacement.y
        radii[i] = stretch > .01 ? faceWidth * .42 : 0
        i++
      }
    }
    gl.uniform4fv(pullsLocation, handles); gl.uniform2fv(radiusLocation, radii)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }
  return { draw, dispose: () => { gl.deleteTexture(texture); gl.deleteTexture(maskTexture); gl.deleteBuffer(buffer); gl.deleteProgram(program); shaders.forEach(value => gl.deleteShader(value)) } }
}
