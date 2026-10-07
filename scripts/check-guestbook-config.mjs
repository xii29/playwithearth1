// Validate before publishing: never print the URL or key in build logs.
const url = process.env.VITE_SUPABASE_URL?.trim()
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
const issues = []
try {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) throw new Error()
} catch {
  issues.push('VITE_SUPABASE_URL: Project URL(https://프로젝트ID.supabase.co)을 등록하세요.')
}
let isPublicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key || '')
if (key?.startsWith('eyJ')) {
  try { isPublicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon' } catch { /* invalid JWT */ }
}
if (!isPublicKey) issues.push('VITE_SUPABASE_PUBLISHABLE_KEY: Publishable key 또는 legacy anon 키를 등록하세요. Secret/service_role 키는 사용할 수 없습니다.')
if (issues.length) {
  console.error('방명록 연결 설정 누락/오류로 배포를 중단합니다. 기존 배포는 유지됩니다.')
  console.error('저장소 Settings → Secrets and variables → Actions에서 Repository variables 또는 Repository secrets를 확인하세요.')
  for (const issue of issues) console.error(issue)
  process.exitCode = 1
} else console.log('PASS guestbook deployment configuration (public key and HTTPS project URL)')
