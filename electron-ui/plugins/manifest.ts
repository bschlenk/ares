import {networkOrigin, NETWORK_LIMITS} from './network-contracts.js'
import {
  CAPABILITIES,
  type PluginManifest,
  type GameIdentity,
} from './contracts.js'
const id = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/
const text = (v: unknown, max = 80): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= max &&
  !/[\x00-\x1f]/.test(v)
const object = (v: any, keys: string[]) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).every((k) => keys.includes(k))
export function entryPath(value: unknown): value is string {
  return (
    text(value, 240) &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.includes('%') &&
    !value.includes(':') &&
    value.split('/').every((p) => p !== '.' && p !== '..' && p.length > 0)
  )
}
export function validateManifest(value: unknown): PluginManifest {
  const m = value as any
  const fail = (message: string): never => {
    throw new Error(`Invalid plugin manifest: ${message}`)
  }
  if (
    !object(m, [
      'id',
      'name',
      'version',
      'apiVersion',
      'entry',
      'build',
      'styles',
      'mode',
      'storageVersion',
      'activation',
      'capabilities',
      'network',
      'contributes',
    ])
  )
    fail('unknown fields or invalid object')
  if (!text(m.id, 96) || !id.test(m.id))
    fail('id must be a lowercase namespaced identifier')
  if (
    !text(m.name) ||
    !text(m.version, 32) ||
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(m.version)
  )
    fail('name or version')
  if (m.apiVersion !== 1) fail('supported apiVersion is 1')
  if (!entryPath(m.entry) || !/\.(?:m?js)$/.test(m.entry))
    fail('entry must be a relative built .js/.mjs file')
  if (
    m.build !== undefined &&
    (!object(m.build, ['entry', 'jsxFactory', 'jsxFragment']) ||
      !entryPath(m.build.entry) ||
      !/\.(?:[cm]?[jt]sx?)$/.test(m.build.entry) ||
      [m.build.jsxFactory, m.build.jsxFragment].some(
        (v: unknown) =>
          v !== undefined &&
          (typeof v !== 'string' ||
            !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(v)),
      ))
  )
    fail('build requires a relative JS/TS/TSX source and valid JSX identifiers')
  if (
    m.styles !== undefined &&
    (!entryPath(m.styles) || !m.styles.endsWith('.css'))
  )
    fail('styles must be relative CSS')
  if (
    m.mode !== undefined &&
    !['panel', 'overlay', 'page', 'shell'].includes(m.mode)
  )
    fail('unknown extension mode')
  if (
    m.storageVersion !== undefined &&
    (!Number.isSafeInteger(m.storageVersion) ||
      m.storageVersion < 1 ||
      m.storageVersion > 10000)
  )
    fail('storageVersion')
  if (
    !Array.isArray(m.capabilities) ||
    m.capabilities.length > CAPABILITIES.length ||
    new Set(m.capabilities).size !== m.capabilities.length ||
    m.capabilities.some((v: any) => !CAPABILITIES.includes(v))
  )
    fail('capabilities')
  let normalizedOrigins:string[]|undefined
  const networking = m.capabilities.some((c:string)=>c==='network.request'||c==='network.websocket')
  if(networking || m.network!==undefined){
    if(!networking || !object(m.network,['origins']) || !Array.isArray(m.network.origins) || !m.network.origins.length || m.network.origins.length>NETWORK_LIMITS.origins)fail('network requires a networking capability and 1–32 exact origins')
    let origins:string[]
    try{origins=m.network.origins.map(networkOrigin)}catch{fail('network origins must be HTTP(S)/WS(S) origins without paths, credentials or wildcards')}
    if(new Set(origins!).size!==origins!.length)fail('duplicate network origin')
    for(const origin of origins!){
      const capability=origin.startsWith('ws')?'network.websocket':'network.request'
      if(!m.capabilities.includes(capability))fail('network origin requires '+capability)
    }
    normalizedOrigins=origins!
  }
  if (!object(m.contributes, ['panels', 'commands', 'settings'])) fail('contributes')
  for (const [kind, max] of [
    ['panels', 8],
    ['commands', 64],
    ['settings', 8],
  ] as const)
    if (m.contributes[kind] !== undefined) {
      const list = m.contributes[kind]
      if (!Array.isArray(list) || list.length > max) fail(`too many ${kind}`)
      const names = new Set()
      for (const item of list) {
        if (
          !object(item, kind === 'panels' ? ['id', 'title', 'placement'] : ['id', 'title']) ||
          (kind === 'panels' && item.placement !== undefined && !['input-settings', 'modal'].includes(item.placement)) ||
          !text(item.id, 64) ||
          !id.test(item.id) ||
          !text(item.title) ||
          names.has(item.id)
        )
          fail(`invalid/duplicate ${kind} contribution`)
        names.add(item.id)
      }
    }
  if (m.activation !== undefined) {
    const a = m.activation
    if (!object(a, ['systems', 'games'])) fail('activation')
    if (
      a.systems !== undefined &&
      (!Array.isArray(a.systems) ||
        !a.systems.length ||
        a.systems.length > 40 ||
        a.systems.some((s: any) => !text(s)))
    )
      fail('activation systems')
    if (
      a.games !== undefined &&
      (!Array.isArray(a.games) || !a.games.length || a.games.length > 32)
    )
      fail('activation games')
    for (const g of a.games ?? [])
      if (
        !object(g, ['profile', 'sha256', 'revision']) ||
        !text(g.profile, 96) ||
        !id.test(g.profile) ||
        typeof g.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(g.sha256) ||
        (g.revision !== undefined && !text(g.revision))
      )
        fail('game profile requires verified SHA-256')
  }
  return JSON.parse(JSON.stringify({...m,...(normalizedOrigins?{network:{origins:normalizedOrigins}}:{})}))
}
export function activation(
  manifest: PluginManifest,
  system: string,
  game: GameIdentity | null,
): { matches: boolean; profile: string | null } {
  if (
    manifest.activation?.systems &&
    !manifest.activation.systems.includes(system)
  )
    return { matches: false, profile: null }
  const games = manifest.activation?.games
  if (!games) return { matches: true, profile: null }
  const match = game && games.find((g) => g.sha256 === game.sha256)
  return { matches: !!match, profile: match ? match.profile : null }
}
