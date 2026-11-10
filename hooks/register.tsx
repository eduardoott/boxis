import type { EngineInterface, Register, RenderSurface, UiScrollArgs } from 'claude-code'
import { split, type BoxType } from './split'
import { BASE, GREEN, HELP, MAX_PINS, MIN_PINS, SCREEN, TYPES, WHITE, apply, mix, nextColor, nextSkin, parseCommand, readConfig, style, summary, thicker, typeFromName, type Change, type Config } from './config'
import { columnWeights, hasTable, splitTables } from './table'
import type { GlowLap, GlowProps } from './glow'
import { BLINKS, BLINK_MS, CLOSE_MS, PIN, type TitleProps } from './title'
export { BLINKS, BLINK_MS, CLOSE_MS }
import { closesFence, fenceOpenAtEnd, hasFence, openFence, type Fence } from './fence'

// Spacing inside the boxes, in cells.
const SPACE_Y = 1
const SPACE_X = 1

// Skins gives up above this; Boxis does too: the whole answer goes into a single box.
const MAX_SPLIT = 9000

// The types whose title carries the dot that pulses when the answer arrives.
const PULSING_TYPES: BoxType[] = ['warning', 'decision']
// A pulse chain past its window: frame 0 is the only one that starts the title's pulse.
const FINISHED = -1
// Only the latest answers that pulsed stay in the map, so it does not grow forever.
const MAX_PULSES = 50
// Fallback: up to this long after the turn ends, a block that missed the signature still adopts the pulse.
const WINDOW_MS = 1000
// Animated skins: until here the title may still start its pulse. Longer than the dot animation
// and than WINDOW_MS; after it, a redraw or a remount never repeats the pulse.
const PULSE_WINDOW_MS = 3000
// Closing a box: its own border blinks (Animated I) or ramps to green (Neon) and the background
// follows, redrawn by the hook every BLINK_MS. The only line that lands on the app's thin border.
const CLOSING_BACKGROUND = { lit: 0.22, dim: 0.1 }
const CLOSING_BORDER = 0.35
// Neon: the background and the border per closing step, capped.
const NEON_CLOSING = { background: (step: number) => Math.min(0.4, 0.08 + step * 0.04), border: (step: number) => Math.min(0.5, step * 0.06) }
const NEON_CLOSE_LAPS = 2
export const ARRIVAL_GLOW_MS = 1400
// Neon: the draw-in ends with the glow's post; this much later the hook gives up waiting for it.
const ARRIVAL_GRACE_MS = 500
export const PIN_GLOW_MS = 600
// How much white each tail cell of the glow gets, from the head to the end.
const TAIL = [0.85, 0.65, 0.45, 0.3, 0.15]
// Neon: how much white the title shimmer gets, head first, then its tail.
const SHIMMER_TAIL = [0.85, 0.6, 0.4, 0.2]
// Box and title under the pointer, and the Neon title: how much white goes in.
const HOVER_BORDER = 0.35
const NEON_TITLE = 0.15
const MAX_SEEN = 200

