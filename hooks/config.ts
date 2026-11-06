// The Boxis settings a person changes: on/off, background intensity and the colour of each type.
// Pure functions; $.store keeps them, in register.tsx.
//
// Earlier versions stored and accepted Portuguese words. Every Portuguese word left in this file is
// such a legacy alias: it lets an old saved config, and the old /boxis words, keep working.

import type { BoxType } from './split'

export const TYPES: BoxType[] = ['body', 'decision', 'warning', 'scope', 'document', 'object', 'test', 'wrap-up', 'about-you']

// Name a person types (or an old config holds) → type. The English name is the one shown.
const NAMES: Record<string, BoxType> = {
  body: 'body', decision: 'decision', warning: 'warning', scope: 'scope', document: 'document',
  object: 'object', test: 'test', 'wrap-up': 'wrap-up', wrapup: 'wrap-up', 'about-you': 'about-you', aboutyou: 'about-you',
  // Legacy aliases, with and without accents; the camel-case one is the key old configs and pins hold.
  corpo: 'body', decisao: 'decision', 'decisão': 'decision', aviso: 'warning', escopo: 'scope',
  documento: 'document', objeto: 'object', teste: 'test', fechamento: 'wrap-up',
  'sobre-voce': 'about-you', 'sobre-você': 'about-you', sobrevoce: 'about-you', 'sobrevocê': 'about-you', sobreVoce: 'about-you',
}
// hasOwn: "constructor" and the other prototype keys are not types.
const fromName = (k: string): BoxType | undefined => Object.hasOwn(NAMES, k) ? NAMES[k] : undefined
export const typeFromName = (name: string): BoxType | undefined => fromName(name.trim()) ?? fromName(name.trim().toLowerCase())

type TypeStyle = { color?: string; background?: string | 'none' }
// The look and effects of the boxes. The order is the one the panel button cycles through.
export type Skin = 'none' | 'animated-i' | 'animated-ii'
export const SKINS: Skin[] = ['none', 'animated-i', 'animated-ii']
// Legacy animation values (the old key), accents already stripped; retired 'svg' reads as none.
const LEGACY_SKINS: Record<string, Skin> = { nenhuma: 'none', relogio: 'animated-i', clock: 'animated-i', client: 'animated-i' }
const skinFrom = (v: unknown): Skin | undefined => {
  if (typeof v !== 'string') return undefined
  const s = Object.hasOwn(LEGACY_SKINS, v) ? LEGACY_SKINS[v] : v
  return SKINS.includes(s as Skin) ? s as Skin : undefined
}
export function nextSkin(s: Skin): Skin {
  const i = SKINS.indexOf(s)
  return SKINS[(i + 1) % SKINS.length]
}

// Where the pin and check buttons sit on the box.
export type Buttons = 'top' | 'bottom'
const BUTTONS: Buttons[] = ['top', 'bottom']
const buttonsFrom = (v: unknown): Buttons | undefined => BUTTONS.includes(v as Buttons) ? v as Buttons : undefined

export type Config = { enabled: boolean; intensity: number; light: boolean; check: boolean; skin: Skin; buttons: Buttons; maxPins: number; types: Partial<Record<BoxType, TypeStyle>> }

export const DEFAULTS: Config = { enabled: true, intensity: 50, light: false, check: true, skin: 'none', buttons: 'top', maxPins: 5, types: {} }

// Pins per session: a short list stays a list of what matters now, not a second transcript.
export const MIN_PINS = 1
export const MAX_PINS = 10
const clampPins = (n: number) => Math.max(MIN_PINS, Math.min(MAX_PINS, Math.round(n)))

// A box checked as understood turns green, whatever its type.
export const GREEN = '#5CB85C'

