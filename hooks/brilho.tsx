// Animação "client" (exploração): brilho e piscada nas linhas de cima e de baixo da borda.
// Um Client por linha: o app não dá a altura da caixa a um Client que a cubra inteira (mediu 92x1),
// então as laterais ficam de fora. Só desenha células soltas: espaço em branco apagaria a borda.
import type { ClientModule } from 'claude-code'

export type BrilhoProps = {
  lado: 'cima' | 'baixo'
  // Borda fina do app: a linha corre na célula de dentro, com o glifo colado na beira da borda.
  // Nenhuma célula cai em cima da linha fina (4 px para dentro ou 4 px para fora, medido 01/11),
  // e a célula de fora, em cima, nem aparece. Quem pisca em cima da borda é a própria borda, no hook.
  fino: boolean
  // Da cabeça para o fim da cauda.
  cores: string[]
  borda: string
  duracaoMs: number
}

export const TICK_MS = 35

const GLIFOS: Record<string, { cantos: string; h: string }> = {
  round: { cantos: '╭╮╰╯', h: '─' },
  bold: { cantos: '┏┓┗┛', h: '━' },
  double: { cantos: '╔╗╚╝', h: '═' },
  single: { cantos: '┌┐└┘', h: '─' },
}

// A coluna x de uma linha da borda com l colunas.
export function glifo(borda: string, lado: BrilhoProps['lado'], x: number, l: number): string {
  const g = GLIFOS[borda] ?? GLIFOS.round
  if (x > 0 && x < l - 1) return g.h
  return [...g.cantos][(lado === 'cima' ? 0 : 2) + (x === 0 ? 0 : 1)]
}

// A volta: em cima da esquerda para a direita, embaixo da direita para a esquerda. Coluna da posição p,
// ou null quando p está na outra linha.
export function colunaDa(p: number, lado: BrilhoProps['lado'], l: number): number | null {
  if (lado === 'cima') return p >= 0 && p < l ? p : null
  return p >= l && p < 2 * l ? 2 * l - 1 - p : null
}

type Local = { passo: number; ref: { parar?: () => void } }

const Brilho: ClientModule<BrilhoProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const passos = Math.max(1, Math.ceil(props.duracaoMs / TICK_MS))
  let state = surface.state
  if (state === undefined) {
    const ref: Local['ref'] = {}
    state = { passo: 0, ref }
    surface.setState(state)
    const inicial = state
    ref.parar = surface.every(TICK_MS, () => {
      const cur = surface.state ?? inicial
      const passo = cur.passo + 1
      if (passo >= passos) {
        ref.parar?.()
        ref.parar = undefined
      }
      surface.setState({ ...cur, passo })
    })
  }

  const l = surface.columns
  if (l < 2 || state.passo >= passos) return <Box />
  const desenho = (x: number) => props.fino ? (props.lado === 'cima' ? '▔' : '▁') : glifo(props.borda, props.lado, x, l)
  const celulas = []
  // A cabeça anda até a cauda inteira ter passado do fim da volta.
  const cabeca = Math.floor((state.passo / passos) * (2 * l + props.cores.length))
  for (const [k, cor] of props.cores.entries()) {
    const x = colunaDa(cabeca - k, props.lado, l)
    if (x === null) continue
    celulas.push(<Box key={`c-${k}`} position="absolute" top={0} left={x}><Text color={cor} bold>{desenho(x)}</Text></Box>)
  }
  return <Box width={l} height={1}>{celulas}</Box>
}

export default Brilho
