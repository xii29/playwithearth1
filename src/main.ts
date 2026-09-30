import './style.css'
import { bodyTemplate } from './body-template'
import { moneyTemplate } from './money-template'
import { afterglowTemplate } from './afterglow'
import { setupCaptureControl } from './capture-control.ts'

type ExampleName = 'home' | 'space' | 'typing' | 'claw' | 'sampler' | 'hand' | 'water' | 'balloon' | 'lab' | 'rubber' | 'shampoo' | 'doodle' | 'travel' | 'aquarium' | 'sniper' | 'earth' | 'body-fx' | 'money' | 'afterglow'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <div class="site-shell">
    <header class="topbar">
      <nav class="example-nav" aria-label="갤러리 탐색">
        <button type="button" data-example="home" aria-label="첫 화면 갤러리로 뒤로가기">← 뒤로가기</button>
      </nav>
    </header>
    <div id="example-stage" class="example-stage" aria-live="polite"></div>
    <video id="global-capture-video" class="global-capture-video" autoplay muted playsinline aria-hidden="true"></video>
    <button id="global-capture-button" class="global-capture-button" type="button" aria-label="사진 촬영 또는 길게 눌러 동영상 녹화">
      <span aria-hidden="true"></span>
    </button>
    <p id="global-capture-status" class="global-capture-status" aria-live="polite"></p>
  </div>
