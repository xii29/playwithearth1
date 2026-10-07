type ApiError = { code?: string; message?: string }
type ApiResult<T> = { data: T; error: ApiError | null; status: number }

export class GuestbookRequestError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, status = 0) {
    super(code)
    this.code = code
    this.status = status
  }
}

// Bound the entire operation, including SDK work before fetch and response parsing.
// Abort alone cannot settle an SDK promise that is stuck before it starts fetch.
export async function guestbookRequest<T>(
  run: (signal: AbortSignal) => PromiseLike<ApiResult<T>>,
  parent: AbortSignal,
  timeoutMs = 12_000,
): Promise<NonNullable<T>> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel = () => {}
  const deadline = new Promise<never>((_, reject) => {
    cancel = () => {
      reject(new GuestbookRequestError('CANCELLED'))
      controller.abort()
    }
    if (parent.aborted) { cancel(); return }
    parent.addEventListener('abort', cancel, { once: true })
    timer = setTimeout(() => {
      reject(new GuestbookRequestError('TIMEOUT'))
      controller.abort()
    }, timeoutMs)
  })
  try {
    const result = await Promise.race([
      deadline,
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new GuestbookRequestError('CANCELLED')
        return run(controller.signal)
      }),
    ])
    if (result.error) throw new GuestbookRequestError(result.error.code || 'NETWORK', result.status)
    if (result.data === null || result.data === undefined) throw new GuestbookRequestError('EMPTY_RESPONSE', result.status)
    return result.data
  } finally {
    clearTimeout(timer)
    parent.removeEventListener('abort', cancel)
  }
}

export function guestbookErrorMessage(error: unknown, writing: boolean): string {
  const failure = error instanceof GuestbookRequestError ? error : new GuestbookRequestError('NETWORK')
  let reason: string
  if (failure.code === 'TIMEOUT') reason = '서버 응답이 늦어 요청을 중단했어요. 잠시 후 다시 시도해 주세요.'
  else if (failure.status === 403 || failure.code === '42501') reason = '방명록 접근 권한이 설정되지 않았어요. 사이트 관리자에게 알려 주세요. (권한 오류)'
  else if (failure.status === 401 || failure.code === 'PGRST301' || failure.code === 'PGRST303') reason = '방명록 연결 키가 올바르지 않아요. 사이트 관리자에게 알려 주세요. (인증 오류)'
  else if (failure.code === 'PGRST205' || failure.code === '42P01') reason = '방명록 테이블이 준비되지 않았어요. 사이트 관리자에게 알려 주세요. (테이블 오류)'
  else if (failure.code === 'PGRST204' || failure.code === '42703') reason = '방명록 데이터 구조를 확인해야 해요. 사이트 관리자에게 알려 주세요. (설정 오류)'
  else if (failure.code === '23514' || failure.code === '23502') reason = '이름은 1~30자, 내용은 1~500자로 입력해 주세요.'
  else if (failure.status === 429) reason = '요청이 많아 잠시 쉬고 있어요. 잠시 후 다시 시도해 주세요.'
  else if (failure.status >= 500) reason = '방명록 서버에 일시적인 문제가 있어요. 잠시 후 다시 시도해 주세요.'
  else reason = '네트워크 연결 또는 서버 주소를 확인하고 다시 시도해 주세요.'
  return writing
    ? `저장 결과를 확인하지 못했어요. ${reason} 입력 내용은 남겨 두었어요. 다시 작성하기 전에 목록을 새로고침해 저장 여부를 확인해 주세요.`
    : `방명록을 불러오지 못했어요. ${reason}`
}
