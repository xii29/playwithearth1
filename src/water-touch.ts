import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const WASM_ROOT = `${import.meta.env.BASE_URL}mediapipe/wasm`
const MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe/models/hand_landmarker.task`
const FINGERTIP_INDICES = [4, 8, 12, 16, 20]

type Landmark = { x: number; y: number; z: number }
type Point = { x: number; y: number }
type TouchProfile = {
  impact: number
  radius: number
  wakeForce: number
  pulseInterval: number
}
type TouchPoint = {
  targetX: number
  targetY: number
  lastSeen: number
  lastPulse: number
} & TouchProfile

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))

class RippleField {
  width = 1
  height = 1
  private current = new Float32Array(1)
  private previous = new Float32Array(1)
  private next = new Float32Array(1)
  pixels = new Uint8Array(1)

  resize(viewWidth: number, viewHeight: number) {
    const aspect = viewWidth / Math.max(1, viewHeight)
    if (aspect >= 1) {
      this.width = 250
      this.height = Math.max(92, Math.round(this.width / aspect))
    } else {
      this.height = 250
      this.width = Math.max(92, Math.round(this.height * aspect))
    }
    const length = this.width * this.height
    this.current = new Float32Array(length)
    this.previous = new Float32Array(length)
    this.next = new Float32Array(length)
    this.pixels = new Uint8Array(length)
    this.pixels.fill(128)
  }

  disturb(viewX: number, viewY: number, viewWidth: number, viewHeight: number, strength: number, radius: number) {
    const centerX = clamp(viewX / viewWidth, 0, 1) * (this.width - 1)
    const centerY = (1 - clamp(viewY / viewHeight, 0, 1)) * (this.height - 1)
    const pixelRadius = Math.max(1, radius)
    const startX = Math.max(1, Math.floor(centerX - pixelRadius * 2.1))
    const endX = Math.min(this.width - 2, Math.ceil(centerX + pixelRadius * 2.1))
    const startY = Math.max(1, Math.floor(centerY - pixelRadius * 2.1))
    const endY = Math.min(this.height - 2, Math.ceil(centerY + pixelRadius * 2.1))
    const radiusSquared = pixelRadius * pixelRadius

    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const distanceSquared = (x - centerX) ** 2 + (y - centerY) ** 2
        const falloff = Math.exp(-distanceSquared / (radiusSquared * 0.72))
        const index = y * this.width + x
        this.current[index] = clamp(this.current[index] + strength * falloff, -1.15, 1.15)
      }
    }
  }

  step() {
    const width = this.width
    const height = this.height
    for (let y = 1; y < height - 1; y += 1) {
      const row = y * width
      for (let x = 1; x < width - 1; x += 1) {
        const index = row + x
        const wave = (
          this.current[index - 1]
          + this.current[index + 1]
          + this.current[index - width]
          + this.current[index + width]
        ) * 0.5 - this.previous[index]
        this.next[index] = wave * 0.994
      }
    }
    const recycled = this.previous
    this.previous = this.current
    this.current = this.next
    this.next = recycled

    for (let index = 0; index < this.current.length; index += 1) {
      this.pixels[index] = Math.round(clamp(128 + this.current[index] * 104, 0, 255))
    }
  }
}

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Shader could not be created.')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unknown shader error.'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

function createWaterRenderer(canvas: HTMLCanvasElement, field: RippleField) {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    preserveDrawingBuffer: true,
    powerPreference: 'low-power',
  })
  if (!gl) throw new Error('WebGL is unavailable.')

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `)
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform sampler2D u_camera;
    uniform sampler2D u_wave;
    uniform vec2 u_waveTexel;
    uniform vec2 u_videoCrop;
    uniform float u_ready;
    varying vec2 v_uv;

    vec3 cameraAt(vec2 screenUv, vec2 offset) {
      vec2 sourceUv = (screenUv + offset - 0.5) * u_videoCrop + 0.5;
      sourceUv.x = 1.0 - sourceUv.x;
      return texture2D(u_camera, clamp(sourceUv, 0.001, 0.999)).rgb;
    }

    void main() {
      if (u_ready < 0.5) {
        float glow = 1.0 - distance(v_uv, vec2(0.5, 0.46));
        vec3 deep = vec3(0.018, 0.095, 0.13);
        vec3 light = vec3(0.035, 0.23, 0.28);
        gl_FragColor = vec4(mix(deep, light, max(0.0, glow) * 0.55), 1.0);
        return;
      }

      float center = (texture2D(u_wave, v_uv).r - 0.5) * 2.0;
      float left = (texture2D(u_wave, v_uv - vec2(u_waveTexel.x, 0.0)).r - 0.5) * 2.0;
      float right = (texture2D(u_wave, v_uv + vec2(u_waveTexel.x, 0.0)).r - 0.5) * 2.0;
      float down = (texture2D(u_wave, v_uv - vec2(0.0, u_waveTexel.y)).r - 0.5) * 2.0;
      float up = (texture2D(u_wave, v_uv + vec2(0.0, u_waveTexel.y)).r - 0.5) * 2.0;
      vec2 slope = vec2(right - left, up - down);
      float energy = length(slope);
      float curvature = abs(left + right + up + down - center * 4.0);
      vec2 refraction = clamp(slope * (0.105 + energy * 0.045), vec2(-0.026), vec2(0.026));

      // Refract every channel through the same point. The old shader split RGB
      // and added cyan caustics, which read as a graphic effect rather than water.
      vec3 color = cameraAt(v_uv, refraction);
      float wavePresence = smoothstep(0.018, 0.24, energy + curvature * 0.72);
      vec3 normal = normalize(vec3(-slope * 3.1, 1.0));
      vec3 lightDirection = normalize(vec3(-0.34, 0.46, 0.82));
      float surfaceLight = (dot(normal, lightDirection) - 0.82) * 0.34;
      float crestLight = smoothstep(0.055, 0.30, curvature) * 0.075;
      color *= 1.0 + wavePresence * surfaceLight + crestLight;
      gl_FragColor = vec4(color, 1.0);
    }
  `)

  const program = gl.createProgram()
  if (!program) throw new Error('WebGL program could not be created.')
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'WebGL link failed.')
  gl.useProgram(program)

  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

  const cameraTexture = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, cameraTexture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([5, 29, 38, 255]))

  const waveTexture = gl.createTexture()
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, waveTexture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  const cameraUniform = gl.getUniformLocation(program, 'u_camera')
  const waveUniform = gl.getUniformLocation(program, 'u_wave')
  const waveTexelUniform = gl.getUniformLocation(program, 'u_waveTexel')
  const videoCropUniform = gl.getUniformLocation(program, 'u_videoCrop')
  const readyUniform = gl.getUniformLocation(program, 'u_ready')
  gl.uniform1i(cameraUniform, 0)
  gl.uniform1i(waveUniform, 1)

  let lastFieldWidth = 0
  let lastFieldHeight = 0
  let cameraTextureWidth = 0
  let cameraTextureHeight = 0
  let lastUploadedVideoTime = -1

  const draw = (video: HTMLVideoElement, ready: boolean, viewWidth: number, viewHeight: number) => {
    gl.viewport(0, 0, canvas.width, canvas.height)
    if (ready && video.currentTime !== lastUploadedVideoTime) {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, cameraTexture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      if (cameraTextureWidth !== video.videoWidth || cameraTextureHeight !== video.videoHeight) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
        cameraTextureWidth = video.videoWidth
        cameraTextureHeight = video.videoHeight
      } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video)
      lastUploadedVideoTime = video.currentTime
    }

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, waveTexture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    // The height field uses one byte per texel. Its width is commonly 250,
    // which is not compatible with WebGL's default four-byte row alignment.
    // Without this, the driver expects padding after every row and rejects the
    // tightly packed Uint8Array, leaving the wave texture empty.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    if (field.width !== lastFieldWidth || field.height !== lastFieldHeight) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, field.width, field.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, field.pixels)
      lastFieldWidth = field.width
      lastFieldHeight = field.height
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, field.width, field.height, gl.LUMINANCE, gl.UNSIGNED_BYTE, field.pixels)
    }

    const videoWidth = video.videoWidth || 1280
    const videoHeight = video.videoHeight || 720
    const videoAspect = videoWidth / videoHeight
    const viewAspect = viewWidth / Math.max(1, viewHeight)
    const cropX = videoAspect > viewAspect ? viewAspect / videoAspect : 1
    const cropY = videoAspect > viewAspect ? 1 : videoAspect / viewAspect
    gl.uniform2f(waveTexelUniform, 1 / field.width, 1 / field.height)
    gl.uniform2f(videoCropUniform, cropX, cropY)
    gl.uniform1f(readyUniform, ready ? 1 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  const dispose = () => {
    gl.deleteTexture(cameraTexture)
    gl.deleteTexture(waveTexture)
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
  }

  return { draw, dispose }
}

export function setupWaterTouch(root: HTMLElement) {
  const stage = root.querySelector<HTMLElement>('.water-camera-stage')!
  const video = root.querySelector<HTMLVideoElement>('#water-camera')!
  const surface = root.querySelector<HTMLCanvasElement>('#water-surface')!
  const toggleButton = root.querySelector<HTMLButtonElement>('#water-camera-toggle')!
  const status = root.querySelector<HTMLElement>('#water-status')!
  const fingerCount = root.querySelector<HTMLElement>('#water-finger-count')!
  const field = new RippleField()
  let renderer: ReturnType<typeof createWaterRenderer> | null = null
  try {
    renderer = createWaterRenderer(surface, field)
  } catch {
    root.classList.add('water-no-webgl')
    status.textContent = '이 브라우저에서는 수면 왜곡을 표시할 수 없어요.'
  }

  const lowPowerDevice = window.matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
  // Water simulation continues at display rate; 24fps landmarks avoid blocking
  // the main thread with model inference on every visual frame.
  const inferenceInterval = 1000 / (lowPowerDevice ? 20 : 24)
  const maximumPixelRatio = lowPowerDevice ? 1.25 : 1.6
  const touches = new Map<string, TouchPoint>()

  let landmarker: HandLandmarker | null = null
  let visionPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null
  let cameraStream: MediaStream | null = null
  let animationFrame = 0
  let disposed = false
  let starting = false
  let cameraActive = false
  let cameraRequest = 0
  let width = 1
  let height = 1
  let pixelRatio = 1
  let lastVideoTime = -1
  let lastDetectionTime = -Infinity
  let lastStatus = ''

  const say = (message: string) => {
    if (lastStatus === message) return
    lastStatus = message
    status.textContent = message
  }

  const resize = () => {
    const bounds = stage.getBoundingClientRect()
    width = Math.max(1, bounds.width)
    height = Math.max(1, bounds.height)
    pixelRatio = Math.min(window.devicePixelRatio || 1, maximumPixelRatio)
    surface.width = Math.round(width * pixelRatio)
    surface.height = Math.round(height * pixelRatio)
    field.resize(width, height)
  }

  const project = (landmark: Landmark): Point => {
    const videoWidth = video.videoWidth || 1280
    const videoHeight = video.videoHeight || 720
    const scale = Math.max(width / videoWidth, height / videoHeight)
    const drawnWidth = videoWidth * scale
    const drawnHeight = videoHeight * scale
    return {
      x: (width - drawnWidth) * 0.5 + (1 - landmark.x) * drawnWidth,
      y: (height - drawnHeight) * 0.5 + landmark.y * drawnHeight,
    }
  }

  const makeWake = (from: Point, to: Point, force: number, radius: number) => {
    const deltaX = to.x - from.x
    const deltaY = to.y - from.y
    const distance = Math.hypot(deltaX, deltaY)
    if (distance < 0.8 || distance > Math.min(width, height) * 0.38) return
    const unitX = deltaX / distance
    const unitY = deltaY / distance
    const sideX = -unitY
    const sideY = unitX
    const speed = clamp(distance / 34, 0.12, 1.7)
    const spacing = lowPowerDevice ? 14 : 10
    const steps = Math.max(1, Math.ceil(distance / spacing))

    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps
      const x = from.x + deltaX * progress
      const y = from.y + deltaY * progress
      const bank = radius * 1.65 + speed * 3.5
      const wakeRadius = clamp(radius * 0.62 + speed * 0.55, 1.8, 8.5)
      const bankRadius = clamp(radius * 0.44, 1.25, 5.2)
      field.disturb(x, y, width, height, -0.20 * speed * force, wakeRadius)
      field.disturb(x + sideX * bank, y + sideY * bank, width, height, 0.076 * speed * force, bankRadius)
      field.disturb(x - sideX * bank, y - sideY * bank, width, height, 0.076 * speed * force, bankRadius)
    }
  }

  const updateTouch = (id: string, point: Point, now: number, profile: TouchProfile) => {
    const touch = touches.get(id)
    if (!touch) {
      touches.set(id, {
        targetX: point.x,
        targetY: point.y,
        lastSeen: now,
        lastPulse: now,
        ...profile,
      })
      field.disturb(point.x, point.y, width, height, -profile.impact, profile.radius)
      return
    }

    touch.impact += (profile.impact - touch.impact) * 0.45
    touch.radius += (profile.radius - touch.radius) * 0.45
    touch.wakeForce += (profile.wakeForce - touch.wakeForce) * 0.45
    touch.pulseInterval = profile.pulseInterval
    makeWake({ x: touch.targetX, y: touch.targetY }, point, touch.wakeForce, touch.radius)
    touch.targetX = point.x
    touch.targetY = point.y
    touch.lastSeen = now
  }

  const getHandInfluence = (landmarks: Landmark[]) => {
    const planarDistance = (firstIndex: number, secondIndex: number) => Math.hypot(
      landmarks[firstIndex].x - landmarks[secondIndex].x,
      landmarks[firstIndex].y - landmarks[secondIndex].y,
    )
    const palmLength = Math.max(0.001, planarDistance(0, 9))
    const palmWidth = Math.max(0.001, planarDistance(5, 17))
    const visiblePalmSize = Math.sqrt(palmLength * palmWidth)
    const scale = clamp(visiblePalmSize / 0.135, 0.62, 2.2)
    const averageTipDistance = [8, 12, 16, 20].reduce(
      (sum, landmarkIndex) => sum + planarDistance(0, landmarkIndex),
      0,
    ) / 4
    const palmLandmarks = [0, 5, 9, 13, 17].map((landmarkIndex) => project(landmarks[landmarkIndex]))
    const palm = palmLandmarks.reduce(
      (sum, point) => ({ x: sum.x + point.x / palmLandmarks.length, y: sum.y + point.y / palmLandmarks.length }),
      { x: 0, y: 0 },
    )

    return { fist: averageTipDistance / palmLength < 1.62, palm, scale }
  }

  const updateTracking = (time: number) => {
    if (!cameraActive || !landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    if (video.currentTime === lastVideoTime || time - lastDetectionTime < inferenceInterval) return
    lastVideoTime = video.currentTime
    lastDetectionTime = time
    const result = landmarker.detectForVideo(video, time)
    let detectedFingerCount = 0
    let fistCount = 0
    const handLabels = result.landmarks.map((_, handIndex) => (
      result.handedness[handIndex]?.[0]?.categoryName?.toLowerCase() === 'left' ? 'left' : 'right'
    ))

    result.landmarks.forEach((rawLandmarks, handIndex) => {
      const landmarks = rawLandmarks as Landmark[]
      const handedness = handLabels[handIndex]
      const handId = handLabels.filter((label) => label === handedness).length > 1 ? `${handedness}-${handIndex}` : handedness
      const hand = getHandInfluence(landmarks)
      detectedFingerCount += FINGERTIP_INDICES.length

      if (hand.fist) {
        const id = `${handId}-fist`
        fistCount += 1
        updateTouch(id, hand.palm, time, {
          impact: clamp(0.82 + hand.scale * 0.25, 0.96, 1.15),
          radius: clamp(6.4 + hand.scale * 3.2, 8.4, 13.4),
          wakeForce: clamp(hand.scale * 1.8, 1.35, 3.5),
          pulseInterval: clamp(450 - hand.scale * 55, 310, 410),
        })
      } else {
        const profile: TouchProfile = {
          impact: clamp(hand.scale * 0.68, 0.44, 1.1),
          radius: clamp(2.45 + hand.scale * 0.92, 3.0, 4.6),
          wakeForce: clamp(0.62 + hand.scale * 0.55, 0.82, 1.84),
          pulseInterval: clamp(650 - hand.scale * 86, 445, 595),
        }
        FINGERTIP_INDICES.forEach((landmarkIndex, fingerIndex) => {
          const id = `${handId}-${fingerIndex}`
          updateTouch(id, project(landmarks[landmarkIndex]), time, profile)
        })
      }
    })

    fingerCount.textContent = `${detectedFingerCount} / 10`
    root.classList.toggle('has-water-touch', detectedFingerCount > 0)
    if (fistCount >= 2) say('두 주먹으로 더 넓고 강한 물결을 만들고 있어요.')
    else if (fistCount === 1) say('주먹으로 더 넓고 강한 물결을 만들고 있어요.')
    else if (detectedFingerCount >= 10) say('양손의 열 손가락을 모두 따라가고 있어요.')
    else if (detectedFingerCount > 0) say(`${detectedFingerCount}개의 손끝이 수면에 닿았어요.`)
    else say('손끝을 움직이거나 주먹을 쥐면 물결이 시작돼요.')
  }

  const updateTouches = (time: number) => {
    touches.forEach((touch, id) => {
      const age = time - touch.lastSeen
      const visible = age < 190

      if (visible && time - touch.lastPulse > touch.pulseInterval) {
        field.disturb(touch.targetX, touch.targetY, width, height, -touch.impact * 0.52, touch.radius * 0.78)
        touch.lastPulse = time
      }
      if (age > 700) touches.delete(id)
    })
  }

  const getVision = () => {
    visionPromise ??= FilesetResolver.forVisionTasks(WASM_ROOT)
    return visionPromise
  }

  const ensureLandmarker = async () => {
    if (landmarker) return landmarker
    say('열 손가락을 인식할 모델을 준비하고 있어요…')
    const vision = await getVision()
    if (disposed) throw new Error('WaterTouch has been disposed.')
    const created = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })
    if (disposed) {
      created.close()
      throw new Error('WaterTouch has been disposed.')
    }
    landmarker = created
    return created
  }

  const stopCamera = () => {
    cameraRequest += 1
    cameraActive = false
    touches.clear()
    cameraStream?.getTracks().forEach((track) => track.stop())
    cameraStream = null
    video.srcObject = null
    fingerCount.textContent = '0 / 10'
    root.classList.remove('is-camera-active', 'has-water-touch')
    toggleButton.textContent = '카메라 시작'
    toggleButton.classList.remove('is-active')
    say('카메라가 꺼졌어요.')
  }

  const startCamera = async () => {
    if (starting || disposed) return
    if (!renderer) {
      say('WebGL을 지원하는 브라우저에서 WaterTouch를 사용할 수 있어요.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      say('이 브라우저에서는 카메라를 사용할 수 없어요.')
      return
    }
    starting = true
    const request = ++cameraRequest
    toggleButton.disabled = true
    say('카메라 권한을 요청하고 있어요…')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        audio: false,
      })
      if (disposed || request !== cameraRequest) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      cameraStream = stream
      video.srcObject = stream
      await video.play()
      cameraActive = true
      root.classList.add('is-camera-active')
      await ensureLandmarker()
      if (disposed || request !== cameraRequest) return
      lastVideoTime = -1
      lastDetectionTime = -Infinity
      toggleButton.textContent = '카메라 끄기'
      toggleButton.classList.add('is-active')
      say('손끝을 움직이거나 주먹을 쥐고, 카메라 가까이 가져와 보세요.')
    } catch {
      cameraStream?.getTracks().forEach((track) => track.stop())
      cameraStream = null
      cameraActive = false
      video.srcObject = null
      root.classList.remove('is-camera-active')
      say('카메라 또는 손 인식 모델을 준비하지 못했어요. 권한과 인터넷 연결을 확인해 주세요.')
    } finally {
      starting = false
      toggleButton.disabled = false
    }
  }

  const draw = (time: number) => {
    if (disposed) return
    if (!document.hidden) {
      updateTracking(time)
      updateTouches(time)
      if (cameraActive || touches.size > 0) field.step()
      renderer?.draw(video, cameraActive && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA, width, height)
    }
    animationFrame = requestAnimationFrame(draw)
  }

  const toggleCamera = () => {
    if (cameraActive || cameraStream) stopCamera()
    else void startCamera()
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(stage)
  toggleButton.addEventListener('click', toggleCamera)
  resize()
  animationFrame = requestAnimationFrame(draw)

  return () => {
    disposed = true
    cameraRequest += 1
    cancelAnimationFrame(animationFrame)
    resizeObserver.disconnect()
    toggleButton.removeEventListener('click', toggleCamera)
    cameraStream?.getTracks().forEach((track) => track.stop())
    video.srcObject = null
    landmarker?.close()
    renderer?.dispose()
  }
}