// Colours the panel offers, in the order its ◀ ▶ buttons step through.
export const PALETTE = [
  '#7F77DD', '#4A90E2', '#3FB6B2', '#5CB85C', '#A3BE3C', '#E0B040', '#F08A3C',
  '#E05D5D', '#E06AA8', '#B39DDB', '#9AA0A6', '#B0B0B0', '#6B6B6B',
]
export function nextColor(current: string, step: 1 | -1): string {
  const i = PALETTE.indexOf(current.toUpperCase())
  const n = PALETTE.length
  return PALETTE[i < 0 ? 0 : (i + step + n) % n]
}

// The screen background the colours mix into: dark or light.
export const SCREEN = { dark: '#121212', light: '#F7F7F7' }

// Border and title colour of each type: fixed colours by meaning.
export const BASE: Record<BoxType, { color: string; border: string; title?: string; noBackground?: boolean }> = {
  body: { color: '#7F77DD', border: 'round' },
  decision: { color: '#4A90E2', border: 'bold', title: 'your call' },
  warning: { color: '#E0B040', border: 'round', title: 'warning' },
  scope: { color: '#9AA0A6', border: 'round', title: 'left out' },
  document: { color: '#B0B0B0', border: 'round', title: 'documents' },
  object: { color: '#B0B0B0', border: 'round', title: 'to apply' },
  test: { color: '#B39DDB', border: 'round', title: 'test for you' },
  'wrap-up': { color: '#5CB85C', border: 'round', title: 'wrap-up' },
  // A question about the reader: the least emphasis of all, no background.
  'about-you': { color: '#6B6B6B', border: 'single', title: 'about you', noBackground: true },
}

const HEX = /^#[0-9a-fA-F]{6}$/
const isColor = (s: unknown): s is string => typeof s === 'string' && HEX.test(s)

// The background is the border colour mixed into the screen background; intensity says how much.
export function mix(a: string, b: string, k: number): string {
  const p = (s: string, i: number) => parseInt(s.slice(1 + 2 * i, 3 + 2 * i), 16)
  const c = [0, 1, 2].map(i => Math.round(p(a, i) * (1 - k) + p(b, i) * k))
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}

export function style(cfg: Config, t: BoxType): { color: string; background?: string; border: string; title?: string } {
  const base = BASE[t]
  const s = cfg.types[t] ?? {}
  const color = isColor(s.color) ? s.color : base.color
  let background: string | undefined
  if (s.background === 'none') background = undefined
  else if (isColor(s.background)) background = s.background
  else if (!base.noBackground && cfg.intensity > 0) background = mix(cfg.light ? SCREEN.light : SCREEN.dark, color, 0.36 * cfg.intensity / 100)
  return { color, background, border: base.border, title: base.title }
}

const asObject = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, unknown>
// The new key when it is there, else its legacy name.
const pick = (o: Record<string, unknown>, key: string, legacy: string) => Object.hasOwn(o, key) ? o[key] : o[legacy]

// Whatever comes from $.store: only what has the right shape passes. Reads the current shape and
// the legacy one, and always returns the current one.
export function readConfig(v: unknown): Config {
  const o = asObject(v)
  const types: Config['types'] = {}
  // Legacy entries first, so a current entry for the same type wins.
  for (const source of [asObject(o.tipos), asObject(o.types)]) {
    for (const [name, raw] of Object.entries(source)) {
      const type = typeFromName(name)
      if (!type || !raw || typeof raw !== 'object') continue
      const a = raw as Record<string, unknown>
      const color = pick(a, 'color', 'cor')
      const background = pick(a, 'background', 'fundo')
      const s: TypeStyle = {}
      if (isColor(color)) s.color = color
      if (isColor(background)) s.background = background
      else if (background === 'none' || background === 'nenhum') s.background = 'none'
      if (s.color || s.background) types[type] = s
    }
  }
  const raw = pick(o, 'intensity', 'intensidade')
  const i = typeof raw === 'number' ? Math.round(raw) : DEFAULTS.intensity
  // Without skin, the legacy animation keys still count; a bad value or the retired 'svg' reads as none.
  const skin = skinFrom(Object.hasOwn(o, 'skin') ? o.skin : pick(o, 'animation', 'animacao')) ?? DEFAULTS.skin
  const buttons = buttonsFrom(o.buttons) ?? DEFAULTS.buttons
  const maxPins = typeof o.maxPins === 'number' && isFinite(o.maxPins) ? clampPins(o.maxPins) : DEFAULTS.maxPins
  return {
    enabled: pick(o, 'enabled', 'ligado') !== false,
    intensity: Math.max(0, Math.min(100, i)),
    light: pick(o, 'light', 'claro') === true,
    check: o.check !== false,
    skin,
    buttons,
    maxPins,
    types,
  }
}

