export function bodyTemplate() {
  return `<main class="body-example body-point-cloud example-view"><video id="body-camera" autoplay muted playsinline aria-hidden="true"></video><canvas id="body-canvas" aria-label="Melted Spectrum FX 액체 빛과 인물 투명화"></canvas><button id="body-camera-toggle" type="button">카메라 켜기</button><button id="body-separate" type="button" aria-pressed="false">사람 투명화</button><div class="body-guide"><p id="body-status" role="status">카메라를 준비하고 있어요…</p><small>한 손의 검지와 중지를 교차하면 사람이 투명해지고 빛 배경이 드러납니다. 풀면 돌아옵니다. 가려진 실제 배경을 복원하는 효과는 아닙니다.</small></div></main>`
}
