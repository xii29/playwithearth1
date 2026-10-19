export type GuestbookEntry = { id: string; name: string; message: string; created_at: string; photo?: string | null }

// A durable copy of server-confirmed entries, never a substitute for publishing.
// Partition by backend so a preview cannot display another site's guestbook.
export function guestbookStorage(project: string) {
  const database = new Promise<IDBDatabase | null>(resolve => {
    let finished = false
    const finish = (db: IDBDatabase | null) => {
      if (finished) { db?.close(); return }
      finished = true; clearTimeout(timer); resolve(db)
    }
    const timer = window.setTimeout(() => finish(null), 1500)
    try {
      const request = indexedDB.open('int-guestbook', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('snapshots')
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => db.close()
        finish(db)
      }
      request.onerror = () => finish(null)
      request.onblocked = () => finish(null)
    } catch { finish(null) }
  })
  let closed = false
  async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
    const db = await database
    if (!db || closed) return undefined
    return new Promise(resolve => {
      try {
        const tx = db.transaction('snapshots', mode)
        const request = run(tx.objectStore('snapshots'))
        tx.oncomplete = () => resolve(request.result)
        tx.onabort = tx.onerror = () => resolve(undefined)
      } catch { resolve(undefined) }
    })
  }
  return {
    append: async (entry: GuestbookEntry): Promise<boolean> => {
      const db = await database
      if (!db || closed) return false
      return new Promise(resolve => {
        try {
          const tx = db.transaction('snapshots', 'readwrite'), store = tx.objectStore('snapshots')
          const request = store.get(project)
          request.onsuccess = () => {
            const previous = Array.isArray(request.result) ? request.result : []
            store.put([...previous.filter((row: GuestbookEntry) => row.id !== entry.id), entry], project)
          }
          tx.oncomplete = () => resolve(true)
          tx.onabort = tx.onerror = () => resolve(false)
        } catch { resolve(false) }
      })
    },
    read: async (): Promise<GuestbookEntry[]> => {
      const saved = await transaction('readonly', store => store.get(project))
      if (!Array.isArray(saved)) return []
      return saved.filter((entry): entry is GuestbookEntry => entry && typeof entry.id === 'string' &&
        typeof entry.name === 'string' && typeof entry.message === 'string' &&
        typeof entry.created_at === 'string' && Number.isFinite(Date.parse(entry.created_at)) &&
        (entry.photo == null || typeof entry.photo === 'string'))
    },
    write: async (entries: GuestbookEntry[]) => (await transaction('readwrite', store => store.put(entries, project))) !== undefined,
    close: () => { closed = true; void database.then(db => db?.close()) },
  }
}