// A requested change (from the command or the tool). Returns the new config or the error.
export type Change = {
  enabled?: boolean
  light?: boolean
  check?: boolean
  skin?: string
  buttons?: string
  intensity?: number
  maxPins?: number
  types?: Record<string, { color?: string; background?: string }>
  reset?: boolean
}

// Words that restore a field to the original, and words that remove the background.
const RESTORE = ['default', 'auto', 'padrao', 'padrão']
const NO_BACKGROUND = ['none', 'nenhum']

export function apply(cfg: Config, m: Change): { cfg: Config } | { error: string } {
  const next: Config = m.reset
    ? { ...DEFAULTS, types: {}, enabled: cfg.enabled, light: cfg.light, check: cfg.check, skin: cfg.skin, buttons: cfg.buttons, maxPins: cfg.maxPins }
    : { ...cfg, types: { ...cfg.types } }
  if (m.enabled !== undefined) next.enabled = !!m.enabled
  if (m.light !== undefined) next.light = !!m.light
  if (m.check !== undefined) next.check = !!m.check
  if (m.skin !== undefined) {
    // Any case, with or without accents; "animated i" and "Animated II" count too.
    const typed = String(m.skin).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-')
    const s = skinFrom(typed)
    if (!s) return { error: 'skin: none, animated-i or animated-ii.' }
    next.skin = s
  }
  if (m.buttons !== undefined) {
    const b = buttonsFrom(String(m.buttons).trim().toLowerCase())
    if (!b) return { error: 'buttons: top or bottom.' }
    next.buttons = b
  }
  if (m.intensity !== undefined) {
    if (typeof m.intensity !== 'number' || !isFinite(m.intensity) || m.intensity < 0 || m.intensity > 100) {
      return { error: 'intensity goes from 0 (no background) to 100 (strong background).' }
    }
    next.intensity = Math.round(m.intensity)
  }
  if (m.maxPins !== undefined) {
    if (typeof m.maxPins !== 'number' || !isFinite(m.maxPins)) return { error: `max pins goes from ${MIN_PINS} to ${MAX_PINS}.` }
    next.maxPins = clampPins(m.maxPins)
  }
  for (const [name, request] of Object.entries(m.types ?? {})) {
    const type = typeFromName(name)
    if (!type) return { error: `type "${name}" does not exist. Types: ${TYPES.join(', ')}.` }
    const s: TypeStyle = { ...(next.types[type] ?? {}) }
    for (const field of ['color', 'background'] as const) {
      const v = request?.[field]
      if (v === undefined) continue
      if (RESTORE.includes(v)) delete s[field]
      else if (field === 'background' && NO_BACKGROUND.includes(v)) s.background = 'none'
      else if (isColor(v)) s[field] = v.toUpperCase()
      else return { error: `${field} "${v}" is not a #RRGGBB color${field === 'background' ? ', "none"' : ''} nor "default".` }
    }
    if (s.color || s.background) next.types[type] = s
    else delete next.types[type]
  }
  return { cfg: next }
}

