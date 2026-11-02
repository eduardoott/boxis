import { test, expect, mock } from 'claude-code/testing'
import { separarTabelas } from '../hooks/tabela'

// Bug de 10/10/2026: resposta com tabela saía sem caixa nenhuma no desktop.
const TEXTO = [
  'Fiz a troca.',
  '',
  '📊 Estado:',
  '',
  '| Item | Situação |',
  '|---|---|',
  '| a | ✅ passou |',
  '| b | ❌ falhou |',
  '',
  '⚠️ Pode quebrar X.',
  '',
  '❓ Faço A?',
  '',
  '✅ Feito: x. ➡️ Planejado: y.',
  '',
  '📌 hooks/register.tsx',
].join('\n')

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><rect width="200" height="60"/></svg>'

test('resposta com tabela sai partida em caixas, com a tabela do Boxis quebrando linha', async ($, on) => {
  mock.store(on, {})
  // O Skins: põe $.skins e responde o evento skins.markdown; no desktop a tabela vira cartão Svg.
  on('engine.create', (async ($: any, e: any, next: any) => ({ ...(await next(e)), skins: { markdown: async () => undefined } })) as never)
  on('skins.markdown' as never, (async ($: any, a: { surface: 'terminal' | 'desktop'; text: string }) => {
    if (!/\|/.test(a.text)) return { value: undefined }
    const { Box, Svg, Text } = $.ui.resolve({ surface: a.surface, component: 'AssistantMessage' })
    return { value: (
      <Box flexDirection="column">
        <Text>Estado:</Text>
        <Box marginY={1} alignSelf="flex-start">
          {a.surface === 'desktop' ? <Svg source={SVG} alt="table" width={200} height={60} /> : <Text>tabela</Text>}
        </Box>
      </Box>
    ) }
  }) as never)
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'boxis', surface, component: 'AssistantMessage', props: { text: TEXTO, isFirstOfReply: true } })
    // 5 caixas mais a moldura da tabela, que agora é do Caixinhas e quebra linha.
    const caixas = (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderColor)
    expect(caixas.length).toBe(6)
    expect((await ui.find({ type: 'Text', text: /^Situação$/ }))?.props.wrap).toBe('wrap')
    expect(await ui.find({ type: 'Markdown', text: /❌ falhou/ })).toBeDefined()
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  }
})

test('separarTabelas acha a tabela e ignora a que está em bloco de código', () => {

  const t = separarTabelas('Antes\n\n| A | B |\n|---|:-:|\n| 1 | uma célula bem longa |\n\nDepois\n\n```\n| x | y |\n|---|---|\n```')
  expect(t.map(x => x.tipo)).toEqual(['texto', 'tabela', 'texto'])
  expect(t[1]).toEqual({ tipo: 'tabela', cabecalho: ['A', 'B'], linhas: [['1', 'uma célula bem longa']] })
})

// Bug de 11/10/2026: tabela e bloco de código na mesma resposta faziam a tabela cair no Skins, cortada com "…".
test('tabela com bloco de código na mesma resposta: tabela do Boxis, bloco inteiro no desenho de baixo', async ($, on) => {
  mock.store(on, {})
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`baixo:${e.props.text}`}</Text>
  })
  const tabela = '| Caso | Situação |\n|---|---|\n| a | ✅ uma célula bem longa |'
  const bloco = '```bash\necho oi\n❓ não corta\n| x | y |\n|---|---|\n```'
  const respostas = [
    `Fiz.\n\n${tabela}\n\n${bloco}`,
    `Fiz.\n\n${tabela}\n\n${bloco}\n\n❓ Faço A?\n\n✅ Feito: x. ➡️ Planejado: y.`,
  ]
  for (const text of respostas) {
    const ui = await $.ui.mount({ plugin: 'boxis', surface: 'desktop', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
    expect((await ui.find({ type: 'Text', text: /^Situação$/ }))?.props.wrap).toBe('wrap')
    expect(await ui.find({ type: 'Markdown', text: /uma célula bem longa/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Text', text: /^baixo:/ })).length).toBe(1)
    expect(await ui.find({ type: 'Text', text: `baixo:${bloco}` })).toBeDefined()
    await ui.unmount()
  }
})
