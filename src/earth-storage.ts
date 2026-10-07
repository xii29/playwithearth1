export type SavedResident = { id: string; name: string; shape: string; texture: string; original?: string; normal: number[]; gyaru?:boolean }
let writes: Promise<void> = Promise.resolve()
const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('earth-village-residents', 1)
  request.onupgradeneeded = () => request.result.createObjectStore('village')
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
export async function loadResidents(): Promise<SavedResident[] | null> {
  await writes.catch(() => {})
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('village', 'readonly'), request = tx.objectStore('village').get('residents')
    tx.oncomplete = () => {
      db.close()
      if (request.result === undefined) { resolve(null); return }
      const records = Array.isArray(request.result) ? request.result : []
      resolve(records.filter((r: SavedResident) => typeof r.id === 'string' && typeof r.name === 'string' &&
        typeof r.shape === 'string' && r.shape.startsWith('data:image/png;base64,') && r.shape.length < 4000000 &&
        typeof r.texture === 'string' && r.texture.startsWith('data:image/png;base64,') && r.texture.length < 4000000 &&
        (!r.original || (typeof r.original === 'string' && r.original.startsWith('data:image/png;base64,') && r.original.length < 4000000)) &&
        Array.isArray(r.normal) && r.normal.length === 3 && r.normal.every(Number.isFinite)).slice(0, 24))
    }
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error) }
  })
}
export function saveResidents(records: SavedResident[]) {
  const snapshot = records.map(record => ({ ...record, normal: [...record.normal] }))
  writes = writes.catch(() => {}).then(async () => {
    const db = await open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('village', 'readwrite')
      tx.objectStore('village').put(snapshot, 'residents')
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error) }
    })
  })
  return writes
}