const CONFIG_KEY = 'config'
const CHECKED_KEY = 'checked'
// Earlier versions kept the check marks under this key: read only while CHECKED_KEY is missing.
const LEGACY_CHECKED_KEY = 'lidas'
// Only the latest checks are kept, so the list does not grow forever.
const MAX_CHECKED = 2000
// Markdown has no strikethrough prop: each line gets ~~ inside its list or heading marker, or the
// list stops being a list. Code blocks and table rows stay as they are.
const MARKER = /^(\s*(?:[-*+]|\d+[.)]|#{1,6}|>)\s+)?(.*)$/
function strike(text: string): string {
  let fence: Fence | null = null
  return text.split('\n').map(line => {
    if (fence) { if (closesFence(line, fence)) fence = null; return line }
    fence = openFence(line)
    if (fence || !line.trim() || /^\s*\|/.test(line)) return line
    const [, marker = '', rest] = line.match(MARKER) ?? []
    return rest?.trim() ? `${marker}~~${rest.trim()}~~` : line
  }).join('\n')
}

const TOOL = 'mcp__boxis__design'
const CONFIG_PANE = 'boxis-config'

// Every write goes through here: a failure (full store, disk) becomes a toast, never a loose rejection.
async function save($: EngineInterface, key: string, value: unknown, what: string): Promise<boolean> {
  try {
    await $.store.set(key, value)
    return true
  } catch {
    warnFailure($, what)
    return false
  }
}
function warnFailure($: EngineInterface, what: string) {
  try { $.ui.toast(`Boxis: could not save ${what}`) } catch {}
}
// For onPress: whatever fails before the write (the store read) also becomes the toast.
function attempt($: EngineInterface, done: Promise<unknown>, what: string) {
  done.catch(() => warnFailure($, what))
}

// A copy of the saved config, for drawing; whoever changes it reads the store again first.
let config: Config | null = null
async function current($: EngineInterface): Promise<Config> {
  if (!config) config = readConfig(await $.store.get(CONFIG_KEY))
  return config
}
// Another window may have changed the config: one store read refreshes the copy.
async function fresh($: EngineInterface): Promise<Config> {
  config = readConfig(await $.store.get(CONFIG_KEY))
  return config
}
async function change($: EngineInterface, m: Change): Promise<{ text: string; error?: boolean }> {
  // Read again from the store: the CLI and the app write the same config, and the copy may be stale.
  const r = apply(readConfig(await $.store.get(CONFIG_KEY)), m)
  if ('error' in r) return { text: r.error, error: true }
  if (!await save($, CONFIG_KEY, r.cfg, 'the config')) return { text: 'Boxis: could not save the config', error: true }
  config = r.cfg
  $.ui.invalidate('ui.render')
  return { text: summary(r.cfg) }
}

// Boxes checked as understood, by "signature of the answer text:position of the box".
// The id the screen gives the message does not work: live it is the API msg_, reopened the row uuid.
// The order is the order of checking, latest last: that is what the cap keeps.
let checked: string[] | null = null
// True when the last disk read found the marks only under the legacy key.
let fromLegacy = false
async function readChecked($: EngineInterface, fromDisk = false): Promise<string[]> {
  if (!checked || fromDisk) {
    let stored = await $.store.get(CHECKED_KEY)
    fromLegacy = false
    if (stored === undefined || stored === null) {
      stored = await $.store.get(LEGACY_CHECKED_KEY)
      fromLegacy = stored !== undefined && stored !== null
    }
    checked = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : []
  }
  return checked
}
// Adds (on) or removes the ids, reading from disk again: the CLI and the app write the same file.
// The requested state, not a toggle: a click on a stale copy would undo the other process's mark.
async function check($: EngineInterface, ids: string[], on: boolean) {
  const these = new Set(ids)
  const before = await readChecked($, true)
  const others = before.filter(x => !these.has(x))
  const next = (on ? [...others, ...these] : others).slice(-MAX_CHECKED)
  if (!await save($, CHECKED_KEY, next, 'the check marks')) return
  // The marks now live under CHECKED_KEY: the old key is only garbage, deleted once.
  if (fromLegacy) {
    try { await $.store.delete(LEGACY_CHECKED_KEY) } catch {}
    fromLegacy = false
  }
  checked = next
  // A box marked as understood no longer needs keeping at hand; unchecking never pins it back.
  if (on && (await readPins($)).some(p => these.has(p.id))) await savePins($, list => list.filter(p => !these.has(p.id)))
  $.ui.invalidate('ui.render')
  const added = on ? [...these].filter(id => !before.includes(id)).length : 0
  if (added) celebrate($, added)
}
// A signal other mods can listen to (to play an effect, say): a state write, not a slash command, so it leaves
// no chat line and costs no tokens. With nobody listening, nothing happens.
const CELEBRATE = { plugin: 'boxis', key: 'celebrate' } as const
// How many boxes the click marked ("up to here" marks many), written just before the celebrate bump.
const CHECKS = { plugin: 'boxis', key: 'checks' } as const
function celebrate($: EngineInterface, added: number) {
  void $.state.set(CHECKS, added)
    .then(() => $.clock.now()).then(t => $.state.set(CELEBRATE, t)).catch(() => {})
}
// 32-bit FNV-1a plus the length: short to store and stable across sessions.
export function signature(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return `${(h >>> 0).toString(36)}.${text.length.toString(36)}`
}

// "Up to here": every answer the screen drew in this session (the history on opening and the new
// ones), by signature with its box count. A box that was never drawn is left out.
const drawn = new Map<string, number>()
const MAX_DRAWN = 1000
function seeDrawn(key: string, boxes: number) {
  drawn.delete(key)
  drawn.set(key, boxes)
  for (const old of drawn.keys()) {
    if (drawn.size <= MAX_DRAWN) break
    drawn.delete(old)
  }
}
// "Up to here": the box, the earlier boxes of its answer and every answer before it. Pinned boxes are
// left out: a pin is kept on purpose, and checking would unpin it.
// drawn is in drawing order, so the conversation order comes from the session. An answer that matches
// no message is left alone: checking too little beats checking too much.
async function checkUpTo($: EngineInterface, boxId: string) {
  const cut = boxId.lastIndexOf(':')
  const answer = boxId.slice(0, cut)
  const last = Number(boxId.slice(cut + 1))
  if (!Number.isInteger(last)) return
  const order = await answerOrder($)
  const before = order.includes(answer) ? order.slice(0, order.indexOf(answer)) : []
  const ids: string[] = []
  for (const key of before) for (let i = 0; i < (drawn.get(key) ?? 0); i++) ids.push(`${key}:${i}`)
  for (let i = 0; i <= last; i++) ids.push(`${answer}:${i}`)
  const pinned = new Set((await readPins($)).map(p => p.id))
  await check($, ids.filter(id => !pinned.has(id)), true)
}
// The drawn answers in conversation order. The screen may draw a message without its leading line breaks.
async function answerOrder($: EngineInterface): Promise<string[]> {
  let messages: readonly { role: string; text: string }[] = []
  try { messages = await $.session.messages() } catch {}
  const order: string[] = []
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.text) continue
    const key = [m.text, m.text.replace(/^\n+/, ''), m.text.trim()].map(signature).find(k => drawn.has(k))
    if (key && !order.includes(key)) order.push(key)
  }
  return order
}

// Pulse of the new answer (animated skins), by signature of the trimmed text: turn.complete
// hands the answer trimmed and the screen draws the block without its leading line breaks.
// Memory only: an answer reopened from an old session is never here, so it does not pulse.
type Chain = { frame: number }
const pulses = new Map<string, Chain>()
function keepPulse(key: string, chain: Chain) {
  pulses.delete(key)
  pulses.set(key, chain)
  for (const old of pulses.keys()) {
    if (pulses.size <= MAX_PULSES) break
    pulses.delete(old)
  }
}
// Fallback for when the signature misses (the block the screen draws differs from the turn.complete
// text, which joins the blocks of the last message): a block drawn only inside the turn that fits
// whole in the answer adopts the chain, until WINDOW_MS after the turn ends.
let inTurn = false
let latest: { text: string; chain: Chain } | null = null
// Blocks already drawn outside a turn (the history on opening the session): those never adopt.
const seenOutside = new Set<string>()
// A set that keeps only the latest MAX_SEEN keys.
function keep(set: Set<string>, key: string) {
  set.delete(key)
  set.add(key)
  for (const old of set) {
    if (set.size <= MAX_SEEN) break
    set.delete(old)
  }
}
const seeOutside = (key: string) => keep(seenOutside, key)
// During the turn it only reads: the text grows with each chunk, and nothing is kept or pulses before the end.
function pulseOf(text: string): Chain | undefined {
  const trimmed = text.trim()
  const key = signature(trimmed)
  const chain = pulses.get(key)
  if (chain || inTurn) return chain
  if (latest && trimmed && !seenOutside.has(key) && latest.text.includes(trimmed)) {
    keepPulse(key, latest.chain)
    return latest.chain
  }
  seeOutside(key)
  return undefined
}

// Boxes closing, by the same id as the check mark, with the step 0..2*BLINKS-1: one redraw every
// BLINK_MS. Animated I blinks on the even steps; Neon ramps with the step.
const closing = new Map<string, number>()
// Exported so a test can pass a $ whose clock fails.
export function startClosing($: Pick<EngineInterface, 'clock' | 'ui'>, id: string) {
  if (closing.has(id)) return
  closing.set(id, 0)
  $.ui.invalidate('ui.render')
  let tick: { cancel: () => void } | undefined
  try {
    tick = $.clock.every(BLINK_MS, () => {
      // The last tick may land together with the end: do not bring the box back.
      if (!closing.has(id)) return
      closing.set(id, (closing.get(id) ?? 0) + 1)
      $.ui.invalidate('ui.render')
    })
    $.clock.after(CLOSE_MS, () => {
      tick?.cancel()
      closing.delete(id)
      $.ui.invalidate('ui.render')
    })
  } catch {
    // Without the end scheduled, the tick would blink forever.
    tick?.cancel()
    closing.delete(id)
    $.ui.invalidate('ui.render')
  }
}

