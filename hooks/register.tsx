import type { EngineInterface, Register, RenderSurface, UiScrollArgs } from 'claude-code'
import { split, type BoxType } from './split'
import { BASE, GREEN, HELP, MAX_PINS, MIN_PINS, SCREEN, TYPES, apply, mix, nextAnimation, nextColor, parseCommand, readConfig, style, summary, typeFromName, type Change, type Config } from './config'
import { columnWeights, hasTable, splitTables } from './table'
import type { GlowProps } from './glow'
import { PIN, type TitleProps } from './title'
import { closesFence, fenceOpenAtEnd, hasFence, openFence, type Fence } from './fence'

// Spacing inside the boxes, in cells.
const SPACE_Y = 1
const SPACE_X = 1

// Skins gives up above this; Boxis does too: the whole answer goes into a single box.
const MAX_SPLIT = 9000

// "clock" animation: when the answer arrives, each beat lights and dims the whole box;
// after PULSES lit beats the chain stops.
export const PULSES = 3
export const BEAT_MS = 400
// How much white goes into the border and title of a lit box (0 none, 1 white).
export const LIGHTEN = 0.35
// How much of the type colour goes into the background of a lit box: that is what makes it "light up".
export const LIT_FILL = 0.4
const PULSING_TYPES: BoxType[] = ['warning', 'decision']
const WHITE = '#FFFFFF'
// Frames 0 to 2*PULSES-1: even lights, odd dims. Past the last one, the chain is finished.
const FRAMES = 2 * PULSES
const FINISHED = -1
// Only the latest answers that pulsed stay in the map, so it does not grow forever.
const MAX_PULSES = 50
// Fallback: up to this long after the turn ends, a block that missed the signature still adopts the pulse.
const WINDOW_MS = 1000
// "client" animation: until here the title may still start its pulse. Longer than the dot animation
// and than WINDOW_MS; after it, a redraw or a remount never repeats the pulse.
const PULSE_WINDOW_MS = 3000
// Closing a box: its own border blinks and the background pulses with it, redrawn by the hook. The
// only line that lands on the app's thin border; the pace is what a redraw keeps up with.
export const BLINKS = 6
export const BLINK_MS = 150
export const CLOSE_MS = 2 * BLINKS * BLINK_MS
const CLOSING_BACKGROUND = { lit: 0.22, dim: 0.1 }
const CLOSING_BORDER = 0.35
const ARRIVAL_GLOW_MS = 1400
// How much white each tail cell of the glow gets, from the head to the end.
const TAIL = [0.85, 0.65, 0.45, 0.3, 0.15]
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
async function readChecked($: EngineInterface, fromDisk = false): Promise<string[]> {
  if (!checked || fromDisk) {
    const stored = (await $.store.get(CHECKED_KEY)) ?? (await $.store.get(LEGACY_CHECKED_KEY))
    checked = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : []
  }
  return checked
}
// Adds (on) or removes the ids, reading from disk again: the CLI and the app write the same file.
// The requested state, not a toggle: a click on a stale copy would undo the other process's mark.
async function check($: EngineInterface, ids: string[], on: boolean) {
  const these = new Set(ids)
  const others = (await readChecked($, true)).filter(x => !these.has(x))
  const next = (on ? [...others, ...these] : others).slice(-MAX_CHECKED)
  if (!await save($, CHECKED_KEY, next, 'the check marks')) return
  checked = next
  $.ui.invalidate('ui.render')
}
// 32-bit FNV-1a plus the length: short to store and stable across sessions.
export function signature(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return `${(h >>> 0).toString(36)}.${text.length.toString(36)}`
}

// "Check all": every answer the screen drew in this session (the history on opening and the new
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
async function checkAll($: EngineInterface) {
  const all: string[] = []
  for (const [key, n] of drawn) for (let i = 0; i < n; i++) all.push(`${key}:${i}`)
  await check($, all, true)
}

// The last answer of the conversation, trimmed: only it gets the "check all" button. On opening the
// session it comes from the transcript; then from each turn end. The block drawn is its tail.
let lastAnswer = ''
function isLast(text: string): boolean {
  const trimmed = text.trim()
  return !inTurn && trimmed.length > 0 && lastAnswer.endsWith(trimmed)
}

// Pulse of the new answer ("clock" animation), by signature of the trimmed text: turn.complete
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
const lit = (frame: number | undefined) => frame !== undefined && frame >= 0 && frame < FRAMES && frame % 2 === 0

