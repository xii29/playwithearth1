// If either parallel model fails, release its successful sibling as well.
export async function createModelPair<A extends { close(): void }, B extends { close(): void }>(first: Promise<A>, second: Promise<B>): Promise<[A, B]> {
  const [a, b] = await Promise.allSettled([first, second])
  if (a.status === 'fulfilled' && b.status === 'fulfilled') return [a.value, b.value]
  if (a.status === 'fulfilled') a.value.close()
  if (b.status === 'fulfilled') b.value.close()
  throw a.status === 'rejected' ? a.reason : (b as PromiseRejectedResult).reason
}