// Neon: boxes whose arrival draw-in ended (the glow posted, or the grace timer gave up), those
// still waiting for it, and the pins just pressed (pinning).
const arrived = new Set<string>()
const drawingIn = new Set<string>()
const pinning = new Set<string>()
function arrive($: Pick<EngineInterface, 'ui'>, id: string) {
  drawingIn.delete(id)
  keep(arrived, id)
  $.ui.invalidate('ui.render')
}
// Called from the drawing, once per box: the border stays dim until the post or the grace timer.
function startDrawIn($: Pick<EngineInterface, 'clock' | 'ui'>, id: string) {
  if (drawingIn.has(id) || arrived.has(id)) return
  drawingIn.add(id)
  try {
    $.clock.after(ARRIVAL_GLOW_MS + ARRIVAL_GRACE_MS, () => { if (drawingIn.has(id)) arrive($, id) })
  } catch {
    drawingIn.delete(id)
  }
}
function startPinning($: Pick<EngineInterface, 'clock' | 'ui'>, id: string) {
  if (pinning.has(id)) return
  pinning.add(id)
  $.ui.invalidate('ui.render')
  try {
    $.clock.after(PIN_GLOW_MS, () => {
      pinning.delete(id)
      $.ui.invalidate('ui.render')
    })
  } catch {
    pinning.delete(id)
  }
}
// Pins: boxes the person pinned to come back to, per session. Stored as { [session]: Pin[] }.
const PINS_KEY = 'pins'
const PINS_PANE = 'boxis-pins'
const MAX_PIN_SESSIONS = 50
const MAX_EXCERPT = 60
// The box markdown travels with the pin so the pane can redraw it; the cap bounds the store size.
export const MAX_TEXT = 6000
// The whole store holds 4 MiB of JSON; pins get a slice, the rest is config and check marks.
export const PINS_BUDGET = 1.5 * 1024 * 1024
// One drawing holds 100,000 characters: the pane draws full boxes up to here, the rest as rows.
export const PANE_BUDGET = 80_000
// A pin saved before text was kept has none: the pane falls back to the title and excerpt row.
export type Pin = { id: string; type: BoxType; title: string; excerpt: string; text?: string; requestId?: string; created: number }
type BoxInfo = { type: BoxType; excerpt: string; text: string; requestId?: string; title?: string }

// The first line of the box with text, without markdown markers, on one short line.
// The _ stays: it would vanish from proc names (usp_x_y) if stripped.
export function excerptOf(text: string): string {
  const line = text.split('\n').map(l => l.trim()).find(l => l && !openFence(l)) ?? ''
  const clean = line
    .replace(/^(?:[-*+]|\d+[.)]|#{1,6}|>)\s+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|~~|`|\*/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > MAX_EXCERPT ? `${clean.slice(0, MAX_EXCERPT - 1).trimEnd()}…` : clean
}

// The markdown a pin keeps, up to MAX_TEXT: when cut, it ends in a visible "…" and closes the code
// block the cut left open, or the rest of the pane would turn into code.
export function pinText(text: string): string {
  if (text.length <= MAX_TEXT) return text
  const upTo = (n: number) => {
    const s = text.slice(0, n)
    return /[\uD800-\uDBFF]$/.test(s) ? s.slice(0, -1) : s
  }
  let cut = upTo(MAX_TEXT - 1)
  let open = fenceOpenAtEnd(cut)
  if (open) {
    cut = upTo(MAX_TEXT - 2 - open.n)
    open = fenceOpenAtEnd(cut)
  }
  return `${cut}…${open ? `\n${open.char.repeat(open.n)}` : ''}`
}

// UTF-8 bytes, which is what the store cap counts, not characters.
function bytes(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c < 0xdc00) { n += 4; i++ }
    else n += 3
  }
  return n
}

// Pins older than this go on the next write, from any session: a session that was archived or
// deleted never tells the mod, so its pins would otherwise stay until the byte budget pushed them out.
export const PIN_TTL_MS = 30 * 24 * 60 * 60 * 1000
export function dropExpired(all: Record<string, Pin[]>, now: number): Record<string, Pin[]> {
  const kept: Record<string, Pin[]> = {}
  for (const [s, list] of Object.entries(all)) {
    const rest = list.filter(p => now - p.created < PIN_TTL_MS)
    if (rest.length) kept[s] = rest
  }
  return kept
}

// Over the budget: the oldest pins go, first those of other sessions, then those of this one.
export function fitBudget(all: Record<string, Pin[]>, session: string, budget = PINS_BUDGET): Record<string, Pin[]> {
  let total = bytes(JSON.stringify(all))
  if (total <= budget) return all
  const byAge = (a: { p: Pin }, b: { p: Pin }) => a.p.created - b.p.created
  const of = (others: boolean) => Object.entries(all)
    .filter(([s]) => (s !== session) === others)
    .flatMap(([s, list]) => list.map(p => ({ s, p })))
    .sort(byAge)
  const out = new Set<Pin>()
  for (const { p } of [...of(true), ...of(false)]) {
    if (total <= budget) break
    out.add(p)
    total -= bytes(JSON.stringify(p)) + 1
  }
  const kept: Record<string, Pin[]> = {}
  for (const [s, list] of Object.entries(all)) {
    const rest = list.filter(p => !out.has(p))
    if (rest.length) kept[s] = rest
  }
  return kept
}

// One stored pin, in the current shape or the legacy one (Portuguese keys tipo, titulo, trecho,
// texto, criado, and a Portuguese type name). Returns the current shape, or null when malformed.
export function readPin(v: unknown): Pin | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const at = (key: string, legacy: string) => Object.hasOwn(o, key) ? o[key] : o[legacy]
  const rawType = at('type', 'tipo')
  const type = typeof rawType === 'string' ? typeFromName(rawType) : undefined
  const title = at('title', 'titulo')
  const excerpt = at('excerpt', 'trecho')
  const text = at('text', 'texto')
  const created = at('created', 'criado')
  if (typeof o.id !== 'string' || !type || typeof title !== 'string' || typeof excerpt !== 'string'
    || typeof created !== 'number' || (text !== undefined && typeof text !== 'string')) return null
  return {
    id: o.id, type, title, excerpt,
    ...(typeof text === 'string' ? { text } : {}),
    ...(typeof o.requestId === 'string' ? { requestId: o.requestId } : {}),
    created,
  }
}