// One beat per clock callback: the hook that started the chain has already returned, nothing waits on it.
function beat($: EngineInterface, chain: Chain) {
  $.clock.after(BEAT_MS, () => {
    try {
      chain.frame += 1
      // The last frame is already dim, the same as the still drawing: no redraw needed at the end.
      if (chain.frame >= FRAMES) { chain.frame = FINISHED; return }
      $.ui.invalidate('ui.render')
      beat($, chain)
    } catch {
      chain.frame = FINISHED
    }
  })
}

// Fallback for when the signature misses (the block the screen draws differs from the turn.complete
// text, which joins the blocks of the last message): a block drawn only inside the turn that fits
// whole in the answer adopts the chain, until WINDOW_MS after the turn ends.
let inTurn = false
let latest: { text: string; chain: Chain } | null = null
// Blocks already drawn outside a turn (the history on opening the session): those never adopt.
const seenOutside = new Set<string>()
function seeOutside(key: string) {
  seenOutside.delete(key)
  seenOutside.add(key)
  for (const old of seenOutside) {
    if (seenOutside.size <= MAX_SEEN) break
    seenOutside.delete(old)
  }
}
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

// Boxes closing, by the same id as the check mark, border lit or not: one redraw every BLINK_MS.
const closing = new Map<string, boolean>()
// Exported so a test can pass a $ whose clock fails.
export function startClosing($: Pick<EngineInterface, 'clock' | 'ui'>, id: string) {
  if (closing.has(id)) return
  closing.set(id, true)
  $.ui.invalidate('ui.render')
  let tick: { cancel: () => void } | undefined
  try {
    tick = $.clock.every(BLINK_MS, () => {
      // The last tick may land together with the end: do not bring the box back.
      if (!closing.has(id)) return
      closing.set(id, !closing.get(id))
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
type BoxInfo = { type: BoxType; excerpt: string; text: string; requestId?: string }

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
  const read = readAllPins(await $.store.get(PINS_KEY))
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
  const limit = (await current($)).maxPins
  const saved = await savePins($, list => {
    const has = list.some(p => p.id === id)
    if (!on) return has ? list.filter(p => p.id !== id) : list
    const c = info ?? seenBoxes.get(id)
    if (has || !c) return list
    pinned = true
    // At the limit the oldest pins of this session go first, so the new one fits.
    const kept = [...list]
    dropped = kept.splice(0, Math.max(0, kept.length + 1 - limit))
    return [...kept, { id, type: c.type, title: BASE[c.type].title ?? 'answer', excerpt: c.excerpt, text: pinText(c.text), ...(c.requestId ? { requestId: c.requestId } : {}), created }]
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'boxis', description: 'Boxis: opens the colour panel, or on/off, intensity, animation and colour per type', argumentHint: '[status | pins | on | off | check on|off | animation none|clock|client | screen light|dark | intensity N | color <type> #hex | background <type> #hex | default]' })
    await $.tool.register({
      name: 'design',
      description: `Changes the look of the Boxis mod (the coloured boxes around the answers): on/off (enabled), the ✓ button that marks a box as understood (check), the animation of the boxes on arrival (animation: none, clock, client), background intensity (intensity, 0 to 100), light or dark screen (light), pins kept per session (maxPins, 1 to 10) and, per type, the border and title colour (color) and the background colour (background). Types: ${TYPES_LIST}. A colour is #RRGGBB; "default" restores the original; background "none" removes the background. Returns the full config after the change. Call with no fields to only read it.`,
      inputSchema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'Boxes on (true) or off (false).' },
          check: { type: 'boolean', description: 'Shows the ✓ button that marks a box as understood.' },
          animation: { type: 'string', enum: ['none', 'clock', 'client'], description: 'Animation of the warning and decision boxes when the answer arrives.' },
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
          reset: { type: 'boolean', description: 'Restores every colour and the intensity to the original.' },
        },
        additionalProperties: false,
      },
    })
    await current($)
    try {
      const messages = await $.session.messages()
      if (Array.isArray(messages)) {
        const u = [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim())
        lastAnswer = u?.text.trim() ?? ''
      }
    } catch {}
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

  // A new answer: with the "clock" animation, its warning and decision boxes pulse and stop.
  // With "client" the title pulses: here it only opens the window, with one redraw and no beats.
  // The mod only observes: it always returns next(e), and each beat is a clock callback.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    inTurn = false
    try {
      const text = e.reason === 'answer' && typeof e.answer === 'string' ? e.answer.trim() : ''
      if (text) {
        lastAnswer = text
        $.ui.invalidate('ui.render')
      }
      const animation = (await current($)).animation
      if (text && (animation === 'clock' || animation === 'client')) {
        const chain: Chain = { frame: 0 }
        keepPulse(signature(text), chain)
        latest = { text, chain }
        $.clock.after(WINDOW_MS, () => { if (latest?.chain === chain) latest = null })
        $.ui.invalidate('ui.render')
        if (animation === 'clock') beat($, chain)
        else $.clock.after(PULSE_WINDOW_MS, () => { chain.frame = FINISHED })
      }
    } catch {}
    return next(e)
  })

  // The title's check ("client" animation) posts "closing" on the click and "checked" after the frames.
  on('ui.message', async ($, e, next) => {
    const data = e.data as { checked?: unknown; closing?: unknown; all?: unknown; pin?: unknown; on?: unknown } | null
    if (!e.element.startsWith('title-') || !data || typeof data !== 'object') return next(e)
    if (data.all === true) { await checkAll($); return {} }
    if (typeof data.closing === 'string') { startClosing($, data.closing); return {} }
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
          <Button key="pins-down" label="−" onPress={go({ maxPins: Math.max(MIN_PINS, cfg.maxPins - 1) })} />
          <Text>{String(cfg.maxPins).padStart(2)}</Text>
          <Button key="pins-up" label="+" onPress={go({ maxPins: Math.min(MAX_PINS, cfg.maxPins + 1) })} />
          <Button key="screen" label={cfg.light ? 'light screen' : 'dark screen'} onPress={go({ light: !cfg.light })} />
          <Button key="check" label={cfg.check ? 'check on' : 'check off'} onPress={go({ check: !cfg.check })} />
          <Button key="animation" label={`animation: ${cfg.animation}`} onPress={go({ animation: nextAnimation(cfg.animation) })} />
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
    // A pin from before text was kept: the title and excerpt row, with the same pair of buttons.
    const row = (p: Pin) => (
      <Box key={`pin-${p.id}`} flexDirection="row" gap={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate">
            <Text color={style(cfg, p.type).color} bold>{p.title}</Text>
            {` ${p.excerpt}`}
          </Text>
        </Box>
        {jump(p)}
        {unpin(p)}
      </Box>
    )
    const box = async (p: Pin & { text: string }) => {
      const v = style(cfg, p.type)
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
        <Text dimColor>{canJump ? '↗ jumps to the box in the chat · × unpins · Esc closes' : '× unpins · Esc closes'}</Text>
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
    const frame = cfg.animation === 'clock' ? pulse?.frame : undefined
    const id = signature(e.props.text)
    const idOf = (i: number) => `${id}:${i}`
    const isChecked = (i: number) => cfg.check && marks.includes(idOf(i))
    const pieces = e.props.text.length > MAX_SPLIT ? null : split(e.props.text)
    const boxCount = pieces === null || pieces.length <= 1 && (pieces[0]?.type ?? 'body') === 'body' ? 1 : pieces.length
    // Inside the turn the text still arrives in chunks: each length would be a separate answer for "all".
    if (!inTurn) seeDrawn(id, boxCount)
    remember(requests, id, e.requestId)
    const pinned = new Set((await readPins($)).map(p => p.id))
    // The "check all" button sits on the last box of the last answer, next to its check.
    const last = cfg.check && !e.props.isSummary && isLast(e.props.text)
    const allOn = (i: number) => last && i === boxCount - 1
    const columns = columnsOf(e.viewport)

    const box = (type: BoxType, inside: unknown, i: number, text: string) => {
      const v = style(cfg, type)
      const info: BoxInfo = { type, excerpt: excerptOf(text), text, requestId: e.requestId }
      remember(seenBoxes, idOf(i), info)
      const isPinned = pinned.has(idOf(i))
      const pin = (
        <Button key={`pin-${i}`} label={isPinned ? PIN.pinned : PIN.unpinned} onPress={() => attempt($, setPin($, idOf(i), !isPinned, info), 'the pins')}>
          {isPinned ? <Text>{PIN.pinned}</Text> : <Text dimColor>{PIN.unpinned}</Text>}
        </Button>
      )
      const marked = isChecked(i)
      const pulses = !marked && lit(frame) && PULSING_TYPES.includes(type)
      const base = marked ? { ...v, color: GREEN, background: mix(cfg.light ? SCREEN.light : SCREEN.dark, GREEN, 0.2) }
        : pulses ? {
          ...v,
          color: mix(v.color, WHITE, LIGHTEN),
          background: mix(v.background ?? (cfg.light ? SCREEN.light : SCREEN.dark), v.color, LIT_FILL),
          // The border gets thicker without changing size; one already thick becomes double.
          border: v.border === 'bold' ? 'double' : 'bold',
        } : v
      const onClient = cfg.check && cfg.animation === 'client' && Client && !titleFailed(e.requestId, `title-${i}`)
      const closes = onClient && closing.has(idOf(i))
      const litBorder = closes && closing.get(idOf(i)) === true
      const c = closes ? {
        ...base,
        background: mix(base.background ?? (cfg.light ? SCREEN.light : SCREEN.dark), base.color, litBorder ? CLOSING_BACKGROUND.lit : CLOSING_BACKGROUND.dim),
      } : base
      const borderColor = litBorder ? mix(base.color, WHITE, CLOSING_BORDER) : c.color
      const startPulse = PULSING_TYPES.includes(type) && !marked && pulse?.frame === 0
      const lap = closes ? 'close' : startPulse ? 'arrive' : null
      // In the terminal the border is made of cells and the glow runs over it. In the app the border
      // is thin, between two cells: the glow runs on the inner line, hugging the border.
      const thin = e.surface !== 'terminal'
      const outside = thin ? 0 : -1
      const faint = type === 'about-you'
      // Without a spare line, the inner glow would run over the text.
      const glows = lap && !(thin && faint)
      const dimmed = marked || faint
      const title = <Text color={c.color} bold={!dimmed} dimColor={dimmed}>{c.title ?? ''}</Text>
      return (
        <Box key={`box-${i}`} flexDirection="column" borderStyle={c.border} borderColor={borderColor} backgroundColor={c.background}
          paddingX={SPACE_X} paddingY={faint ? 0 : SPACE_Y}>
          {onClient ? (
            <Client key={`title-${i}`} module="./title.tsx" width="100%" height={1} props={{
              title: c.title ?? '',
              color: c.color,
              dimmed,
              checked: marked,
              checkColor: GREEN,
              // Still or reopened, the box keeps the dot's place: the title does not shift.
              dot: PULSING_TYPES.includes(type),
              pulse: startPulse,
              boxKey: idOf(i),
              all: allOn(i),
              pinned: isPinned,
            } satisfies TitleProps} />
          ) : (
            <Box key={`top-${i}`} flexDirection="row" justifyContent="space-between">
              {title}
              <Box flexDirection="row" gap={1} flexShrink={0}>
                {pin}
                {allOn(i) ? (
                  <Button key={`all-${i}`} label="all" onPress={() => attempt($, checkAll($), 'the check marks')}>
                    <Text dimColor>all</Text>
                  </Button>
                ) : null}
                {cfg.check ? (
                  <Button key={`check-${i}`} label={marked ? '✓' : '○'} onPress={() => attempt($, check($, [idOf(i)], !marked), 'the check marks')}>
                    <Text color={marked ? GREEN : undefined} bold={marked} dimColor={!marked}>{marked ? '✓' : '○'}</Text>
                  </Button>
                ) : null}
              </Box>
            </Box>
          )}
          {inside}
          {/* Last: it paints over the border and the content. */}
          {onClient && glows ? (['top', 'bottom'] as const).map(side => (
            <Box key={`rim-${side}-${i}`} position="absolute" left={outside} right={outside} height={1} {...(side === 'top' ? { top: outside } : { bottom: outside })}>
              <Client key={`glow-${lap}-${side}-${i}`} module="./glow.tsx" width="100%" height={1} props={{
                side,
                thin,
                colors: TAIL.map(k => mix(lap === 'close' ? GREEN : v.color, WHITE, k)),
                border: c.border,
                durationMs: lap === 'close' ? CLOSE_MS : ARRIVAL_GLOW_MS,
              } satisfies GlowProps} />
            </Box>
          )) : null}
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
    if (pieces === null || pieces.length <= 1 && (pieces[0]?.type ?? 'body') === 'body') {
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
      boxes.push(box(p.type, inside, i, p.text))
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
