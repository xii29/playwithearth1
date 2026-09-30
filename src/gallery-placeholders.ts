// Reserved slots for future examples. These do not load renderers or cameras.
export const galleryPlaceholders = Array.from({ length: 14 }, (_, index) => ({
  id: `placeholder-${index + 1}`,
  title: `준비 중 ${String(index + 1).padStart(2, '0')}`,
  thumbnail: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250"><rect width="400" height="250" fill="${index % 2 ? '#e7e8e5' : '#f0efeb'}"/><rect x="20" y="20" width="360" height="210" fill="none" stroke="#c8ccc5" stroke-dasharray="4 6"/><path d="M188 125h24m-12-12v24" stroke="#a5ada1" stroke-width="1.5"/></svg>`)}`,
}))
