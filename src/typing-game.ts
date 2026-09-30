import { TYPING_WORDS } from './typing-words.ts'

type FallingLetter = {
  value: string
  x: number
  y: number
  velocityX: number
  velocityY: number
  gravity: number
  rotation: number
  angularVelocity: number
  size: number
  width: number
  color: string
}

type Person = {
  x: number
  y: number
  velocityX: number
  targetX: number
}

const LETTER_COLORS = ['#91c8ff', '#c2a7ff', '#ff9fc8', '#7ce8d5', '#ffd978', '#ffad83']

const INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
const MEDIALS = [
  ['ㅏ'], ['ㅐ'], ['ㅑ'], ['ㅒ'], ['ㅓ'], ['ㅔ'], ['ㅕ'], ['ㅖ'], ['ㅗ'],
  ['ㅗ', 'ㅏ'], ['ㅗ', 'ㅐ'], ['ㅗ', 'ㅣ'], ['ㅛ'], ['ㅜ'], ['ㅜ', 'ㅓ'],
  ['ㅜ', 'ㅔ'], ['ㅜ', 'ㅣ'], ['ㅠ'], ['ㅡ'], ['ㅡ', 'ㅣ'], ['ㅣ'],
]
const FINALS = [
  [], ['ㄱ'], ['ㄲ'], ['ㄱ', 'ㅅ'], ['ㄴ'], ['ㄴ', 'ㅈ'], ['ㄴ', 'ㅎ'], ['ㄷ'],
  ['ㄹ'], ['ㄹ', 'ㄱ'], ['ㄹ', 'ㅁ'], ['ㄹ', 'ㅂ'], ['ㄹ', 'ㅅ'], ['ㄹ', 'ㅌ'],
  ['ㄹ', 'ㅍ'], ['ㄹ', 'ㅎ'], ['ㅁ'], ['ㅂ'], ['ㅂ', 'ㅅ'], ['ㅅ'], ['ㅆ'],
  ['ㅇ'], ['ㅈ'], ['ㅊ'], ['ㅋ'], ['ㅌ'], ['ㅍ'], ['ㅎ'],
]
const COMPOUND_JAMO: Record<string, string[]> = {
  ㄳ: ['ㄱ', 'ㅅ'], ㄵ: ['ㄴ', 'ㅈ'], ㄶ: ['ㄴ', 'ㅎ'], ㄺ: ['ㄹ', 'ㄱ'],
  ㄻ: ['ㄹ', 'ㅁ'], ㄼ: ['ㄹ', 'ㅂ'], ㄽ: ['ㄹ', 'ㅅ'], ㄾ: ['ㄹ', 'ㅌ'],
  ㄿ: ['ㄹ', 'ㅍ'], ㅀ: ['ㄹ', 'ㅎ'], ㅄ: ['ㅂ', 'ㅅ'],
  ㅘ: ['ㅗ', 'ㅏ'], ㅙ: ['ㅗ', 'ㅐ'], ㅚ: ['ㅗ', 'ㅣ'],
  ㅝ: ['ㅜ', 'ㅓ'], ㅞ: ['ㅜ', 'ㅔ'], ㅟ: ['ㅜ', 'ㅣ'], ㅢ: ['ㅡ', 'ㅣ'],
}

type PhysicalKey = { code: string; shift: boolean }

