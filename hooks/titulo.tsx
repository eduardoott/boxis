// Animação "client" (exploração): a linha do título como módulo de superfície, que o próprio app
// anima sem redesenhar o resto da tela. Ponto que pulsa ao chegar e check que vira ✓ em quadros.
import type { ClientModule } from 'claude-code'

export type TituloProps = {
  titulo: string
  cor: string
  // Título sem negrito e apagado, como no desenho de hoje.
  apagada: boolean
  marcada: boolean
  corCheck: string
  ponto: boolean
  pulsar: boolean
  chave: string
  // Só na última caixa da última resposta: o botão que marca todas as caixas da conversa.
  todas?: boolean
  // A caixa está na lista de pins desta sessão: o botão à esquerda do check mostra 📌.
  fixada?: boolean
}

// Sliders. 5 pulsos de 3 tons a 100 ms: mais piscadas e mais rápidas, a pedido dele (01/11).
export const PULSOS = 5
export const QUADROS_PONTO = ['◦', '◉', '●']
export const BATIDA_PONTO_MS = 100
// A bolinha em 8 fases. Só existem 4 glifos de preenchimento: cada um passa antes apagado e depois aceso.
export const QUADRO_MS = 80
export const QUADROS_CHECK = ['○', '◔', '◔', '◑', '◑', '◕', '◕', '✓']
const QUADROS_APAGADOS = [0, 1, 3, 5]
const PONTO_PARADO = '●'
export const PIN = { fixada: '📌', solta: '⚲' }

type Local = {
  passo: number
  quadro: number
  // O que não redesenha: os relógios, e o que evita recomeçar o pulso ou repetir o clique.
  ref: { pulso?: () => void; pulsou?: boolean; check?: () => void; espera?: boolean; chave: string }
}

const Titulo: ClientModule<TituloProps, Local> = (props, surface) => {
  const { Box, Text, Button } = surface.elements
  let state = surface.state
  if (state === undefined) {
    state = { passo: 0, quadro: 0, ref: { chave: props.chave } }
    surface.setState(state)
  }
  const inicial = state
  const atual = () => surface.state ?? inicial
  const ref = state.ref
  ref.chave = props.chave
  // A marca chegou: daqui em diante quem manda é a prop, e desmarcar por fora volta ao ○.
  if (props.marcada) ref.espera = false

  // O Client monta com a resposta ainda chegando: pulsar pode virar true depois de montar.
  if (props.ponto && props.pulsar && !ref.pulsou) {
    ref.pulsou = true
    ref.pulso = surface.every(BATIDA_PONTO_MS, () => {
      const cur = atual()
      const passo = cur.passo + 1
      if (passo >= PULSOS * QUADROS_PONTO.length) {
        ref.pulso?.()
        ref.pulso = undefined
      }
      surface.setState({ ...cur, passo })
    })
  }

  // Button, e não onPointer no Text: é o que mantém a seta do mouse em cima do check.
  const clicar = () => {
    if (ref.check || ref.espera) return
    if (props.marcada) {
      surface.post({ lida: ref.chave })
      return
    }
    surface.post({ fechar: ref.chave })
    ref.check = surface.every(QUADRO_MS, () => {
      const cur = atual()
      const quadro = cur.quadro + 1
      if (quadro >= QUADROS_CHECK.length - 1) {
        ref.check?.()
        ref.check = undefined
        // Fica no ✓ até a prop chegar, para não piscar de volta no ○.
        ref.espera = true
        surface.post({ lida: ref.chave })
      }
      surface.setState({ ...cur, quadro })
    })
    surface.setState({ ...atual(), quadro: 0 })
  }

  const ponto = ref.pulso && !props.marcada ? QUADROS_PONTO[state.passo % QUADROS_PONTO.length] : PONTO_PARADO
  const glifo = ref.check ? QUADROS_CHECK[state.quadro] : props.marcada || ref.espera ? '✓' : '○'
  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%" height={1}>
      <Box flexShrink={1} overflow="hidden">
        <Text>
          {props.ponto ? <Text color={props.cor}>{`${ponto} `}</Text> : null}
          <Text color={props.cor} bold={!props.apagada} dimColor={props.apagada}>{props.titulo}</Text>
        </Text>
      </Box>
      <Box flexDirection="row" gap={1} flexShrink={0}>
        <Button key={`pin-${props.chave}`} label={props.fixada ? PIN.fixada : PIN.solta} onPress={() => surface.post({ pin: ref.chave })}>
          {props.fixada ? <Text>{PIN.fixada}</Text> : <Text dimColor>{PIN.solta}</Text>}
        </Button>
        {props.todas ? (
          <Button key={`todas-${props.chave}`} label="all" onPress={() => surface.post({ todas: true })}>
            <Text dimColor>all</Text>
          </Button>
        ) : null}
        <Button key={`check-${props.chave}`} label={glifo} onPress={clicar}>
          {ref.check ? <Text color={props.corCheck} dimColor={QUADROS_APAGADOS.includes(state.quadro)}>{glifo}</Text>
            : props.marcada || ref.espera ? <Text color={props.corCheck} bold>{glifo}</Text>
            : <Text dimColor>{glifo}</Text>}
        </Button>
      </Box>
    </Box>
  )
}

export default Titulo
