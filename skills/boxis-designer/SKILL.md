---
name: boxis-designer
description: Changes the look of the Boxis mod (colour-coded boxes around Claude's answers, split by type). Use when the person asks to change a box's colour or background, make it stronger or softer, more discreet, match a theme, turn the boxes on or off, or go back to the original.
---

# Adjusting Boxis

The mod has one tool, `mcp__boxis__design`, and each change shows on screen as soon as it returns.
By hand: `/boxis` opens the colour panel (◀ ▶ buttons per type, intensity, light/dark screen); `/boxis status` shows it as text. The colours belong to Boxis itself and do not depend on the Skins skin.

## Box types

| type | what it is (title on screen) | default |
|---|---|---|
| corpo | normal answer text | purple #7F77DD |
| decisao | `❓` line, "your call" | blue #4A90E2, thick border |
| aviso | `⚠️` line, "warning" | yellow #E0B040 |
| escopo | `🚧` line, "left out" | grey #9AA0A6 |
| documento | `📄` line, "documents" | light grey #B0B0B0 |
| objeto | `📌` line, "to apply" | light grey #B0B0B0 |
| teste | `🧪 Testar:` and its steps, "test for you" | lilac #B39DDB |
| fechamento | `✅ Feito: ... ➡️ Planejado: ...`, "wrap-up" | green #5CB85C |
| sobre-voce | `❓ Sobre você:`, the question from the list, "about you" | grey #6B6B6B, no background, the most discreet |

## Tool fields

- `ligado`: turns all boxes on or off.
- `intensidade` (0 to 100, default 50): how much of the border colour goes into the background. 0 removes all automatic backgrounds.
- `claro`: true when the screen is light; backgrounds lighten instead of darken.
- `tipos.<tipo>.cor`: border and title colour, `#RRGGBB`, or `default`.
- `tipos.<tipo>.fundo`: fixed background `#RRGGBB`, `none`, or `default` (back to automatic by intensity).
- `restaurar: true`: resets all colours and the intensity to the original.

The old value words `padrao` and `nenhum` still work.

## Steps

1. Call the tool with no fields to read the current config.
2. Turn the request into a single call, changing as little as possible. "Stronger" means raising intensity by 15 to 20; "more discreet" means lowering it.
3. A fixed background must match the screen (`claro`): dark on a dark screen, light on a light one, so the text stays readable.
4. Reply in one line with what changed, and say it can be undone with `/boxis default`.
