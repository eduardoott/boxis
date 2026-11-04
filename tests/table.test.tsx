import { test, expect, mock } from 'claude-code/testing'
import { splitTables } from '../hooks/table'

// Regression: an answer with a table came out with no box at all on desktop.
const TEXT = [
  'Made the change.',
  '',
  '📊 Status:',
  '',
  '| Item | Result |',
  '|---|---|',
  '| a | ✅ passed |',
  '| b | ❌ failed |',
  '',
  '⚠️ X may break.',
  '',
  '❓ Do A?',
  '',
  '✅ Done: x. ➡️ Next: y.',
  '',
  '📌 hooks/register.tsx',
].join('\n')

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><rect width="200" height="60"/></svg>'

test('an answer with a table splits into boxes, with the Boxis table wrapping its cells', async ($, on) => {
  mock.store(on, {})
  // Skins: adds $.skins and answers the skins.markdown event; on desktop the table becomes an Svg card.
  on('engine.create', (async ($: any, e: any, next: any) => ({ ...(await next(e)), skins: { markdown: async () => undefined } })) as never)
  on('skins.markdown' as never, (async ($: any, a: { surface: 'terminal' | 'desktop'; text: string }) => {
    if (!/\|/.test(a.text)) return { value: undefined }
    const { Box, Svg, Text } = $.ui.resolve({ surface: a.surface, component: 'AssistantMessage' })
    return { value: (
      <Box flexDirection="column">
        <Text>Status:</Text>
        <Box marginY={1} alignSelf="flex-start">
          {a.surface === 'desktop' ? <Svg source={SVG} alt="table" width={200} height={60} /> : <Text>table</Text>}
        </Box>
      </Box>
    ) }
  }) as never)
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'boxis', surface, component: 'AssistantMessage', props: { text: TEXT, isFirstOfReply: true } })
    // 5 boxes plus the table frame, which Boxis draws and wraps.
    const boxes = (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderColor)
    expect(boxes.length).toBe(6)
    expect((await ui.find({ type: 'Text', text: /^Result$/ }))?.props.wrap).toBe('wrap')
    expect(await ui.find({ type: 'Markdown', text: /❌ failed/ })).toBeDefined()
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  }
})

test('splitTables finds the table and ignores the one inside a code block', () => {
  const t = splitTables('Before\n\n| A | B |\n|---|:-:|\n| 1 | a rather long cell |\n\nAfter\n\n```\n| x | y |\n|---|---|\n```')
  expect(t.map(x => x.kind)).toEqual(['text', 'table', 'text'])
  expect(t[1]).toEqual({ kind: 'table', header: ['A', 'B'], rows: [['1', 'a rather long cell']] })
})

// Regression: a table and a code block in the same answer sent the table to Skins, cut with "…".
test('a table and a code block in one answer: the Boxis table, and the whole block in the drawing below', async ($, on) => {
  mock.store(on, {})
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`below:${e.props.text}`}</Text>
  })
  const table = '| Case | Result |\n|---|---|\n| a | ✅ a rather long cell |'
  const block = '```bash\necho hi\n❓ does not split\n| x | y |\n|---|---|\n```'
  const answers = [
    `Done.\n\n${table}\n\n${block}`,
    `Done.\n\n${table}\n\n${block}\n\n❓ Do A?\n\n✅ Done: x. ➡️ Next: y.`,
  ]
  for (const text of answers) {
    const ui = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
    expect((await ui.find({ type: 'Text', text: /^Result$/ }))?.props.wrap).toBe('wrap')
    expect(await ui.find({ type: 'Markdown', text: /a rather long cell/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Text', text: /^below:/ })).length).toBe(1)
    expect(await ui.find({ type: 'Text', text: `below:${block}` })).toBeDefined()
    await ui.unmount()
  }
})

test('without Skins an answer with a table still comes out in boxes', async ($, on) => {
  mock.store(on, {})
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })
  const ui = await $.ui.mount({ plugin: 'boxis', surface: 'terminal', component: 'AssistantMessage', props: { text: TEXT, isFirstOfReply: true } })
  const boxes = (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderColor)
  expect(boxes.length).toBe(6)
  expect(await ui.find({ type: 'Markdown', text: /Made the change/ })).toBeDefined()
  await ui.unmount()
})