const DUBEOLSIK_KEYS: Record<string, PhysicalKey> = {
  ㄱ: { code: 'KeyR', shift: false }, ㄲ: { code: 'KeyR', shift: true },
  ㄴ: { code: 'KeyS', shift: false }, ㄷ: { code: 'KeyE', shift: false },
  ㄸ: { code: 'KeyE', shift: true }, ㄹ: { code: 'KeyF', shift: false },
  ㅁ: { code: 'KeyA', shift: false }, ㅂ: { code: 'KeyQ', shift: false },
  ㅃ: { code: 'KeyQ', shift: true }, ㅅ: { code: 'KeyT', shift: false },
  ㅆ: { code: 'KeyT', shift: true }, ㅇ: { code: 'KeyD', shift: false },
  ㅈ: { code: 'KeyW', shift: false }, ㅉ: { code: 'KeyW', shift: true },
  ㅊ: { code: 'KeyC', shift: false }, ㅋ: { code: 'KeyZ', shift: false },
  ㅌ: { code: 'KeyX', shift: false }, ㅍ: { code: 'KeyV', shift: false },
  ㅎ: { code: 'KeyG', shift: false }, ㅏ: { code: 'KeyK', shift: false },
  ㅐ: { code: 'KeyO', shift: false }, ㅑ: { code: 'KeyI', shift: false },
  ㅒ: { code: 'KeyO', shift: true }, ㅓ: { code: 'KeyJ', shift: false },
  ㅔ: { code: 'KeyP', shift: false }, ㅕ: { code: 'KeyU', shift: false },
  ㅖ: { code: 'KeyP', shift: true }, ㅗ: { code: 'KeyH', shift: false },
  ㅛ: { code: 'KeyY', shift: false }, ㅜ: { code: 'KeyN', shift: false },
  ㅠ: { code: 'KeyB', shift: false }, ㅡ: { code: 'KeyM', shift: false },
  ㅣ: { code: 'KeyL', shift: false },
}

function toInputUnits(value: string) {
  const units: string[] = []

  for (const character of value.normalize('NFC').toLowerCase()) {
    const code = character.charCodeAt(0)
    if (code >= 0xac00 && code <= 0xd7a3) {
      const syllableIndex = code - 0xac00
      units.push(INITIALS[Math.floor(syllableIndex / 588)])
      units.push(...MEDIALS[Math.floor((syllableIndex % 588) / 28)])
      units.push(...FINALS[syllableIndex % 28])
    } else if (code >= 0x1100 && code <= 0x1112) {
      // 일부 한글 입력기는 조합 중인 초성을 호환 자모(ㄱ)가 아닌
      // 현대 초성 자모(ᄀ)로 전달한다.
      units.push(INITIALS[code - 0x1100])
    } else if (code >= 0x1161 && code <= 0x1175) {
      units.push(...MEDIALS[code - 0x1161])
    } else if (code >= 0x11a8 && code <= 0x11c2) {
      units.push(...FINALS[code - 0x11a7])
    } else {
      units.push(...(COMPOUND_JAMO[character] ?? [character]))
    }
  }

  return units
}

function toPhysicalKeys(value: string): PhysicalKey[] {
  const keys: PhysicalKey[] = []
  for (const character of value.normalize('NFC')) {
    if (/^[a-z]$/i.test(character)) {
      keys.push({ code: `Key${character.toUpperCase()}`, shift: character === character.toUpperCase() })
      continue
    }
    toInputUnits(character).forEach((unit) => {
      if (DUBEOLSIK_KEYS[unit]) keys.push(DUBEOLSIK_KEYS[unit])
    })
  }
  return keys
}