`

const stage = document.querySelector<HTMLDivElement>('#example-stage')!
const navigation = document.querySelector<HTMLElement>('.example-nav')!
let disposeCurrentExample = () => {}
let exampleRequest = 0
let disposeCaptureControl = () => {}
let activeExample: ExampleName | null = null
function releaseCurrentExample() {
  const cleanups = [disposeCurrentExample, disposeCaptureControl]
  disposeCurrentExample = () => {}
  disposeCaptureControl = () => {}
  for (const cleanup of cleanups) {
    try { cleanup() } catch (error) { console.warn('Example cleanup failed:', error) }
  }
  // A failed example cleanup must not leave a camera running or block navigation.
  for (const video of stage.querySelectorAll('video')) {
    if (video.srcObject instanceof MediaStream) video.srcObject.getTracks().forEach((track) => track.stop())
    video.pause(); video.srcObject = null
  }
}

const exampleTemplates: Record<ExampleName, () => string> = {
  home: () => '<main class="example-gallery" aria-label="인터랙션 플레이그라운드"></main>',
  'body-fx': () => bodyTemplate(),
  money: () => moneyTemplate(),
  afterglow: () => afterglowTemplate(),
  earth: () => `
    <main class="earth-example example-view earth-space-edition">
      <div class="earth-space-logo"><img src="${import.meta.env.BASE_URL}logo.webp" alt="모여봐요 동물의 숲" width="639" height="246" draggable="false"></div>
      <button id="earth-music" type="button" aria-pressed="false">♫ 음악 켜기</button>
      <p id="earth-event-status" role="status" class="earth-event-status">별 사이 작은 행성, 동물 친구들의 우주 마을</p>
      <canvas id="earth-canvas" aria-label="드래그로 회전하고 휠 또는 두 손가락으로 확대하는 3D 지구본"></canvas>
      <div class="earth-population"><i></i> 주민 <strong id="earth-count">0</strong>명</div>
      <div class="earth-bottom"><p id="earth-status" role="status">행성을 드래그해 둘러보고 동물 친구들에게 말을 걸어 보세요.</p><button id="earth-join" type="button">＋ 입주하기</button> <button id="earth-meeting" type="button">주민 회의</button><small>주민 클릭: 대화 · 주민 드래그: 이동 · 검은 구덩이에 놓기: 방출</small></div>
      <div class="earth-controls" aria-label="지구본 보기"><button type="button" id="earth-zoom-in" aria-label="확대">＋</button><button type="button" id="earth-zoom-out" aria-label="축소">−</button><button type="button" id="earth-reset">처음</button></div>
      <div class="earth-reveal-caption" aria-live="polite"><span>WELCOME TO YOUR LITTLE COSMOS</span><p id="earth-reveal-status"></p></div>
      <dialog id="earth-dialog" class="earth-dialog earth-movein" aria-labelledby="earth-dialog-title">
        <form method="dialog" class="earth-dialog-header"><div><small>A NEW LIFE AMONG THE STARS</small><h2 id="earth-dialog-title">어떤 모습으로 행성에 입주할까요?</h2></div><button aria-label="닫기">×</button></form>
        <label class="earth-name-label">주민 이름 <input id="earth-name" maxlength="20" placeholder="이름을 지어 주세요" autocomplete="off"></label>
        <div class="earth-movein-halves">
          <section class="earth-movein-camera"><h3><span>01</span> 나의 모습</h3><div class="earth-camera-frame"><video id="earth-camera" autoplay muted playsinline></video><canvas id="earth-photo" hidden aria-label="촬영된 사진"></canvas><div id="earth-countdown" class="earth-countdown" hidden role="timer" aria-live="polite"></div><span>얼굴과 팔다리가 잘 보이도록 서 주세요</span></div><button id="earth-camera-start" type="button">카메라 켜기</button></section>
          <section class="earth-movein-image"><h3><span>02</span> 새로운 모습</h3><label id="earth-dropzone" class="earth-dropzone"><span class="earth-upload-plus">＋</span><canvas id="earth-preview" width="384" height="384" aria-label="업로드한 형체 미리보기"></canvas><strong id="earth-upload-hint">이미지를 드래그하거나 클릭해서 추가해 주세요</strong><small>캐릭터 · 동물 · 물건 · 사람<br>투명 / 단색 배경, 한 형체의 이미지 권장</small><input id="earth-upload" type="file" accept="image/png,image/jpeg,image/webp" aria-label="캐릭터 이미지 선택"></label></section>
        </div>
        <p id="earth-editor-status" class="earth-editor-status" role="status">이미지를 넣으면 5초 후 자동 촬영됩니다.</p>
        <div class="earth-dialog-footer"><small>이미지 추가 → 5초 후 촬영 → 미니어처 공개 → 입주<br>캐릭터 사진은 이 브라우저에 저장되며 서버로 전송되지 않아요.<br>현재는 이미지 윤곽을 입체화하는 프로토타입입니다.</small><button id="earth-retry" type="button">다시 5초 세기</button></div>
      </dialog>
    </main>
  `,
  space: () => `
    <main class="space-example example-view">
      <canvas id="space-particles" aria-label="누르면 별이 모이고 놓으면 터지는 우주 입자 예제"></canvas>
    </main>
  `,
  typing: () => `
    <main class="typing-example example-view">
      <canvas id="typing-game" aria-label="알파벳 낙하 피하기 게임"></canvas>
      <div class="game-guide">
        <p>한/영 전환 없이 보이는 단어를 입력해 떨어뜨리세요</p>
      </div>
      <div id="word-prompt" class="word-prompt" aria-live="polite">
        <p>ENTER 없이 바로 입력</p>
        <div id="target-word" class="target-word" aria-label="입력할 단어"></div>
      </div>
      <input
        id="typing-input"
        class="typing-input"
        type="text"
        inputmode="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        aria-label="제시된 단어 입력"
      />
      <section id="game-over" class="game-over" aria-live="assertive" hidden>
        <p class="game-over__label">GAME OVER</p>
        <h1>글자에 맞았어요!</h1>
        <p id="game-result"></p>
        <button id="restart" type="button">다시하기 · Enter</button>
      </section>
    </main>
  `,
  claw: () => `
    <main class="claw-example example-view">
      <canvas id="claw-machine" aria-label="방향키와 스페이스 바로 조작하는 3차원 인형뽑기 기계"></canvas>

      <section class="claw-hud" aria-live="polite">
        <p id="claw-status" class="claw-status">방향키로 집게를 움직여 보세요</p>
      </section>

      <section class="claw-controls" aria-label="인형뽑기 조작 버튼">
        <div class="direction-pad">
          <button class="direction-button direction-button--up" data-direction="back" type="button" aria-label="집게를 뒤로 이동">↑</button>
          <button class="direction-button direction-button--left" data-direction="left" type="button" aria-label="집게를 왼쪽으로 이동">←</button>
          <button class="direction-button direction-button--right" data-direction="right" type="button" aria-label="집게를 오른쪽으로 이동">→</button>
          <button class="direction-button direction-button--down" data-direction="front" type="button" aria-label="집게를 앞으로 이동">↓</button>
        </div>
        <button id="claw-drop" class="claw-drop" type="button">
          <span>SPACE</span>
          집게 내리기
        </button>
      </section>

      <button id="prize-list-button" class="claw-prizes" type="button" aria-label="획득한 인형 목록 열기" aria-expanded="false">
        <span>PRIZES</span>
        <strong id="prize-count">0</strong>
      </button>

      <section id="prize-panel" class="prize-panel" aria-label="획득한 인형 목록" hidden>
        <header>
          <div><span>MY COLLECTION</span><h2>뽑은 인형</h2></div>
          <button id="prize-panel-close" type="button" aria-label="목록 닫기">×</button>
        </header>
        <div id="prize-list" class="prize-list">
          <p class="prize-list__empty">아직 뽑은 인형이 없어요.</p>
        </div>
        <p class="prize-panel__guide">인형을 선택하면 3D로 회전합니다.</p>
      </section>

      <div id="prize-viewer-label" class="prize-viewer-label" hidden>
        <span>3D VIEW</span><strong></strong>
      </div>

      <div id="prize-reveal" class="prize-reveal" aria-live="assertive" hidden>
        <span>YOU GOT IT!</span>
        <strong>새 인형</strong>
      </div>

      <p class="claw-drag-guide">화면을 드래그해 기계를 회전해 보세요</p>
    </main>
  `,
  sampler: () => `
    <main class="sampler-example example-view">
      <section class="sampler-copy" aria-label="샘플러 도구">
        <p id="sampler-status" class="sampler-status">한/영 상태와 관계없이 QWE · ASD · ZXC 키를 눌러 보세요.</p>
        <button id="sampling-button" class="sampling-button" type="button">
          <span class="sampling-button__dot"></span>
          샘플링
        </button>
        <p class="sampler-file-guide">음원 경로: <code>public/sounds/q.wav</code> 또는 <code>q.mp3</code></p>
      </section>

      <section class="sampler-workspace">
        <section id="sampler-editor" class="sampler-editor" hidden aria-label="패드 사운드 편집">
          <header><strong id="editor-key">Q PAD</strong><button id="editor-close" type="button" aria-label="편집 닫기">×</button></header>
          <div class="sampler-editor__control">
            <span>피치</span>
            <button data-editor-action="pitch-down" type="button">−</button>
            <output id="pitch-value">0 st</output>
            <button data-editor-action="pitch-up" type="button">+</button>
          </div>
          <div class="sampler-editor__control">
            <span>속도</span>
            <button data-editor-action="speed-down" type="button">−</button>
            <output id="speed-value">1.0×</output>
            <button data-editor-action="speed-up" type="button">+</button>
          </div>
        </section>

        <section id="sampler-pads" class="sampler-pads" aria-label="오디오 샘플 패드">
          <button class="sampler-pad" data-sampler-key="q" type="button"><strong>Q</strong><span class="sampler-pad__source">기본 샘플</span></button>
          <button class="sampler-pad" data-sampler-key="w" type="button"><strong>W</strong><span class="sampler-pad__source">기본 샘플</span></button>
          <button class="sampler-pad" data-sampler-key="e" type="button"><strong>E</strong><span class="sampler-pad__source">기본 샘플</span></button>
          <button class="sampler-pad" data-sampler-key="a" type="button"><strong>A</strong><span class="sampler-pad__source">기본 샘플</span></button>
          <button class="sampler-pad" data-sampler-key="s" type="button"><strong>S</strong><span class="sampler-pad__source">기본 샘플</span></button>
          <button class="sampler-pad" data-sampler-key="d" type="button"><strong>D</strong><span class="sampler-pad__source">기본 샘플</span></button>
          <button class="sampler-pad" data-sampler-key="z" type="button"><strong>Z</strong><span class="sampler-pad__source">기본 샘플</span></button>
          <button class="sampler-pad" data-sampler-key="x" type="button"><strong>X</strong><span class="sampler-pad__source">기본 샘플</span></button>
          <button class="sampler-pad" data-sampler-key="c" type="button"><strong>C</strong><span class="sampler-pad__source">기본 샘플</span></button>
        </section>
        <p class="sampler-edit-guide">패드를 길게 누르면 피치와 속도를 편집할 수 있어요.</p>
      </section>

      <aside class="sampler-recorder" aria-label="연주 녹음본">
        <header><span>RECORDINGS</span><strong>연주 녹음</strong></header>
        <button id="mix-record-button" class="mix-record-button" type="button"><i></i><span>녹음 시작</span><kbd>SPACE</kbd></button>
        <button id="new-recording-button" class="new-recording-button" type="button">＋ 새 녹음 만들기</button>
        <div id="recording-list" class="recording-list"><p class="recording-list__empty">저장된 연주가 없어요.</p></div>
        <p class="sampler-recorder__guide">녹음본을 선택하고 다시 녹음하면 기존 루프 위에 소리가 쌓입니다.</p>
      </aside>
    </main>
  `,
  hand: () => `
    <main class="hand-example example-view">
      <section class="hand-camera-stage" aria-label="Lemonade 손 인식 카메라 화면">
        <video id="hand-camera" autoplay muted playsinline aria-hidden="true"></video>
        <canvas id="hand-overlay" aria-hidden="true"></canvas>
        <header class="hand-hud">
          <p id="hand-status">왼손 주먹으로 레몬을 짜고, 오른손 손바닥으로 컵을 움직여 보세요.</p>
        </header>
        <button id="hand-camera-toggle" type="button">카메라 시작</button>
      </section>
    </main>
  `,
  water: () => `
    <main class="water-example example-view">
      <section class="water-camera-stage" aria-label="손끝으로 카메라 화면의 물결을 만드는 WaterTouch">
        <video id="water-camera" autoplay muted playsinline aria-hidden="true"></video>
        <canvas id="water-surface" aria-label="실시간 카메라 수면 왜곡 화면"></canvas>

        <header class="water-hud">
          <p id="water-status">카메라를 켜고 손끝을 움직이거나 주먹을 쥐어 보세요.</p>
          <button id="water-camera-toggle" type="button">카메라 시작</button>
        </header>

        <div class="water-guide" aria-hidden="true">
          <span class="water-guide__line"></span>
          <p>손을 가까이 할수록 파동이 강해지고<br>주먹을 쥐면 넓게 퍼져요</p>
        </div>

        <div class="water-tracking" aria-live="polite">
          <span class="water-tracking__pulse"></span>
          <div><small>FINGERTIPS</small><strong id="water-finger-count">0 / 10</strong></div>
        </div>
      </section>
    </main>
  `,
  balloon: () => `
    <main class="balloon-example example-view">
      <section class="balloon-camera-stage" aria-label="손과 입으로 풍선에 반응하는 Balloon 카메라 화면">
        <video id="balloon-camera" autoplay muted playsinline aria-hidden="true"></video>
        <canvas id="balloon-overlay" aria-label="카메라 위로 떠오르는 인터랙티브 풍선"></canvas>

        <header class="balloon-hud">
          <p id="balloon-status">검지로 터뜨리고, 핀치로 끈을 잡고, O 모양 입술로 풍선을 불어 보세요.</p>
          <button id="balloon-camera-toggle" type="button">카메라 시작</button>
        </header>

        <div class="balloon-guide" aria-hidden="true">
          <span class="balloon-guide__line"></span>
          <p>검지로 터뜨리기 · 핀치로 끈 잡기<br>풍선이 입에 닿을 때 O 모양 만들기</p>
        </div>

        <div class="balloon-score" aria-live="polite">
          <small>POPPED</small><strong id="balloon-popped-count">0</strong>
        </div>
      </section>
    </main>
  `,
  lab: () => `
    <main class="lab-example example-view">
      <section class="lab-camera-stage" style="--lab-pond-image: url('${import.meta.env.BASE_URL}lab/lotus-pond.png')" aria-label="손가락 개수만큼 연꽃잎을 피우는 인터랙티브 연못">
        <div class="lab-camera-preview" aria-label="손 인식 카메라 화면">
          <video id="lab-camera" autoplay muted playsinline aria-hidden="true"></video>
          <span>LIVE HAND CAMERA</span>
        </div>
        <div id="lab-lotus" class="lab-lotus" role="img" aria-label="주먹에서는 꽃봉오리, 손가락 하나마다 꽃잎 한 장이 열리고 다섯 손가락에서는 만개하는 연꽃">
          <img id="lab-lotus-bud" class="lab-lotus__bud" src="${import.meta.env.BASE_URL}lab/lotus-bud.png" alt="닫힌 연꽃 봉오리" draggable="false">
          <div id="lab-lotus-bloom" class="lab-lotus__bloom" aria-hidden="true">
            <img class="lab-lotus__petal" data-lotus-petal="0" src="${import.meta.env.BASE_URL}lab/lotus-petal.png" alt="" draggable="false">
            <img class="lab-lotus__petal" data-lotus-petal="1" src="${import.meta.env.BASE_URL}lab/lotus-petal.png" alt="" draggable="false">
            <img class="lab-lotus__petal" data-lotus-petal="2" src="${import.meta.env.BASE_URL}lab/lotus-petal.png" alt="" draggable="false">
            <img class="lab-lotus__petal" data-lotus-petal="3" src="${import.meta.env.BASE_URL}lab/lotus-petal.png" alt="" draggable="false">
            <img class="lab-lotus__petal" data-lotus-petal="4" src="${import.meta.env.BASE_URL}lab/lotus-petal.png" alt="" draggable="false">
          </div>
          <img id="lab-lotus-complete" class="lab-lotus__complete" src="${import.meta.env.BASE_URL}lab/lotus-flower.png" alt="활짝 핀 연꽃" draggable="false">
        </div>
        <header class="lab-hud">
          <p id="lab-status">주먹은 꽃봉오리, 손가락 하나마다 꽃잎 한 장이 열리고 손을 다 펴면 만개합니다.</p>
          <button id="lab-camera-toggle" type="button">카메라 시작</button>
        </header>
        <div class="lab-guide" aria-hidden="true"><span></span><p>주먹 · lotus-bud<br>손가락 1개 · 꽃잎 1장<br>손 전체 · lotus-flower</p></div>
        <div class="lab-meter" aria-live="polite"><small>LOTUS PETALS</small><strong id="lab-finger-count">0 / 5 · 0 PETALS</strong></div>
      </section>
    </main>
  `,
  rubber: () => `
    <main class="rubber-example example-view">
      <section class="rubber-camera-stage" aria-label="핀치로 얼굴을 고무처럼 늘이는 고무 인간 카메라 화면">
        <video id="rubber-camera" autoplay muted playsinline aria-hidden="true"></video>
        <canvas id="rubber-surface" aria-label="핀치 동작에 따라 부드럽게 늘어나는 얼굴"></canvas>

        <header class="rubber-hud">
          <p id="rubber-status">카메라를 켜고 양손으로 얼굴 위를 집어 보세요.</p>
          <button id="rubber-camera-toggle" type="button">카메라 시작</button>
        </header>

        <div class="rubber-guide" aria-hidden="true">
          <span></span>
          <p>양손 핀치 · 양쪽으로 잡아당기기<br>손을 놓으면 탄력 있게 원래대로</p>
        </div>

        <div class="rubber-meter" aria-live="polite">
          <i></i><div><small>FACE ELASTICITY</small><strong id="rubber-state">READY</strong></div>
        </div>
      </section>
    </main>
  `,
  shampoo: () => `
    <main class="shampoo-example example-view">
      <section class="shampoo-camera-stage" aria-label="핀치와 주먹 제스처로 거품을 만드는 Shampoo 카메라 화면">
        <video id="shampoo-camera" autoplay muted playsinline aria-hidden="true"></video>
        <canvas id="shampoo-bubbles" aria-label="HumanSeg 머리 실루엣 위의 샴푸 거품"></canvas>
        <header class="shampoo-hud">
          <p id="shampoo-status">카메라를 켠 뒤 핀치 또는 주먹 제스처를 해 보세요.</p>
          <button id="shampoo-camera-toggle" type="button">카메라 시작</button>
        </header>
        <button id="shampoo-shower-lever" class="shampoo-shower-lever" type="button" aria-label="샤워 레버를 아래로 당겨 거품 씻어내기"><span class="shampoo-shower-lever__pipe"></span><span class="shampoo-shower-lever__handle"></span><small>RINSE</small></button>
        <div class="shampoo-guide" aria-hidden="true"><span></span><p>핀치 · 거품 경로 남기기<br>주먹 · 넓은 거품 퍼뜨리기</p></div>
        <div class="shampoo-meter" aria-live="polite"><i></i><div><small>HUMANSEG FOAM</small><strong id="shampoo-state">READY</strong></div></div>
      </section>
    </main>
  `,
  doodle: () => `
    <main class="doodle-example example-view">
      <video id="doodle-camera" autoplay muted playsinline aria-hidden="true"></video>
      <section id="doodle-lobby" class="doodle-lobby" aria-label="DoodleFace 2인 게임 로비">
        <div class="doodle-lobby__orb doodle-lobby__orb--one"></div><div class="doodle-lobby__orb doodle-lobby__orb--two"></div>
        <strong>한 화면, 두 얼굴, 60초의 낙서</strong><p id="doodle-lobby-status" class="doodle-lobby__status" aria-live="polite"></p>
        <div class="doodle-lobby__actions"><button id="doodle-start" type="button">2인 게임 시작 <b>＋</b></button><button id="doodle-help" type="button">게임 방법 <b>?</b></button></div>
      </section>
      <section id="doodle-game" class="doodle-game" hidden aria-label="DoodleFace 게임 화면">
        <header class="doodle-hud"><strong id="doodle-timer">WAITING</strong><p id="doodle-status" aria-live="polite">두 사람이 화면에 나란히 서 주세요.</p></header>
        <div id="doodle-panels" class="doodle-panels">
          <article class="doodle-panel doodle-panel--one"><header><span id="doodle-label-one">PLAYER 1</span><strong><i></i><b id="doodle-score-one">0</b> DOODLES</strong></header><canvas id="doodle-player-one" aria-label="왼쪽 거울 카메라와 DoodleFace"></canvas><span id="doodle-waiting-one" class="doodle-waiting">WAITING</span><div class="doodle-palette" role="group" aria-label="Player 1 팔레트"><button class="is-selected" data-doodle-player="1" data-doodle-color="#ff5f91" style="--swatch:#ff5f91"></button><button data-doodle-player="1" data-doodle-color="#ff8b50" style="--swatch:#ff8b50"></button><button data-doodle-player="1" data-doodle-color="#ffd85b" style="--swatch:#ffd85b"></button><button data-doodle-player="1" data-doodle-color="#bcf05d" style="--swatch:#bcf05d"></button><button data-doodle-player="1" data-doodle-color="#30d7c5" style="--swatch:#30d7c5"></button><button data-doodle-player="1" data-doodle-color="#50a6ff" style="--swatch:#50a6ff"></button><button data-doodle-player="1" data-doodle-color="#7c6cff" style="--swatch:#7c6cff"></button><button data-doodle-player="1" data-doodle-color="#c675ff" style="--swatch:#c675ff"></button><button data-doodle-player="1" data-doodle-color="#ffffff" style="--swatch:#ffffff"></button><button data-doodle-player="1" data-doodle-color="#29223f" style="--swatch:#29223f"></button></div></article>
          <article class="doodle-panel doodle-panel--two"><header><span id="doodle-label-two">PLAYER 2</span><strong><i></i><b id="doodle-score-two">0</b> DOODLES</strong></header><canvas id="doodle-player-two" aria-label="오른쪽 거울 카메라와 DoodleFace"></canvas><span id="doodle-waiting-two" class="doodle-waiting">WAITING</span><div class="doodle-palette" role="group" aria-label="Player 2 팔레트"><button data-doodle-player="2" data-doodle-color="#ff5f91" style="--swatch:#ff5f91"></button><button data-doodle-player="2" data-doodle-color="#ff8b50" style="--swatch:#ff8b50"></button><button data-doodle-player="2" data-doodle-color="#ffd85b" style="--swatch:#ffd85b"></button><button data-doodle-player="2" data-doodle-color="#bcf05d" style="--swatch:#bcf05d"></button><button class="is-selected" data-doodle-player="2" data-doodle-color="#30d7c5" style="--swatch:#30d7c5"></button><button data-doodle-player="2" data-doodle-color="#50a6ff" style="--swatch:#50a6ff"></button><button data-doodle-player="2" data-doodle-color="#7c6cff" style="--swatch:#7c6cff"></button><button data-doodle-player="2" data-doodle-color="#c675ff" style="--swatch:#c675ff"></button><button data-doodle-player="2" data-doodle-color="#ffffff" style="--swatch:#ffffff"></button><button data-doodle-player="2" data-doodle-color="#29223f" style="--swatch:#29223f"></button></div></article>
        </div>
        <div id="doodle-transition-layer" class="doodle-transition-layer" aria-hidden="true"><canvas id="doodle-transition-one"></canvas><canvas id="doodle-transition-two"></canvas></div>
        <output id="doodle-toast" class="doodle-toast" hidden></output>
      </section>
      <section id="doodle-help-panel" class="doodle-help" hidden aria-label="DoodleFace 게임 방법"><button id="doodle-help-close" type="button" aria-label="게임 방법 닫기">×</button><small>HOW TO PLAY</small><h2>서로의 얼굴을<br>웃기게 꾸며 보세요.</h2><ol><li>두 사람이 카메라 앞에 나란히 서요.</li><li>5초 카운트 뒤 화면이 서로 바뀌어요.</li><li>각자 색을 고르고 엄지·검지를 Pinch해 낙서해요.</li></ol><p>한 PC · 한 카메라 · 두 명의 플레이어</p></section>
    </main>
  `,
  travel: () => `
    <main class="travel-example example-view">
      <section class="travel-stage" aria-label="사진과 영상에 효과를 적용하는 Effect 작업실">
        <canvas id="effect-output" aria-label="이미지 및 영상 효과 결과"></canvas>
        <video id="effect-camera" autoplay muted playsinline aria-hidden="true"></video>
        <div class="travel-shade" aria-hidden="true"></div>

        <header class="travel-hud">
          <p id="travel-status">카메라 권한을 확인하고 있어요. 허용하면 자동으로 시작됩니다.</p>
        </header>

        <aside class="travel-effect-panel" aria-label="이미지 효과 컨트롤">
          <div class="travel-effect-panel__heading">
            <span id="travel-effect-mode-name">PIXEL</span>
            <button id="effect-toolbar-toggle" type="button" aria-expanded="true" aria-controls="effect-toolbar-content">접기 −</button>
          </div>
          <div id="effect-toolbar-content">
          <div class="effect-color-modes" role="group" aria-label="컬러 또는 흑백">
            <button type="button" data-color-mode="color" aria-pressed="true">컬러</button>
            <button type="button" data-color-mode="mono" aria-pressed="false">흑백</button>
          </div>
          <div class="travel-effect-options" role="group" aria-label="이미지 효과 선택">
            <button type="button" class="is-active" data-effect-mode="pixel" aria-pressed="true">픽셀</button>
            <button type="button" data-effect-mode="blur" aria-pressed="false">블러</button>
            <button type="button" class="is-recolor" data-effect-mode="recolor" aria-pressed="false">Recolor</button>
            <button type="button" class="is-light-map" data-effect-mode="lightmap" aria-pressed="false">Bright Map</button>
            <button type="button" data-effect-mode="melt" aria-pressed="false">Melted Spectrum</button>
            <button type="button" data-effect-mode="thermal" aria-pressed="false">열화상 (시각 효과)</button>
          </div>
          <div class="travel-effect-control">
            <span><b id="travel-effect-control-label">픽셀 개수</b><output id="travel-effect-value">72</output></span>
            <span class="travel-effect-range-row">
              <input id="travel-effect-range" type="range" min="24" max="144" value="72" step="4" aria-label="효과 조절">
            </span>
            <small><span>↓ ← 감소</span><span>↑ → 증가</span></small>
          </div>

          <section id="recolor-palette-editor" class="recolor-palette-editor" aria-label="Recolor 색상 팔레트" hidden>
            <header><span>MY COLORS</span><button id="recolor-randomize" type="button">랜덤</button></header>
            <div id="recolor-swatches" class="recolor-swatches"></div>
            <button id="recolor-add-color" class="recolor-add-color" type="button">＋ 색상 추가</button>
          </section>

          <section class="effect-media-library" aria-label="사진과 영상 추가">
            <label class="effect-media-upload">
              <input id="effect-media-input" type="file" accept="image/*,video/*">
              <span>＋ 사진·영상 추가</span>
            </label>
            <button id="effect-save-photo" class="effect-save-photo" type="button" disabled>현재 사진 저장</button>
            <div class="effect-camera-actions" aria-label="카메라 촬영">
              <button id="effect-capture-photo" type="button" disabled>사진 촬영</button>
              <button id="effect-record-video" type="button" disabled><i></i><span>영상 녹화</span></button>
            </div>
            <div>
              <small>SAVED PHOTOS</small>
              <div id="effect-saved-photos" class="effect-saved-photos"><span>저장된 사진이 없어요.</span></div>
            </div>
          </section>
          </div>
        </aside>

        <div class="effect-tracking-meter" aria-live="polite">
          <span></span><div><small>BRIGHT BLOBS</small><strong id="effect-blob-count">0</strong></div>
        </div>
      </section>
    </main>
  `,
  aquarium: () => `
    <main class="aquarium-example example-view">
      <canvas id="aquarium-canvas" aria-label="시선을 따라 물고기가 모이고 손을 가까이 하면 흩어지는 인터랙티브 수족관"></canvas>
      <video id="aquarium-camera" autoplay muted playsinline aria-hidden="true"></video>

      <header class="aquarium-hud">
        <p id="aquarium-status" aria-live="polite">카메라를 켜면 화면 전체가 수족관이 됩니다.</p>
        <button id="aquarium-camera-toggle" type="button">카메라 시작</button>
      </header>

      <div class="aquarium-guide" aria-hidden="true">
        <span></span>
        <p>시선 · 물고기 모으기<br>손가락 끝 · 사방으로 흩어지기<br>입 벌리기 · 화면 밖으로 도망가기</p>
      </div>

      <div class="aquarium-gaze-meter" aria-live="polite">
        <header><small>FACE + HAND TRACKING</small><strong id="aquarium-gaze-state">NEUTRAL</strong></header>
        <div class="aquarium-gaze-row"><b>LEFT</b><span><i id="aquarium-left-meter"></i></span><output id="aquarium-left-value">0.00</output></div>
        <div class="aquarium-gaze-row"><b>RIGHT</b><span><i id="aquarium-right-meter"></i></span><output id="aquarium-right-value">0.00</output></div>
      </div>
    </main>
  `,
  sniper: () => `
    <main class="sniper-example example-view">
      <canvas id="sniper-canvas" aria-label="얼굴 동작으로 조준하고 입모양으로 발사하는 Sniper 게임"></canvas>
      <video id="sniper-camera" autoplay muted playsinline aria-hidden="true"></video>

      <header class="sniper-hud">
        <p id="sniper-status" aria-live="polite">한쪽 눈을 감아 조준하고, 두 눈을 뜨면 발사됩니다.</p>
        <button id="sniper-camera-toggle" type="button">카메라 시작</button>
      </header>

      <div class="sniper-score" aria-live="polite">
        <small>SCORE</small><strong id="sniper-score-value">0000</strong><span><b id="sniper-hit-count">0</b> HITS · <b id="sniper-shot-count">0</b> SHOTS</span><em>CENTER 100 · 80 · 60 · 40 · 20</em>
      </div>

      <div class="sniper-face-signals" aria-live="polite">
        <span><small>LEFT EYE</small><i><b id="sniper-left-eye-meter"></b></i></span>
        <span><small>RIGHT EYE</small><i><b id="sniper-right-eye-meter"></b></i></span>
      </div>

      <div class="sniper-guide" aria-hidden="true">
        <span></span><p>한쪽 눈 감고 유지 · 조준<br>고개 상하좌우 · 방향 조절<br>두 눈 뜨기 · 자동 발사</p>
      </div>
    </main>
  `,
}

async function mountTypingGame(isCurrent: () => boolean) {
  const { setupTypingGame } = await import('./typing-game.ts')
  if (!isCurrent()) return () => {}
  return setupTypingGame(
    document.querySelector<HTMLCanvasElement>('#typing-game')!,
    document.querySelector<HTMLElement>('#game-over')!,
    document.querySelector<HTMLElement>('#game-result')!,
    document.querySelector<HTMLButtonElement>('#restart')!,
    document.querySelector<HTMLElement>('#word-prompt')!,
    document.querySelector<HTMLElement>('#target-word')!,
    document.querySelector<HTMLInputElement>('#typing-input')!,
  )
}

async function mountSpaceExample(isCurrent: () => boolean) {
  const { setupSpaceParticles } = await import('./space-particles.ts')
  if (!isCurrent()) return () => {}
  return setupSpaceParticles(document.querySelector<HTMLCanvasElement>('#space-particles')!)
}

async function mountClawExample(isCurrent: () => boolean) {
  const { setupClawMachine } = await import('./claw-machine.ts')
  if (!isCurrent()) return () => {}
  return setupClawMachine(
    document.querySelector<HTMLCanvasElement>('#claw-machine')!,
    document.querySelector<HTMLElement>('#claw-status')!,
    document.querySelector<HTMLElement>('#prize-count')!,
    document.querySelector<HTMLElement>('.claw-controls')!,
    document.querySelector<HTMLButtonElement>('#claw-drop')!,
    document.querySelector<HTMLElement>('#prize-reveal')!,
    document.querySelector<HTMLButtonElement>('#prize-list-button')!,
    document.querySelector<HTMLElement>('#prize-panel')!,
    document.querySelector<HTMLElement>('#prize-list')!,
    document.querySelector<HTMLButtonElement>('#prize-panel-close')!,
    document.querySelector<HTMLElement>('#prize-viewer-label')!,
  )
}

async function mountSamplerExample(isCurrent: () => boolean) {
  const { setupSampler } = await import('./sampler.ts')
  if (!isCurrent()) return () => {}
  return setupSampler(document.querySelector<HTMLElement>('.sampler-example')!)
}

async function mountHandTrackingExample(isCurrent: () => boolean) {
  const { setupHandTracking } = await import('./hand-tracking.ts')
  if (!isCurrent()) return () => {}
  return setupHandTracking(document.querySelector<HTMLElement>('.hand-example')!)
}

async function mountWaterTouchExample(isCurrent: () => boolean) {
  const { setupWaterTouch } = await import('./water-touch.ts')
  if (!isCurrent()) return () => {}
  return setupWaterTouch(document.querySelector<HTMLElement>('.water-example')!)
}

async function mountBalloonExample(isCurrent: () => boolean) {
  const { setupBalloon } = await import('./balloon.ts')
  if (!isCurrent()) return () => {}
  return setupBalloon(document.querySelector<HTMLElement>('.balloon-example')!)
}

async function mountLabExample(isCurrent: () => boolean) {
  const { setupFlowerLab } = await import('./flower-lab.ts')
  if (!isCurrent()) return () => {}
  return setupFlowerLab(document.querySelector<HTMLElement>('.lab-example')!)
}

async function mountRubberExample(isCurrent: () => boolean) {
  const { setupRubberHuman } = await import('./rubber-human.ts')
  if (!isCurrent()) return () => {}
  return setupRubberHuman(document.querySelector<HTMLElement>('.rubber-example')!)
}

async function mountShampooExample(isCurrent: () => boolean) {
  const { setupShampoo } = await import('./shampoo.ts')
  if (!isCurrent()) return () => {}
  return setupShampoo(document.querySelector<HTMLElement>('.shampoo-example')!)
}

async function mountDoodleFaceExample(isCurrent: () => boolean) {
  const { setupDoodleFace } = await import('./doodle-face.ts')
  if (!isCurrent()) return () => {}
  return setupDoodleFace(document.querySelector<HTMLElement>('.doodle-example')!)
}

async function mountTravelExample(isCurrent: () => boolean) {
  const { setupTravel } = await import('./travel.ts')
  if (!isCurrent()) return () => {}
  return setupTravel(document.querySelector<HTMLElement>('.travel-example')!)
}

async function mountAquariumExample(isCurrent: () => boolean) {
  const { setupAquarium } = await import('./aquarium.ts')
  if (!isCurrent()) return () => {}
  return setupAquarium(document.querySelector<HTMLElement>('.aquarium-example')!)
}

async function mountSniperExample(isCurrent: () => boolean) {
  const { setupSniper } = await import('./sniper.ts')
  if (!isCurrent()) return () => {}
  return setupSniper(document.querySelector<HTMLElement>('.sniper-example')!)
}

async function showExample(name: ExampleName) {
  if (activeExample === name) return
  activeExample = name
  const request = ++exampleRequest
  const isCurrent = () => request === exampleRequest
  releaseCurrentExample()
  if (name !== 'home') disposeCaptureControl = setupCaptureControl(app)
  stage.innerHTML = exampleTemplates[name]()
  stage.dataset.activeExample = name
  app.dataset.activeExample = name

  navigation.querySelectorAll<HTMLButtonElement>('[data-example]').forEach((button) => {
    const isActive = button.dataset.example === name
    button.classList.toggle('is-active', isActive)
    button.setAttribute('aria-pressed', String(isActive))
  })
  history.replaceState(null, '', `#${name}`)

  let disposeMountedExample = () => {}
  stage.setAttribute('aria-busy', 'true')
  try {
  if (name === 'home') {
    const { setupExampleGallery } = await import('./example-gallery.ts')
    if (isCurrent()) disposeMountedExample = setupExampleGallery(stage.querySelector<HTMLElement>('.example-gallery')!, (selected) => {
      if (Object.hasOwn(exampleTemplates, selected)) void showExample(selected as ExampleName)
    })
  }
  if (name === 'space') disposeMountedExample = await mountSpaceExample(isCurrent)
  if (name === 'typing') disposeMountedExample = await mountTypingGame(isCurrent)
  if (name === 'claw') disposeMountedExample = await mountClawExample(isCurrent)
  if (name === 'sampler') disposeMountedExample = await mountSamplerExample(isCurrent)
  if (name === 'hand') disposeMountedExample = await mountHandTrackingExample(isCurrent)
  if (name === 'water') disposeMountedExample = await mountWaterTouchExample(isCurrent)
  if (name === 'balloon') disposeMountedExample = await mountBalloonExample(isCurrent)
  if (name === 'lab') disposeMountedExample = await mountLabExample(isCurrent)
  if (name === 'rubber') disposeMountedExample = await mountRubberExample(isCurrent)
  if (name === 'shampoo') disposeMountedExample = await mountShampooExample(isCurrent)
  if (name === 'doodle') disposeMountedExample = await mountDoodleFaceExample(isCurrent)
  if (name === 'travel') disposeMountedExample = await mountTravelExample(isCurrent)
  if (name === 'aquarium') disposeMountedExample = await mountAquariumExample(isCurrent)
  if (name === 'sniper') disposeMountedExample = await mountSniperExample(isCurrent)
  if (name === 'earth') {
    const { setupEarthVillage } = await import('./earth-village.ts')
    if (isCurrent()) disposeMountedExample = setupEarthVillage(document.querySelector<HTMLElement>('.earth-example')!)
  }
  if (name === 'body-fx' || name === 'afterglow') {
    const { setupBodyCloud } = await import('./body-cloud-example.ts')
    if (isCurrent()) disposeMountedExample = setupBodyCloud(stage.querySelector<HTMLElement>('.body-example')!,name==='afterglow')
  }
  if (name === 'money') {
    const { setupBodyExample } = await import('./body-examples.ts')
    if (isCurrent()) disposeMountedExample = setupBodyExample(stage.querySelector<HTMLElement>('.body-example')!, true)
  }
  if (isCurrent()) disposeCurrentExample = disposeMountedExample
  else disposeMountedExample()
  } catch (error) {
    if (isCurrent()) {
      activeExample = null
      const message = document.createElement('p')
      message.setAttribute('role', 'alert')
      message.textContent = '예제를 불러오지 못했어요. 뒤로가기를 눌러 갤러리에서 다시 선택해 주세요.'
      stage.replaceChildren(message)
      console.error('Example initialization failed:', error)
    }
  } finally { if (isCurrent()) stage.removeAttribute('aria-busy') }
}

navigation.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-example]')
  if (!button) return
  void showExample(button.dataset.example as ExampleName)
})

const requestedExample = window.location.hash.slice(1) as ExampleName
void showExample(Object.hasOwn(exampleTemplates, requestedExample) ? requestedExample : 'home')

window.addEventListener('hashchange', () => {
  const name = location.hash.slice(1) as ExampleName
  void showExample(Object.hasOwn(exampleTemplates, name) ? name : 'home')
})
window.addEventListener('pagehide', () => {
  exampleRequest += 1
  releaseCurrentExample()
  activeExample = null
})
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    const name = location.hash.slice(1) as ExampleName
    void showExample(Object.hasOwn(exampleTemplates, name) ? name : 'home')
  }
})