export function summary(cfg: Config): string {
  const lines = [
    `Boxis ${cfg.enabled ? 'on' : 'off'} · background intensity ${cfg.intensity} · ${cfg.light ? 'light' : 'dark'} screen · check ${cfg.check ? 'on' : 'off'} · skin ${cfg.skin} · buttons ${cfg.buttons} · max pins ${cfg.maxPins}`,
    ...TYPES.map(t => {
      const v = style(cfg, t)
      const changed = cfg.types[t] ? ' (adjusted)' : ''
      return `  ${t.padEnd(11)} border ${v.color} · background ${v.background ?? 'none'}${changed}`
    }),
  ]
  return lines.join('\n')
}

export const HELP = [
  '/boxis                                opens the config panel',
  '/boxis status                         shows the config as text',
  '/boxis pins                           opens the pins of this session (⚲ on a box pins it)',
  '/boxis pins max 1-10                  pins kept per session; past it, pinning drops the oldest',
  '/boxis on | off                       turns the boxes on or off',
  '/boxis screen light | dark            backgrounds for a light or a dark screen',
  '/boxis check on | off                 ✓ button to mark a box as understood',
  '/boxis skin none|animated-i|animated-ii   look and effects of the boxes',
  '/boxis buttons top|bottom             the pin and check buttons at the top right or the bottom right of the box',
  '/boxis intensity 0-100                how much colour goes into the background (0 = no background)',
  '/boxis color <type> #RRGGBB           border and title colour (default restores the original)',
  '/boxis background <type> #RRGGBB      fixed background (none removes it, default restores the automatic one)',
  '/boxis default                        restores every colour and the intensity to the original',
  `Types: ${TYPES.join(', ')}`,
].join('\n')

// What the person types after /boxis becomes a change. The English word rules; the legacy
// Portuguese words (tela, animacao, intensidade, cor, fundo, padrao, ...) and the old animation command stay as aliases.
export function parseCommand(args: string): Change | 'status' | 'panel' | 'pins' | { error: string } {
  const p = args.trim().split(/\s+/).filter(Boolean)
  const [c, a, b] = [p[0]?.toLowerCase(), p[1], p[2]]
  const a2 = a?.toLowerCase()
  if (!c) return 'panel'
  if (c === 'status') return 'status'
  if ((c === 'pins' || c === 'pin' || c === 'fixadas') && a2 === 'max' && b !== undefined) return { maxPins: Number(b) }
  if (c === 'pins' || c === 'pin' || c === 'fixadas') return 'pins'
  if (c === 'screen' || c === 'tela') {
    if (a2 === 'light' || a2 === 'clara') return { light: true }
    if (a2 === 'dark' || a2 === 'escura') return { light: false }
  }
  if (c === 'check' && (a2 === 'on' || a2 === 'off')) return { check: a2 === 'on' }
  if (c === 'on' || c === 'ligar' || c === 'liga') return { enabled: true }
  if (c === 'off' || c === 'desligar' || c === 'desliga') return { enabled: false }
  if (c === 'default' || c === 'reset' || c === 'padrao' || c === 'padrão') return { reset: true }
  // "skin animated ii": the words after the command join back into one value.
  if (c === 'skin' && a) return { skin: p.slice(1).join(' ') }
  // The old command stays as an alias: its values map by the same legacy table.
  if ((c === 'animation' || c === 'animacao' || c === 'animação') && a) return { skin: a }
  if ((c === 'buttons' || c === 'button') && a) return { buttons: a }
  if (c === 'intensity' || c === 'intensidade') return { intensity: Number(a) }
  if ((c === 'color' || c === 'cor' || c === 'background' || c === 'fundo') && a && b) {
    const field = c === 'color' || c === 'cor' ? 'color' : 'background'
    const word = b.toLowerCase().replace('padrão', 'padrao')
    return { types: { [a]: { [field]: RESTORE.includes(word) || NO_BACKGROUND.includes(word) ? word : b } } }
  }
  return { error: HELP }
}