function isMatchingPhysicalPrefix(input: PhysicalKey[], target: PhysicalKey[]) {
  return input.length <= target.length && input.every((key, index) => {
    const expected = target[index]
    // Shift is essential only for doubled Korean consonants/vowels. Extra
    // Shift/Caps Lock must not reject an otherwise correct English key.
    return key.code === expected.code && (!expected.shift || key.shift)
  })
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function setupTypingGame(
  canvas: HTMLCanvasElement,
  gameOverPanel: HTMLElement,
  resultText: HTMLElement,
  restartButton: HTMLButtonElement,
  wordPrompt: HTMLElement,
  targetWordElement: HTMLElement,
  typingInput: HTMLInputElement,
) {
  const context = canvas.getContext('2d')
  if (!context) return () => {}

  const letters: FallingLetter[] = []
  const person: Person = { x: window.innerWidth / 2, y: window.innerHeight - 42, velocityX: 0, targetX: window.innerWidth / 2 }
  let viewportWidth = window.innerWidth
  let viewportHeight = window.innerHeight
  let pixelRatio = 1
  let backgroundGradient: CanvasGradient
  let running = true
  let typedCount = 0
  let dodgedCount = 0
  let decisionTimer = 0
  let lastFrame = performance.now()
  let animationFrameId = 0
  let disposed = false
  let targetWord = ''
  let previousWord = ''
  let wordQueue: string[] = []
  let validInput = ''
  let physicalProgress = 0
  let mismatchTimer = 0

  const resize = () => {
    const bounds = canvas.getBoundingClientRect()
    viewportWidth = bounds.width
    viewportHeight = bounds.height
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(viewportWidth * pixelRatio)
    canvas.height = Math.round(viewportHeight * pixelRatio)
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    person.y = viewportHeight - 42
    person.x = clamp(person.x, 40, viewportWidth - 40)
    person.targetX = clamp(person.targetX, 40, viewportWidth - 40)

    backgroundGradient = context.createLinearGradient(0, 0, 0, viewportHeight)
    backgroundGradient.addColorStop(0, '#ffffff')
    backgroundGradient.addColorStop(0.72, '#ffffff')
    backgroundGradient.addColorStop(1, '#f7f8fc')
  }

  const renderWordProgress = (inputValue: string, progressOverride?: number) => {
    const typedUnitCount = progressOverride ?? toInputUnits(inputValue).length
    let unitCursor = 0

    targetWordElement.innerHTML = Array.from(targetWord).map((character) => {
      const characterUnitCount = toInputUnits(character).length
      const unitEnd = unitCursor + characterUnitCount
      let className = ''

      if (typedUnitCount >= unitEnd) className = 'is-typed'
      else if (typedUnitCount > unitCursor) className = 'is-current'

      unitCursor = unitEnd
      return `<span${className ? ` class="${className}"` : ''}>${character}</span>`
    }).join('')

    targetWordElement.setAttribute('aria-label', `입력할 단어: ${targetWord}`)
  }

  const chooseNextWord = () => {
    if (!wordQueue.length) {
      wordQueue = [...TYPING_WORDS]
      for (let index = wordQueue.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1))
        ;[wordQueue[index], wordQueue[swapIndex]] = [wordQueue[swapIndex], wordQueue[index]]
      }
      if (wordQueue.at(-1) === previousWord && wordQueue.length > 1) {
        ;[wordQueue[0], wordQueue[wordQueue.length - 1]] = [wordQueue[wordQueue.length - 1], wordQueue[0]]
      }
    }
    targetWord = wordQueue.pop()!
    previousWord = targetWord
    validInput = ''
    physicalProgress = 0
    typingInput.value = ''
    wordPrompt.dataset.language = /^[a-z]+$/i.test(targetWord) ? 'english' : 'korean'
    renderWordProgress('')
  }

  const showMismatch = () => {
    window.clearTimeout(mismatchTimer)
    wordPrompt.classList.remove('has-mismatch')
    void wordPrompt.offsetWidth
    wordPrompt.classList.add('has-mismatch')
    mismatchTimer = window.setTimeout(() => wordPrompt.classList.remove('has-mismatch'), 260)
  }

  const spawnLetter = (value: string) => {
    const characterCount = Array.from(value).length
    const size = clamp(54 - characterCount * 3, 30, 46)
    const estimatedWidth = size * characterCount * (/^[a-z]+$/i.test(value) ? 0.64 : 1.02)
    const safeMargin = Math.min(viewportWidth / 2, Math.max(50, estimatedWidth / 2 + 16))

    letters.push({
      value: value.toUpperCase(),
      x: safeMargin + Math.random() * Math.max(1, viewportWidth - safeMargin * 2),
      y: -size - Math.random() * 45,
      velocityX: (Math.random() - 0.5) * 48,
      velocityY: 38 + Math.random() * 52,
      gravity: 250 + Math.random() * 110,
      rotation: (Math.random() - 0.5) * 0.5,
      angularVelocity: (Math.random() - 0.5) * 2.7,
      size,
      width: estimatedWidth + 20,
      color: LETTER_COLORS[Math.floor(Math.random() * LETTER_COLORS.length)],
    })
    typedCount += 1
  }

  const processInput = (isComposing = false) => {
    if (!running) return

    const candidate = typingInput.value.normalize('NFC')
    const inputKeys = toPhysicalKeys(candidate)
    const targetKeys = toPhysicalKeys(targetWord)

    if (!isMatchingPhysicalPrefix(inputKeys, targetKeys)) {
      if (!isComposing) typingInput.value = validInput
      renderWordProgress(validInput, toPhysicalKeys(validInput).length)
      showMismatch()
      return
    }

    validInput = candidate
    physicalProgress = inputKeys.length
    renderWordProgress(candidate, physicalProgress)

    if (inputKeys.length > 0 && inputKeys.length === targetKeys.length) {
      spawnLetter(targetWord)
      chooseNextWord()
    }
  }

  const handleInput = (event: Event) => {
    processInput((event as InputEvent).isComposing)
  }

  const handleCompositionEnd = () => {
    processInput(false)
  }

  const handlePhysicalKey = (event: KeyboardEvent) => {
    if (!running) return

    if (event.code === 'Backspace') {
      event.preventDefault()
      physicalProgress = Math.max(0, physicalProgress - 1)
      validInput = ''
      typingInput.value = ''
      renderWordProgress('', physicalProgress)
      return
    }

    if (!/^Key[A-Z]$/.test(event.code) || event.repeat) return
    event.preventDefault()
    const expectedKeys = toPhysicalKeys(targetWord)
    const expected = expectedKeys[physicalProgress]
    const requiresShift = expected?.shift ?? false

    if (!expected || event.code !== expected.code || (requiresShift && !event.shiftKey)) {
      showMismatch()
      return
    }

    physicalProgress += 1
    typingInput.value = ''
    renderWordProgress('', physicalProgress)

    if (physicalProgress === expectedKeys.length) {
      spawnLetter(targetWord)
      chooseNextWord()
    }
  }

  const focusInput = () => {
    if (running) typingInput.focus({ preventScroll: true })
  }

  const dangerAt = (candidateX: number) => {
    let danger = 0

    for (const letter of letters) {
      const verticalDistance = person.y - 118 - letter.y
      if (verticalDistance < -30 || verticalDistance > 430) continue

      const timeUntilImpact = Math.max(0, verticalDistance) / Math.max(80, letter.velocityY)
      if (timeUntilImpact > 2.25) continue

      const horizontalDistance = Math.abs(candidateX - letter.x)
      const dangerWidth = 52 + letter.width / 2
      const horizontalRisk = Math.max(0, 1 - horizontalDistance / (dangerWidth * 2.25))
      const urgency = 1.15 - Math.min(1, timeUntilImpact / 2.25)
      danger += horizontalRisk * horizontalRisk * (0.35 + urgency * 2.5)
    }

    danger += Math.abs(candidateX - person.x) / viewportWidth * 0.14
    return danger
  }

  const chooseSafePosition = () => {
    const minimumX = 42
    const maximumX = viewportWidth - 42
    const sampleCount = Math.max(7, Math.floor(viewportWidth / 70))
    let safestX = viewportWidth / 2
    let lowestDanger = Number.POSITIVE_INFINITY

    for (let index = 0; index <= sampleCount; index += 1) {
      const candidateX = minimumX + (index / sampleCount) * (maximumX - minimumX)
      const danger = dangerAt(candidateX)

      if (danger < lowestDanger) {
        lowestDanger = danger
        safestX = candidateX
      }
    }

    person.targetX = safestX
  }

  const updatePerson = (deltaTime: number) => {
    decisionTimer -= deltaTime
    if (decisionTimer <= 0) {
      chooseSafePosition()
      decisionTimer = 0.1
    }

    const desiredVelocity = clamp((person.targetX - person.x) * 4.2, -285, 285)
    person.velocityX += (desiredVelocity - person.velocityX) * Math.min(1, deltaTime * 7)
    person.x += person.velocityX * deltaTime
    person.x = clamp(person.x, 34, viewportWidth - 34)
  }

  const hasCollided = (letter: FallingLetter) => {
    const personLeft = person.x - 29
    const personRight = person.x + 29
    const personTop = person.y - 132
    const personBottom = person.y
    const letterLeft = letter.x - letter.width / 2
    const letterRight = letter.x + letter.width / 2
    const letterTop = letter.y - letter.size * 0.75
    const letterBottom = letter.y + letter.size * 0.75

    return (
      letterRight > personLeft &&
      letterLeft < personRight &&
      letterBottom > personTop &&
      letterTop < personBottom
    )
  }

  const finishGame = () => {
    running = false
    typingInput.disabled = true
    wordPrompt.classList.add('is-paused')
    resultText.textContent = `${typedCount}개의 단어 중 ${dodgedCount}개를 피했어요.`
    gameOverPanel.hidden = false
    restartButton.focus({ preventScroll: true })
  }

  const updateLetters = (deltaTime: number) => {
    for (let index = letters.length - 1; index >= 0; index -= 1) {
      const letter = letters[index]
      letter.velocityY += letter.gravity * deltaTime
      letter.x += letter.velocityX * deltaTime
      letter.y += letter.velocityY * deltaTime
      letter.rotation += letter.angularVelocity * deltaTime

      if (letter.x < letter.width / 2 || letter.x > viewportWidth - letter.width / 2) {
        letter.x = clamp(letter.x, letter.width / 2, viewportWidth - letter.width / 2)
        letter.velocityX *= -0.72
      }

      if (hasCollided(letter)) {
        finishGame()
        return
      }

      if (letter.y - letter.size / 2 > viewportHeight) {
        letters.splice(index, 1)
        dodgedCount += 1
      }
    }
  }

  const getLookDirection = () => {
    let closestLetter: FallingLetter | undefined
    let closestDistance = Number.POSITIVE_INFINITY

    for (const letter of letters) {
      const distance = Math.hypot(letter.x - person.x, letter.y - (person.y - 108))
      if (letter.y < person.y && distance < closestDistance) {
        closestLetter = letter
        closestDistance = distance
      }
    }

    if (!closestLetter) return { x: 0, y: -1 }
    const deltaX = closestLetter.x - person.x
    const deltaY = closestLetter.y - (person.y - 108)
    const distance = Math.hypot(deltaX, deltaY) || 1
    return { x: deltaX / distance, y: deltaY / distance }
  }

  const drawBackground = () => {
    context.globalAlpha = 1
    context.fillStyle = backgroundGradient
    context.fillRect(0, 0, viewportWidth, viewportHeight)

    context.strokeStyle = 'rgba(35, 48, 78, 0.055)'
    context.lineWidth = 1
    for (let y = 80; y < viewportHeight; y += 80) {
      context.beginPath()
      context.moveTo(0, y)
      context.lineTo(viewportWidth, y)
      context.stroke()
    }

    context.fillStyle = 'rgba(31, 42, 68, 0.065)'
    context.fillRect(0, viewportHeight - 34, viewportWidth, 34)
  }

  const drawLetters = () => {
    for (const letter of letters) {
      context.save()
      context.translate(letter.x, letter.y)
      context.rotate(letter.rotation)
      context.font = `800 ${letter.size}px system-ui, sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillStyle = 'rgba(16, 22, 48, 0.78)'
      context.shadowColor = letter.color
      context.shadowBlur = 22
      context.beginPath()
      context.roundRect(-letter.width / 2, -letter.size * 0.72, letter.width, letter.size * 1.44, letter.size * 0.52)
      context.fill()
      context.lineWidth = 1.5
      context.strokeStyle = letter.color
      context.globalAlpha = 0.7
      context.stroke()
      context.globalAlpha = 1
      context.fillStyle = letter.color
      context.shadowColor = letter.color
      context.shadowBlur = 12
      context.fillText(letter.value, 0, 0)
      context.restore()
    }
  }

  const drawPerson = () => {
    const look = getLookDirection()
    const lean = clamp(person.velocityX / 900, -0.16, 0.16)

    context.save()
    context.translate(person.x, person.y)
    context.rotate(lean)

    context.fillStyle = 'rgba(4, 7, 18, 0.34)'
    context.beginPath()
    context.ellipse(0, 4, 35, 9, 0, 0, Math.PI * 2)
    context.fill()

    context.strokeStyle = '#151b32'
    context.lineWidth = 13
    context.lineCap = 'round'
    context.beginPath()
    context.moveTo(-13, -42)
    context.lineTo(-16, -6)
    context.moveTo(13, -42)
    context.lineTo(16, -6)
    context.stroke()

    context.fillStyle = '#5d6ce8'
    context.beginPath()
    context.roundRect(-27, -91, 54, 58, 18)
    context.fill()

    context.strokeStyle = '#f2c6a8'
    context.lineWidth = 10
    context.beginPath()
    context.moveTo(-24, -76)
    context.lineTo(-37, -49)
    context.moveTo(24, -76)
    context.lineTo(37, -49)
    context.stroke()

    context.save()
    context.translate(look.x * 4, -112 + look.y * 2)
    context.rotate(look.x * 0.11)
    context.fillStyle = '#f2c6a8'
    context.beginPath()
    context.arc(0, 0, 27, 0, Math.PI * 2)
    context.fill()

    context.fillStyle = '#20263d'
    context.beginPath()
    context.arc(0, -8, 27, Math.PI, Math.PI * 2)
    context.lineTo(23, -2)
    context.quadraticCurveTo(3, -13, -24, -2)
    context.closePath()
    context.fill()

    const pupilX = look.x * 3.5
    const pupilY = clamp(look.y * 3.5, -3.5, 2)
    context.fillStyle = '#ffffff'
    context.beginPath()
    context.ellipse(-9, 1, 6, 7, 0, 0, Math.PI * 2)
    context.ellipse(9, 1, 6, 7, 0, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#22283a'
    context.beginPath()
    context.arc(-9 + pupilX, 1 + pupilY, 2.6, 0, Math.PI * 2)
    context.arc(9 + pupilX, 1 + pupilY, 2.6, 0, Math.PI * 2)
    context.fill()

    context.strokeStyle = '#8f5f54'
    context.lineWidth = 2
    context.beginPath()
    context.arc(0, 9, 5, 0.15, Math.PI - 0.15)
    context.stroke()
    context.restore()

    context.restore()
  }

  const render = (now: number) => {
    if (disposed) return
    if (document.hidden) { lastFrame = now; animationFrameId = requestAnimationFrame(render); return }
    const deltaTime = Math.min(0.033, (now - lastFrame) / 1000)
    lastFrame = now

    if (running) {
      updatePerson(deltaTime)
      updateLetters(deltaTime)
    }

    drawBackground()
    drawLetters()
    drawPerson()
    animationFrameId = requestAnimationFrame(render)
  }

  const restart = () => {
    letters.length = 0
    typedCount = 0
    dodgedCount = 0
    decisionTimer = 0
    person.x = viewportWidth / 2
    person.targetX = person.x
    person.velocityX = 0
    running = true
    typingInput.disabled = false
    wordPrompt.classList.remove('is-paused')
    gameOverPanel.hidden = true
    chooseNextWord()
    focusInput()
    restartButton.blur()
  }

  const handleRestartKey = (event: KeyboardEvent) => {
    if (running || event.key !== 'Enter' || event.repeat) return
    event.preventDefault()
    restart()
  }

  window.addEventListener('resize', resize)
  window.addEventListener('keydown', handleRestartKey)
  typingInput.addEventListener('input', handleInput)
  typingInput.addEventListener('keydown', handlePhysicalKey)
  typingInput.addEventListener('compositionend', handleCompositionEnd)
  canvas.addEventListener('pointerdown', focusInput)
  restartButton.addEventListener('click', restart)

  resize()
  chooseNextWord()
  focusInput()
  animationFrameId = requestAnimationFrame(render)

  return () => {
    disposed = true
    window.clearTimeout(mismatchTimer)
    cancelAnimationFrame(animationFrameId)
    window.removeEventListener('resize', resize)
    window.removeEventListener('keydown', handleRestartKey)
    typingInput.removeEventListener('input', handleInput)
    typingInput.removeEventListener('keydown', handlePhysicalKey)
    typingInput.removeEventListener('compositionend', handleCompositionEnd)
    canvas.removeEventListener('pointerdown', focusInput)
    restartButton.removeEventListener('click', restart)
  }
}