export function readAllPins(v: unknown): Record<string, Pin[]> {
  const all: Record<string, Pin[]> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return all
  for (const [session, list] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    const good = list.map(readPin).filter((p): p is Pin => p !== null)
    if (good.length) all[session] = good
  }
  return all
}
// Without a session id there is nowhere to keep them: null, never the '' key every session would share.
async function currentSession($: EngineInterface): Promise<string | null> {
  try {
    const id = String(await $.session.id())
    return id || null
  } catch {
    return null
  }
}
// After a /clear the id changes without session.start: the memory copy checks the session on every read.
let pins: { session: string; list: Pin[] } | null = null
async function readPins($: EngineInterface): Promise<Pin[]> {
  const session = await currentSession($)
  if (session === null) return []
  if (!pins || pins.session !== session) pins = { session, list: readAllPins(await $.store.get(PINS_KEY))[session] ?? [] }
  return pins.list
}
async function savePins($: EngineInterface, edit: (list: Pin[]) => Pin[]): Promise<boolean> {
  const session = await currentSession($)
  if (session === null) {
    try { $.ui.toast('Boxis: could not save the pins: no session id') } catch {}
    return false
  }
  // Read from disk again, like the check marks: the CLI and the app write the same file.
  const read = dropExpired(readAllPins(await $.store.get(PINS_KEY)), await $.clock.now())
  const list = edit(read[session] ?? [])
  delete read[session]
  if (list.length) read[session] = list
  const sessions = Object.keys(read)
  for (const old of sessions.slice(0, Math.max(0, sessions.length - MAX_PIN_SESSIONS))) delete read[old]
  const all = fitBudget(read, session)
  if (!await save($, PINS_KEY, all, 'the pins')) return false
  pins = { session, list: all[session] ?? [] }
  $.ui.invalidate('ui.render')
  return true
}

// What a pin needs from each drawn box: the Client title only posts its id.
const seenBoxes = new Map<string, BoxInfo>()
// The requestId differs between live and reopened: the last one the screen used for each answer is the one that scrolls.
const requests = new Map<string, string>()
function remember<V>(map: Map<string, V>, key: string, value: V) {
  map.delete(key)
  map.set(key, value)
  for (const old of map.keys()) {
    if (map.size <= MAX_DRAWN * 2) break
    map.delete(old)
  }
}

async function openPins($: EngineInterface, focus: boolean) {
  await $.ui.open({ id: PINS_PANE, title: 'Pins', closeOnEscape: true, ...(focus ? { focus: true } : {}) })
}
// Pins (on) or unpins: the requested state, like the check marks, so a click never undoes the other process's.
async function setPin($: EngineInterface, id: string, on: boolean, info?: BoxInfo) {
  let pinned = false
  let dropped: Pin[] = []
  const created = await $.clock.now()
  const cfg = await fresh($)
  const limit = cfg.unlimitedPins ? Infinity : cfg.maxPins
  const saved = await savePins($, list => {
    const has = list.some(p => p.id === id)
    if (!on) return has ? list.filter(p => p.id !== id) : list
    const c = info ?? seenBoxes.get(id)
    if (has || !c) return list
    pinned = true
    // At the limit the oldest pins of this session go first, so the new one fits.
    const kept = [...list]
    dropped = kept.splice(0, Math.max(0, kept.length + 1 - limit))
    return [...kept, { id, type: c.type, title: c.title ?? BASE[c.type].title ?? 'answer', excerpt: c.excerpt, text: pinText(c.text), ...(c.requestId ? { requestId: c.requestId } : {}), created }]
  })
  if (saved && dropped.length) {
    const which = dropped.map(p => `${p.title} "${p.excerpt}"`).join('; ')
    try { $.ui.toast(`Boxis: pin limit (${limit}) reached, unpinned the oldest: ${which}`) } catch {}
  }
  if (saved && pinned) await openPins($, false)
}
// The answer a pin click scrolls to: the last requestId seen for it, or the one stored in the pin.
export function jumpTarget(p: Pin): string | undefined {
  return requests.get(p.id.slice(0, p.id.lastIndexOf(':'))) ?? p.requestId
}
// The engine may refuse ({ deny }) or reject (no surface that scrolls): both become the reason.
async function scroll($: EngineInterface, args: UiScrollArgs): Promise<string | undefined> {
  try { return (await $.ui.scroll(args)).deny } catch (error) { return error instanceof Error ? error.message : String(error) }
}
async function jumpTo($: EngineInterface, p: Pin) {
  const requestId = jumpTarget(p)
  if (!requestId) {
    $.ui.toast('Could not jump to the box: its answer was not drawn in this session')
    return
  }
  // One call per click: a second one, after the await, no longer counts as the person's gesture.
  const deny = await scroll($, { to: { requestId }, block: 'start' })
  if (deny) $.ui.toast(`Could not jump to the box: ${deny}`)
}

// What drawing the content needs, in the chat and in the pins pane.
// The elements come from each hook's $.ui.resolve, and each surface's table has its own type.
// The $ travels apart: the engine refuses a $ kept inside an object.
type Painting = {
  cfg: Config; surface: RenderSurface; columns: number
  Box: any; Text: any; Markdown: any
}
const columnsOf = (viewport?: { columns?: number }) => Math.max(20, (viewport?.columns ?? 100) - 2 * SPACE_X - 2)

async function plain($: EngineInterface, p: Painting, text: string) {
  const { Markdown } = p
  let done
  // Without Skins $.skins does not exist and the call throws; the engine refuses $.skins?. so the catch is the normal path.
  try { done = await $.skins.markdown({ surface: p.surface, text, columns: p.columns }) } catch {}
  return done ?? <Markdown text={text} />
}

// Tables are drawn here, not by Skins: a long cell wraps instead of turning into "…".
function table(p: Painting, t: { header: string[]; rows: string[][] }, type: BoxType, key: string) {
  const { Box, Text, Markdown, cfg } = p
  const c = style(cfg, type)
  const zebra = mix(c.background ?? (cfg.light ? SCREEN.light : SCREEN.dark), c.color, 0.14)
  const w = columnWeights(t.header, t.rows)
  const cell = (text: string, k: number, head: boolean) => (
    <Box key={`c-${k}`} width={0} flexGrow={w[k]} flexShrink={1} paddingX={1}>
      {head ? <Text color={c.color} bold wrap="wrap">{text.replace(/\*\*/g, '')}</Text> : <Markdown text={text || ' '} />}
    </Box>
  )
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={c.color} width="100%">
      <Box key="head" flexDirection="row" backgroundColor={zebra}>{t.header.map((x, k) => cell(x, k, true))}</Box>
      {t.rows.map((l, i) => (
        <Box key={`r-${i}`} flexDirection="row" backgroundColor={i % 2 ? zebra : undefined}>{l.map((x, k) => cell(x, k, false))}</Box>
      ))}
    </Box>
  )
}

