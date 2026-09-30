// Small vector posters, rendered once as images. No live canvas or filter effects.
const palettes = [
  ['#101216', '#ebeee9', '#b8c7ff'], ['#e9e7e1', '#242729', '#4963ef'],
  ['#242a2c', '#eef0e8', '#d4ee99'], ['#dce1e4', '#232b31', '#4666e9'],
  ['#e4e8cf', '#283c33', '#e7f88b'], ['#102e3b', '#d4eaf0', '#83bdce'],
  ['#eee9e5', '#383b43', '#8d9dd4'], ['#23382f', '#e8e7d3', '#b6c794'],
  ['#dadde5', '#303741', '#798ed1'], ['#e3ebe8', '#304a47', '#92bfb1'],
  ['#ede7df', '#292a2c', '#dd805f'], ['#181e31', '#e2e7f0', '#8498fc'],
  ['#142e37', '#d1e6df', '#a8cec0'], ['#e1e4db', '#2c3730', '#6b8067'],
  ['#202e2b', '#e4e9d9', '#a9c2a0'],
  ['#000000', '#ffffff', '#cccccc'],
] as const
const captions = ['PARTICLE FIELD', 'TYPE / DODGE', 'PICK & PLAY', 'SOUND STUDIES', 'FRESHLY SQUEEZED', 'TOUCH / RIPPLE', 'FLOATING FORMS', 'BOTANICAL STUDY', 'ELASTIC PORTRAIT', 'FOAM / FLOW', 'DRAW YOURSELF', 'IMAGE / REMIX', 'UNDER THE SURFACE', 'FOCUS / RELEASE', 'A LITTLE WORLD', 'BODY / POINT CLOUD']

