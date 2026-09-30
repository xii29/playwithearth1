const entries = {
  home: 'example-gallery',
  space: 'space-particles', typing: 'typing-game', claw: 'claw-machine', sampler: 'sampler',
  hand: 'hand-tracking', water: 'water-touch', balloon: 'balloon', lab: 'flower-lab',
  rubber: 'rubber-human', shampoo: 'shampoo', doodle: 'doodle-face', travel: 'travel',
  aquarium: 'aquarium', sniper: 'sniper', earth: 'earth-village',
  'body-fx': 'body-cloud-example',
  afterglow: 'body-cloud-example',
  money: 'body-examples',
}

// Fetch only the selected module graph early. modulepreload does not execute
// setup functions, request cameras, or initialize any unselected example.
export function selectedPreload() {
  let base = '/'
  return {
    name: 'selected-example-preload',
    configResolved(config) { base = config.base },
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        // During development Vite owns dependency discovery/HMR. Do not race
        // raw TS modulepreloads against its optimizer's versioned requests.
        if (!context.bundle) return []
        const paths = {}
        for (const [name, source] of Object.entries(entries)) {
          const chunk = Object.values(context.bundle).find((item) => item.type === 'chunk' && item.facadeModuleId?.replaceAll('\\', '/').endsWith(`/src/${source}.ts`))
          if (!chunk) continue
          const files = new Set()
          const visit = (item) => {
            if (files.has(item.fileName)) return
            files.add(item.fileName)
            for (const dependency of item.imports) {
              const imported = context.bundle[dependency]
              if (imported?.type === 'chunk') visit(imported)
            }
          }
          visit(chunk)
          paths[name] = [...files].map((file) => `${base}${file}`)
        }
        return [{ tag: 'script', injectTo: 'head', children: `(()=>{const entries=${JSON.stringify(paths)};const name=location.hash.slice(1);for(const href of entries[Object.hasOwn(entries,name)?name:'home']||[]){const link=document.createElement('link');link.rel='modulepreload';link.href=href;link.crossOrigin='';document.head.append(link)}})();` }]
      },
    },
  }
}