// segment draws the text outside the tables: in the chat it may still ask for the drawing below.
async function draw($: EngineInterface, p: Painting, text: string, type: BoxType, segment: (text: string) => Promise<unknown> = t => plain($, p, t)) {
  const { Box } = p
  const segments = splitTables(text)
  if (!segments.some(t => t.kind === 'table')) return segment(text)
  const parts = []
  for (const [k, t] of segments.entries()) {
    parts.push(t.kind === 'table' ? table(p, t, type, `tab-${k}`) : <Box key={`txt-${k}`} flexDirection="column">{await segment(t.text)}</Box>)
  }
  return <Box flexDirection="column" rowGap={1}>{parts}</Box>
}

const TYPES_LIST = TYPES.join(', ')

// Client titles that failed (ui.fault), by answer and box: those fall back to the plain title line.
const failedTitles = new Map<string, true>()
const failureOf = (requestId: string, element: string) => `${requestId} ${element}`
export const titleFailed = (requestId: string, element: string) => failedTitles.has(failureOf(requestId, element))
// With the buttons at the bottom the box has two Clients: a fault on either draws the box static.
const boxTitleFailed = (requestId: string, i: number) => titleFailed(requestId, `title-${i}`) || titleFailed(requestId, `title-b-${i}`)
// Rim glows that failed, by answer and box (`glow-${i}`): that box draws no glow, or it would remount on every redraw.
const failedGlows = new Map<string, true>()
export const glowFailed = (requestId: string, i: number) => failedGlows.has(failureOf(requestId, `glow-${i}`))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'boxis', description: 'Boxis: opens the colour panel, or on/off, intensity, skin, buttons and colour per type', argumentHint: '[status | pins | pins max N | on | off | check on|off | skin none|animated-i|animated-ii | buttons top|bottom | screen light|dark | intensity N | color <type> #hex | background <type> #hex | default]' })
    await $.tool.register({
      name: 'design',
      description: `Changes the look of the Boxis mod (the coloured boxes around the answers): on/off (enabled), the ✓ button that marks a box as understood (check), the skin, which is the look and effects of the boxes (skin: none, animated-i, animated-ii), where the pin and check buttons sit (buttons: top, bottom), background intensity (intensity, 0 to 100), light or dark screen (light), pins kept per session (maxPins, 1 to 10, or no limit with unlimitedPins) and, per type, the border and title colour (color) and the background colour (background). Types: ${TYPES_LIST}. A colour is #RRGGBB; "default" restores the original; background "none" removes the background. Returns the full config after the change. Call with no fields to only read it.`,
      inputSchema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'Boxes on (true) or off (false).' },
          check: { type: 'boolean', description: 'Shows the ✓ button that marks a box as understood.' },
          skin: { type: 'string', enum: ['none', 'animated-i', 'animated-ii'], description: 'Look and effects of the boxes: none is plain; animated-i animates the title line (pulse on arrival, hover, pin spin, check fill and wipe); animated-ii (Neon) adds bold borders, a draw-in on arrival, a shimmer across the title under the pointer, a closing ramp and a pin spark.' },
          buttons: { type: 'string', enum: ['top', 'bottom'], description: 'The pin and check buttons at the top right or the bottom right of the box.' },
          intensity: { type: 'number', minimum: 0, maximum: 100, description: 'Background intensity, 0 (no background) to 100 (strong background).' },
          types: {
            type: 'object',
            description: `Key is the type (${TYPES_LIST}). color is the border and title colour, background the background colour.`,
            additionalProperties: {
              type: 'object',
              properties: { color: { type: 'string' }, background: { type: 'string' } },
              additionalProperties: false,
            },
          },
          light: { type: 'boolean', description: 'true when the screen is light: backgrounds get lighter instead of darker.' },
          maxPins: { type: 'integer', minimum: 1, maximum: 10, description: 'Pins kept per session (default 5). Past it, pinning a box unpins the oldest.' },
          unlimitedPins: { type: 'boolean', description: 'true keeps every pin, with no per-session limit (default false: maxPins applies).' },
          reset: { type: 'boolean', description: 'Restores every colour and the intensity to the original.' },
        },
        additionalProperties: false,
      },
    })
    await fresh($)
    return r
  })

  on('command.run', { command: 'boxis' }, async ($, e) => {
    const request = parseCommand(e.args)
    if (request === 'panel') {
      await $.ui.open({ id: CONFIG_PANE, title: 'Boxis', focus: true, closeOnEscape: true })
      return {}
    }
    if (request === 'pins') {
      await openPins($, true)
      return {}
    }
    if (request === 'status') return { text: `${summary(await current($))}\n\n${HELP}` }
    if ('error' in request) return { text: request.error }
    return { text: (await change($, request)).text }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const r = await change($, (e.input ?? {}) as Change)
    return r.error ? { deny: r.text } : { result: r.text }
  })
    // A failure here must not read as "done": the model gets the refusal and the reason.
    .catch(($, e, next) => ({ deny: `Boxis could not change the config: ${next.error.message ?? next.error.kind}` }))

  // The main loop's turn: what the screen draws inside it is the answer arriving.
  on('turn.start', ($, e, next) => {
    if (!e.agentId) inTurn = true
    return next(e)
  })

  // A new answer: with an animated skin the title pulses. Here it only opens the window, with one
  // redraw and no beats. The mod only observes: it always returns next(e).
  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    inTurn = false
    try {
      const text = e.reason === 'answer' && typeof e.answer === 'string' ? e.answer.trim() : ''
      // Drawn again outside the turn, the answer joins the ones "up to here" can reach.
      if (text) $.ui.invalidate('ui.render')
      const skin = (await current($)).skin
      if (text && skin !== 'none') {
        const chain: Chain = { frame: 0 }
        keepPulse(signature(text), chain)
        latest = { text, chain }
        $.clock.after(WINDOW_MS, () => { if (latest?.chain === chain) latest = null })
        $.ui.invalidate('ui.render')
        $.clock.after(PULSE_WINDOW_MS, () => { chain.frame = FINISHED })
      }
    } catch {}
    return next(e)
  })

  // The title's check (animated skins) posts "closing" on the click and "checked" after the frames,
  // and "upTo" from the button the pointer on the check reveals;
  // the pin posts "pinning" (Neon) on the click and "pin" after its frames; the rim glow posts
  // "arrived" at the end of the draw-in.
  on('ui.message', async ($, e, next) => {
    const data = e.data as { checked?: unknown; closing?: unknown; upTo?: unknown; pin?: unknown; on?: unknown; pinning?: unknown; arrived?: unknown } | null
    if (!(e.element.startsWith('title-') || e.element.startsWith('glow-')) || !data || typeof data !== 'object') return next(e)
    if (typeof data.upTo === 'string') { await checkUpTo($, data.upTo); return {} }
    if (typeof data.closing === 'string') { startClosing($, data.closing); return {} }
    if (typeof data.pinning === 'string') { startPinning($, data.pinning); return {} }
    if (typeof data.arrived === 'string') { arrive($, data.arrived); return {} }
    // Pin and check mark come with the requested state; without on, it is malformed and passes on.
    if (typeof data.on !== 'boolean') return next(e)
    if (typeof data.pin === 'string') {
      const c = seenBoxes.get(data.pin)
      await setPin($, data.pin, data.on, c && { ...c, requestId: e.requestId })
      return {}
    }
    if (typeof data.checked !== 'string') return next(e)
    await check($, [data.checked], data.on)
    return {}
  })

  // A Client title that failed: the engine redraws the answer by itself, and it comes out with the plain line.
  on('ui.fault', ($, e, next) => {
    if (e.element.startsWith('title-')) remember(failedTitles, failureOf(e.requestId, e.element), true as const)
    if (e.element.startsWith('glow-')) remember(failedGlows, failureOf(e.requestId, `glow-${e.element.slice(e.element.lastIndexOf('-') + 1)}`), true as const)
    return next(e)
  })

  // The config pane: one row per type, with the sample and the colour and background buttons.
  on('ui.render', { component: 'Pane', requestId: CONFIG_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const cfg = await current($)
    const go = (m: Change) => () => attempt($, change($, m), 'the config')
    const row = (t: BoxType) => {
      const v = style(cfg, t)
      const s = cfg.types[t] ?? {}
      return (
        <Box key={`row-${t}`} flexDirection="row" gap={1}>
          <Text>{t.padEnd(11)}</Text>
          <Text color={v.color} backgroundColor={v.background} bold>{` ${BASE[t].title ?? 'answer'} `.padEnd(16)}</Text>
          <Button key={`color-prev-${t}`} label="◀" onPress={go({ types: { [t]: { color: nextColor(v.color, -1) } } })} />
          <Text color={v.color}>{v.color}</Text>
          <Button key={`color-next-${t}`} label="▶" onPress={go({ types: { [t]: { color: nextColor(v.color, 1) } } })} />
          <Button key={`background-${t}`} label={s.background === 'none' ? 'no background' : 'with background'}
            onPress={go({ types: { [t]: { background: s.background === 'none' ? 'default' : 'none' } } })} />
          {s.color || s.background ? <Button key={`default-${t}`} label="default" onPress={go({ types: { [t]: { color: 'default', background: 'default' } } })} /> : null}
        </Box>
      )
    }
    return (
      <Box flexDirection="column" gap={e.surface === 'terminal' ? 0 : 1}>
        <Box flexDirection="row" gap={1}>
          <Button key="enabled" label={cfg.enabled ? 'on' : 'off'} variant="primary" onPress={go({ enabled: !cfg.enabled })} />
          <Text dimColor>background intensity</Text>
          <Button key="intensity-down" label="−" onPress={go({ intensity: Math.max(0, cfg.intensity - 10) })} />
          <Text>{String(cfg.intensity).padStart(3)}</Text>
          <Button key="intensity-up" label="+" onPress={go({ intensity: Math.min(100, cfg.intensity + 10) })} />
          <Text dimColor>max pins</Text>
          {cfg.unlimitedPins ? null : <Button key="pins-down" label="−" onPress={go({ maxPins: Math.max(MIN_PINS, cfg.maxPins - 1) })} />}
          {cfg.unlimitedPins ? null : <Text>{String(cfg.maxPins).padStart(2)}</Text>}
          {cfg.unlimitedPins ? null : <Button key="pins-up" label="+" onPress={go({ maxPins: Math.min(MAX_PINS, cfg.maxPins + 1) })} />}
          <Button key="pins-limit" label={cfg.unlimitedPins ? 'no limit' : 'limited'} onPress={go({ unlimitedPins: !cfg.unlimitedPins })} />
          <Button key="screen" label={cfg.light ? 'light screen' : 'dark screen'} onPress={go({ light: !cfg.light })} />
          <Button key="check" label={cfg.check ? 'check on' : 'check off'} onPress={go({ check: !cfg.check })} />
          <Button key="skin" label={`skin: ${cfg.skin}`} onPress={go({ skin: nextSkin(cfg.skin) })} />
          <Button key="buttons" label={`buttons: ${cfg.buttons}`} onPress={go({ buttons: cfg.buttons === 'top' ? 'bottom' : 'top' })} />
        </Box>
        {TYPES.map(row)}
        <Box flexDirection="row" gap={1}>
          <Button key="reset-all" label="reset all to default" onPress={go({ reset: true })} />
          <Text dimColor>Esc closes · changes here apply to every session</Text>
        </Box>
      </Box>
    )
  })

  // The session's pins, newest last, each redrawn as the chat box.
  // No animation here: pulse, glow and the check exist only in the conversation.
  on('ui.render', { component: 'Pane', requestId: PINS_PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const cfg = await current($)
    const list = await readPins($)
    const marks = await readChecked($)
    const painting: Painting = { cfg, surface: e.surface, columns: columnsOf(e.viewport), Box, Text, Markdown }
    // Scrolling the transcript to a box works only in the terminal so far.
    const canJump = e.surface === 'terminal'
    const jump = (p: Pin) => canJump ? (
      <Button key={`jump-${p.id}`} label="↗" onPress={() => void jumpTo($, p)}>
        <Text dimColor>↗</Text>
      </Button>
    ) : null
    const unpin = (p: Pin) => (
      <Button key={`unpin-${p.id}`} label="×" onPress={() => attempt($, setPin($, p.id, false), 'the pins')}>
        <Text dimColor>×</Text>
      </Button>
    )
    const tick = (p: Pin) => {
      if (!cfg.check) return null
      const marked = marks.includes(p.id)
      return (
        <Button key={`check-${p.id}`} label={marked ? '✓' : '○'} onPress={() => attempt($, check($, [p.id], !marked), 'the check marks')}>
          <Text color={marked ? GREEN : undefined} bold={marked} dimColor={!marked}>{marked ? '✓' : '○'}</Text>
        </Button>
      )
    }
    // A pin from before text was kept: the title and excerpt row, with the same buttons.
    const row = (p: Pin) => (
      <Box key={`pin-${p.id}`} flexDirection="row" gap={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate">
            <Text color={style(cfg, p.type).color} bold>{p.title}</Text>
            {` ${p.excerpt}`}
          </Text>
        </Box>
        {jump(p)}
        {tick(p)}
        {unpin(p)}
      </Box>
    )
    const box = async (p: Pin & { text: string }) => {
      // A body pin keeps the subject of its heading; 'answer' is the old stand-in for no title.
      const v = { ...style(cfg, p.type), ...(p.type === 'body' && p.title !== 'answer' ? { title: p.title } : {}) }
      const marked = cfg.check && marks.includes(p.id)
      const c = marked ? { ...v, color: GREEN, background: mix(cfg.light ? SCREEN.light : SCREEN.dark, GREEN, 0.2) } : v
      const faint = p.type === 'about-you'
      const dimmed = marked || faint
      const inside = faint ? <Text dimColor>{p.text}</Text>
        : marked ? <Markdown text={strike(p.text)} dimColor />
        : await draw($, painting, p.text, p.type)
      return (
        <Box key={`pin-${p.id}`} flexDirection="column" borderStyle={c.border} borderColor={c.color} backgroundColor={c.background}
          paddingX={SPACE_X} paddingY={faint ? 0 : SPACE_Y}>
          <Box key={`top-${p.id}`} flexDirection="row" justifyContent="space-between">
            <Text color={c.color} bold={!dimmed} dimColor={dimmed}>{c.title ?? ''}</Text>
            <Box flexDirection="row" gap={1} flexShrink={0}>
              {jump(p)}
              {tick(p)}
              {unpin(p)}
            </Box>
          </Box>
          {inside}
        </Box>
      )
    }
    // Full boxes from the newest back, up to the budget; the oldest become rows. The order stays.
    const full = new Set<Pin>()
    let spent = 0
    for (const p of [...list].reverse()) {
      if (typeof p.text !== 'string') continue
      if (spent + p.text.length > PANE_BUDGET) break
      spent += p.text.length
      full.add(p)
    }
    const drawings = []
    for (const p of list) drawings.push(full.has(p) ? await box(p as Pin & { text: string }) : row(p))
    return (
      <Box flexDirection="column" rowGap={e.surface === 'terminal' ? 0 : 1}>
        {list.length === 0 ? <Text dimColor>{`No pins yet. Use ${PIN.unpinned} on a box to pin it.`}</Text> : drawings}
        <Text dimColor>{`${canJump ? '↗ jumps to the box in the chat · ' : ''}${cfg.check ? '○ checks and unpins · ' : ''}× unpins · Esc closes`}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const cfg = await current($)
    if (!cfg.enabled) return next(e)

    const elements = $.ui.resolve(e)
    const { Box, Text, Markdown, Button } = elements
    // vscode and mobile have no Client: there the title keeps the static drawing.
    const Client = (e.surface === 'terminal' || e.surface === 'desktop') && 'Client' in elements ? elements.Client : undefined
    const marks = await readChecked($)
    // The summary between two tools is not the answer: it never pulses.
    const pulse = e.props.isSummary ? undefined : pulseOf(e.props.text)
    const id = signature(e.props.text)
    const idOf = (i: number) => `${id}:${i}`
    const isChecked = (i: number) => cfg.check && marks.includes(idOf(i))
    const pieces = e.props.text.length > MAX_SPLIT ? null : split(e.props.text)
    const single = pieces === null || pieces.length <= 1 && (pieces[0]?.type ?? 'body') === 'body' && !pieces[0]?.title
    const boxCount = single ? 1 : pieces.length
    // Inside the turn the text still arrives in chunks: each length would be a separate answer for "up to here".
    if (!inTurn) seeDrawn(id, boxCount)
    remember(requests, id, e.requestId)
    const pinned = new Set((await readPins($)).map(p => p.id))
    const columns = columnsOf(e.viewport)

    const animated = cfg.skin !== 'none'
    const neon = cfg.skin === 'animated-ii'
    const screen = cfg.light ? SCREEN.light : SCREEN.dark
    // title: the subject of a body box opened by a heading; the other types keep their own.
    const box = (type: BoxType, inside: unknown, i: number, text: string, subject?: string) => {
      const v = { ...style(cfg, type, cfg.skin), ...(subject ? { title: subject } : {}) }
      const info: BoxInfo = { type, excerpt: excerptOf(text), text, requestId: e.requestId, ...(subject ? { title: subject } : {}) }
      remember(seenBoxes, idOf(i), info)
      const key = idOf(i)
      const isPinned = pinned.has(key)
      const marked = isChecked(i)
      const base = marked ? { ...v, color: GREEN, background: mix(screen, GREEN, 0.2) } : v
      const onClient = cfg.check && animated && Client && !boxTitleFailed(e.requestId, i)
      const closes = onClient && closing.has(key)
      const step = closes ? closing.get(key) ?? 0 : 0
      // Animated I blinks: even steps lit. Neon ramps the background and the border with the step.
      const litBorder = closes && !neon && step % 2 === 0
      const c = !closes ? base : neon ? {
        ...base,
        background: mix(base.background ?? screen, GREEN, NEON_CLOSING.background(step)),
      } : {
        ...base,
        background: mix(base.background ?? screen, base.color, litBorder ? CLOSING_BACKGROUND.lit : CLOSING_BACKGROUND.dim),
      }
      const borderColor = closes && neon ? mix(GREEN, WHITE, NEON_CLOSING.border(step)) : litBorder ? mix(base.color, WHITE, CLOSING_BORDER) : c.color
      // The static buttons light under the pointer, as the Client ones do, in the box colour.
      const lit = animated ? { hover: { color: c.color, dimColor: false } } : {}
      const pin = (
        <Button key={`pin-${i}`} label={isPinned ? PIN.pinned : PIN.unpinned} {...(isPinned ? {} : lit)} onPress={() => attempt($, setPin($, key, !isPinned, info), 'the pins')}>
          {isPinned ? <Text>{PIN.pinned}</Text> : <Text dimColor>{PIN.unpinned}</Text>}
        </Button>
      )
      const startPulse = PULSING_TYPES.includes(type) && !marked && pulse?.frame === 0
      // In the terminal the border is made of cells and the glow runs over it. In the app the border
      // is thin, between two cells: the glow runs on the inner line, hugging the border.
      const thin = e.surface !== 'terminal'
      const outside = thin ? 0 : -1
      const faint = type === 'about-you'
      // Without a spare line, the inner glow would run over the text.
      const canGlow = !!onClient && !(thin && faint) && !glowFailed(e.requestId, i)
      // Neon: once the draw-in is over (posted or given up) the pulse window no longer holds the rim, so a pin lap can run.
      const arriving = startPulse && !(neon && arrived.has(key))
      const lap: GlowLap | null = !canGlow ? null : closes ? 'close' : arriving ? 'arrive' : neon && pinning.has(key) ? 'pin' : null
      // Neon draw-in: the border stays dim while the glow paints it, until the glow's post.
      if (lap === 'arrive' && neon) startDrawIn($, key)
      const drawIn = lap === 'arrive' && neon && drawingIn.has(key)
      const dimmed = marked || faint
      const titleColor = neon && !marked ? mix(c.color, WHITE, NEON_TITLE) : c.color
      const title = <Text color={titleColor} bold={!dimmed} dimColor={dimmed}>{c.title ?? ''}</Text>
      const bottom = cfg.buttons === 'bottom'
      const titleProps = {
        title: c.title ?? '',
        color: titleColor,
        dimmed,
        checked: marked,
        checkColor: GREEN,
        // Still or reopened, the box keeps the dot's place: the title does not shift.
        dot: PULSING_TYPES.includes(type),
        pulse: startPulse,
        boxKey: key,
        pinned: isPinned,
        closing: !!closes,
        skin: cfg.skin as TitleProps['skin'],
        ...(neon ? { shimmerColors: SHIMMER_TAIL.map(k => mix(titleColor, WHITE, k)) } : {}),
      }
      const client = (clientKey: string, part: TitleProps['part']) => (
        <Client key={clientKey} module="./title.tsx" width="100%" height={1} props={{ ...titleProps, part } satisfies TitleProps} />
      )
      const buttons = (
        <Box flexDirection="row" gap={1} {...(bottom ? { justifyContent: 'flex-end' } : { flexShrink: 0 })}>
          {pin}
          {cfg.check ? (
            <Button key={`check-${i}`} label={marked ? '✓' : '○'} {...(marked ? {} : lit)} onPress={() => attempt($, check($, [key], !marked), 'the check marks')}>
              <Text color={marked ? GREEN : undefined} bold={marked} dimColor={!marked}>{marked ? '✓' : '○'}</Text>
            </Button>
          ) : null}
        </Box>
      )
      // The rim glow of one lap: the whole round trip, or the top line alone (pin).
      const rim = (side: GlowProps['side']) => {
        const color = lap === 'close' ? GREEN : v.color
        const durationMs = lap === 'close' ? CLOSE_MS : lap === 'arrive' ? ARRIVAL_GLOW_MS : PIN_GLOW_MS
        return (
          <Box key={`rim-${side}-${i}`} position="absolute" left={outside} right={outside} height={1} {...(side === 'top' ? { top: outside } : { bottom: outside })}>
            <Client key={`glow-${lap}-${side}-${i}`} module="./glow.tsx" width="100%" height={1} props={{
              side,
              thin,
              colors: TAIL.map(k => mix(color, WHITE, k)),
              border: c.border,
              durationMs,
              boxKey: key,
              ...(lap === 'close' && neon ? { laps: NEON_CLOSE_LAPS } : {}),
              ...(lap === 'arrive' && neon ? { paint: true, paintColor: v.color } : {}),
              ...(lap === 'pin' ? { line: true } : {}),
            } satisfies GlowProps} />
          </Box>
        )
      }
      const sides: GlowProps['side'][] = lap === 'pin' ? ['top'] : ['top', 'bottom']
      // Under the pointer the box thickens and brightens; a checked box stays green and still, and
      // while closing or drawing in the hover would hide the border effect.
      const hover = animated && !marked && !closes && !drawIn ? { hover: { borderStyle: thicker(c.border), borderColor: mix(c.color, WHITE, HOVER_BORDER) } } : {}
      return (
        <Box key={`box-${i}`} flexDirection="column" borderStyle={c.border} borderColor={borderColor} backgroundColor={c.background}
          {...(drawIn ? { borderDimColor: true } : {})} {...hover}
          paddingX={SPACE_X} paddingY={faint ? 0 : SPACE_Y}>
          {onClient ? client(`title-${i}`, bottom ? 'title' : 'both') : (
            <Box flexDirection="row" justifyContent="space-between">
              {title}
              {bottom ? null : buttons}
            </Box>
          )}
          {inside}
          {bottom ? (onClient ? client(`title-b-${i}`, 'buttons') : buttons) : null}
          {/* Last: it paints over the border and the content. */}
          {lap ? sides.map(rim) : null}
        </Box>
      )
    }

    const painting: Painting = { cfg, surface: e.surface, columns, Box, Text, Markdown }

    // The drawing below may be asked for only once per answer: it goes to the first segment with a
    // code block, which keeps the Run and copy buttons that way. The rest is drawn here, in the
    // Skins theme when Skins is on.
    let belowFree = true
    const segment = async (text: string) => {
      if (!belowFree || !hasFence(text)) return plain($, painting, text)
      belowFree = false
      return (await next({ ...e, props: { ...e.props, text } })) ?? plain($, painting, text)
    }
    const drawHere = (text: string, type: BoxType) => draw($, painting, text, type, segment)

    // No slot at all (or too large): a single body box.
    // A box checked as understood: the text comes out dimmed and struck, with all its formatting.
    if (single) {
      if (isChecked(0)) return box('body', <Markdown text={strike(e.props.text)} dimColor />, 0, e.props.text)
      if (pieces && hasTable(e.props.text)) return box('body', await drawHere(e.props.text, 'body'), 0, e.props.text)
      const inside = await next(e)
      if (inside === undefined || inside === null) return inside
      return box('body', inside, 0, e.props.text)
    }

    const boxes = []
    for (const [i, p] of pieces.entries()) {
      const inside = p.type === 'about-you' ? <Text dimColor>{p.text}</Text>
        : isChecked(i) ? <Markdown text={strike(p.text)} dimColor />
        : await drawHere(p.text, p.type)
      boxes.push(box(p.type, inside, i, p.text, p.title))
    }
    return <Box flexDirection="column" rowGap={e.surface === 'terminal' ? 0 : 1}>{boxes}</Box>
  })
    // If the drawing above fails (an error, a timeout), the answer still comes out in a single box,
    // with the raw markdown inside.
    .catch(async ($, e) => {
      try {
        const cfg = await current($)
        const { Box, Markdown } = $.ui.resolve(e)
        const c = style(cfg, 'body')
        return (
          <Box flexDirection="column" borderStyle={c.border} borderColor={c.color} backgroundColor={c.background} paddingX={SPACE_X} paddingY={SPACE_Y}>
            <Markdown text={e.props.text} />
          </Box>
        )
      } catch {
        return undefined
      }
    })
}