export function galleryArtwork(index: number) {
  const [background, ink, accent] = palettes[index]
  const orbit = (rx: number, ry: number, rotation = 0) => `<ellipse cx="200" cy="125" rx="${rx}" ry="${ry}" transform="rotate(${rotation} 200 125)" fill="none" stroke="${ink}" stroke-width="1.2"/>`
  const face = `<path d="M159 64Q202 44 230 75L244 115L229 123V156Q213 186 176 176L156 193" fill="url(#surface)" stroke="${ink}" stroke-width="1.2"/><path d="M196 103h14M201 146q14 9 25-1" fill="none" stroke="${background}" stroke-width="3"/>`
  const fish = (x: number, y: number, scale: number) => `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M-51 0Q-10-42 44 0Q-10 42-51 0L-77-23V23Z" fill="url(#surface)"/><path d="M-12-19q-13 19 0 38" fill="none" stroke="${background}"/><circle cx="25" cy="-3" r="2" fill="${background}"/></g>`
  const art = [
    `${orbit(123, 35, -27)}${orbit(92, 26, -27)}${orbit(59, 17, -27)}<circle cx="200" cy="125" r="16" fill="url(#surface)"/><circle cx="290" cy="70" r="4" fill="${accent}"/><path d="M100 137v14m-7-7h14" stroke="${ink}"/>`,
    `<text x="113" y="183" fill="${ink}" font-family="Arial,sans-serif" font-size="154" font-weight="600" letter-spacing="-16">Aa</text><path d="M283 65v118" stroke="${accent}" stroke-width="7"/><path d="M88 195H309" stroke="${ink}" opacity=".3"/>`,
    `<path d="M200 48v49m-6-3-40 31 13 28m39-59 40 31-13 28" fill="none" stroke="${ink}" stroke-width="3"/><rect x="170" y="141" width="60" height="53" rx="16" fill="url(#surface)"/><path d="M108 64H89v121h19m184-121h19v121h-19" stroke="${ink}" opacity=".3" fill="none"/>`,
    Array.from({ length: 17 }, (_, i) => { const h = 18 + Math.sin(i * .8) ** 2 * 92; return `<rect x="${91 + i * 13}" y="${125 - h / 2}" width="6" height="${h}" rx="3" fill="${i < 9 ? ink : accent}"/>` }).join(''),
    `<circle cx="179" cy="126" r="69" fill="url(#surface)"/><path d="M179 67V185M120 126h118m-101-42 84 84m-84 0 84-84" stroke="${background}" stroke-width="2"/><circle cx="179" cy="126" r="57" fill="none" stroke="${background}" stroke-width="2"/><path d="M262 79h37l-9 108h-35z" fill="none" stroke="${ink}" stroke-width="2"/><path d="M276 135 295 51" stroke="${ink}" stroke-width="2"/>`,
    Array.from({ length: 7 }, (_, i) => orbit(22 + i * 18, 7 + i * 7, -12)).join('') + `<path d="M200 62q-17 22 0 28 17-6 0-28" fill="url(#surface)"/>`,
    `<path d="M157 147q-18 36-2 59m98-81q-19 43-4 69" fill="none" stroke="${ink}" opacity=".5"/><ellipse cx="155" cy="108" rx="39" ry="49" fill="url(#surface)"/><ellipse cx="252" cy="89" rx="27" ry="34" fill="${ink}"/><ellipse cx="228" cy="165" rx="15" ry="19" fill="none" stroke="${ink}"/>`,
    Array.from({ length: 7 }, (_, i) => `<ellipse cx="200" cy="119" rx="15" ry="61" transform="rotate(${(i - 3) * 24} 200 175)" fill="${i % 2 ? background : accent}" stroke="${ink}" stroke-width="1"/>`).join(''),
    `<path d="M94 77Q200 113 306 77V173Q200 137 94 173Z" fill="url(#surface)"/>` + Array.from({ length: 9 }, (_, i) => `<path d="M${105 + i * 24} ${80 + Math.sin(i / 8 * Math.PI) * 18}Q200 125 ${105 + i * 24} ${170 - Math.sin(i / 8 * Math.PI) * 18}" fill="none" stroke="${background}" stroke-width="1"/>`).join('') + `<circle cx="91" cy="125" r="5" fill="${ink}"/><circle cx="309" cy="125" r="5" fill="${ink}"/>`,
    [[153, 139, 39], [208, 104, 48], [250, 155, 27], [141, 79, 18], [265, 70, 12]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#surface)"/><path d="M${x - r * .6} ${y}a${r * .6} ${r * .6} 0 0 1 ${r * .6} ${-r * .6}" stroke="${background}" fill="none" stroke-width="2"/>`).join(''),
    `${face}<path d="M120 143q-34-49 3-56t-3 41 15 44m91-102 34-12-16 30 35-8" stroke="${accent}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
    Array.from({ length: 36 }, (_, i) => `<rect x="${110 + i % 6 * 30}" y="${44 + Math.floor(i / 6) * 27}" width="30" height="27" fill="${[accent, ink, background][(i * 7 + Math.floor(i / 6)) % 3]}" opacity="${.25 + (i % 6) * .15}"/>`).join(''),
    `${fish(164, 95, 1.1)}${fish(268, 153, .65)}<path d="M79 189q105-35 237-9M86 200q105-35 224-9" stroke="${ink}" opacity=".25" fill="none"/>`,
    `<g fill="none" stroke="${ink}"><circle cx="200" cy="125" r="69"/><circle cx="200" cy="125" r="47"/><circle cx="200" cy="125" r="25"/><path d="M200 42v48m0 70v48M117 125h48m70 0h48"/></g><circle cx="200" cy="125" r="7" fill="${accent}"/><circle cx="224" cy="109" r="3" fill="${ink}"/>`,
    `<circle cx="200" cy="130" r="67" fill="#a7a1d7"/><ellipse cx="200" cy="130" rx="108" ry="26" fill="none" stroke="#668eac" stroke-width="3" transform="rotate(-24 200 130)"/><path d="M161 116q-24-45-5-48t23 36m42 0q3-50 20-40t-5 54" fill="#e3dff2"/><ellipse cx="198" cy="125" rx="44" ry="35" fill="#e3dff2"/><g fill="#3b3d65"><circle cx="184" cy="120" r="3"/><circle cx="213" cy="120" r="3"/></g><path d="M193 132q6 8 12 0" stroke="#3b3d65" fill="none"/><g fill="#668eac"><circle cx="91" cy="68" r="3"/><circle cx="298" cy="73" r="4"/><circle cx="307" cy="184" r="2"/></g>`,
    Array.from({length:38},(_,i)=>`<path d="M40 ${43+i*4.4} Q100 ${10+i*5} 156 ${75+i*2.9} T360 ${40+i*4.5}" fill="none" stroke="#fff" stroke-width="1.8"/>`).join('') + '<ellipse cx="201" cy="98" rx="22" ry="29" fill="#000"/><path d="M171 130Q200 114 229 130L243 200H157Z" fill="#000"/>' + Array.from({length:90},(_,i)=>`<circle cx="${177+(i%7)*8}" cy="${132+Math.floor(i/7)*5}" r="1.4" fill="#fff"/>`).join(''),
  ][index]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250"><defs><linearGradient id="surface" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${ink}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs><rect width="400" height="250" fill="${background}"/><g fill="${ink}" font-family="Arial,sans-serif" font-size="8" letter-spacing="1.8"><text x="20" y="25">STUDY / ${String(index + 1).padStart(2, '0')}</text><text x="380" y="25" text-anchor="end">↗</text><text x="20" y="232">${captions[index]}</text></g><path d="M20 36H380M20 213H380" stroke="${ink}" stroke-opacity=".16" stroke-width=".7"/>${art}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg.replaceAll('&', '&amp;'))}`
}
