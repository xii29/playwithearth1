export function bodyTemplate() {
  return `<main class="body-example body-point-cloud example-view"><video id="body-camera" autoplay muted playsinline aria-hidden="true"></video><canvas id="body-canvas" aria-label="검은 배경 위 작은 흰색 입자로 표현되는 사람"></canvas><button id="body-camera-toggle" type="button">카메라 켜기</button><div class="body-guide"><p id="body-status" role="status">카메라를 준비하고 있어요…</p><small>얼굴과 몸 전체를 작은 입자로 표현합니다. 빠르게 움직이면 입자가 잔상처럼 흩어지고, 멈추면 다시 몸의 형태로 모입니다.</small></div></main>`
}
