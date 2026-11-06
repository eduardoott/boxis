---
name: boxis-designer
description: Changes the look of the Boxis mod (colour-coded boxes around Claude's answers, split by type). Use when the person asks to change a box's colour or background, make it stronger or softer, more discreet, match a theme, turn the boxes on or off, change how many pins are kept, or go back to the original.
---

# Adjusting Boxis

The mod has one tool, `mcp__boxis__design`, and each change shows on screen as soon as it returns.
By hand: `/boxis` opens the colour panel (◀ ▶ buttons per type, intensity, max pins, light/dark screen, skin, buttons); `/boxis status` shows it as text. The colours belong to Boxis itself and do not depend on the Skins skin.

## Box types

| type | what it is (title on screen) | default |
|---|---|---|
| body | normal answer text | purple #7F77DD |
| decision | `❓` line, "your call" | blue #4A90E2, thick border |
| warning | `⚠️` line, "warning" | yellow #E0B040 |
| scope | `🚧` line, "left out" | grey #9AA0A6 |
| document | `📄` line, "documents" | light grey #B0B0B0 |
| object | `📌` line, "to apply" | light grey #B0B0B0 |
| test | `🧪 Test:` and its steps, "test for you" | lilac #B39DDB |
| wrap-up | `✅ Done: ... ➡️ Next: ...`, "wrap-up" | green #5CB85C |
| about-you | `❓ About you:`, a question about the reader, "about you" | grey #6B6B6B, no background, the most discreet |

## Tool fields

- `enabled`: turns all boxes on or off.
- `intensity` (0 to 100, default 50): how much of the border colour goes into the background. 0 removes all automatic backgrounds.
- `light`: true when the screen is light; backgrounds lighten instead of darken.
- `check`: shows the ✓ button that marks a box as understood.
- `skin`: `none` (plain boxes), `animated-i` (the title line animated: a dot pulses and a glow runs along the border on arrival, the box and its buttons light under the pointer, the pin spins, the ✓ fills up while the title wipes out, and the box blinks while closing) or `animated-ii` (Neon: all of that with bold borders and brighter titles, a border drawn in on arrival with a spark at each corner, a shimmer on the top border under the pointer, a closing ramp to green with two glow laps, and a spark burst with a lap of light when pinning).
- `buttons`: `top` (default) or `bottom`, where the pin and check buttons sit on the box: the top right or the bottom right.
- `maxPins` (1 to 10, default 5): pins kept per session; past it, pinning a box unpins the oldest.
- `types.<type>.color`: border and title colour, `#RRGGBB`, or `default`.
- `types.<type>.background`: fixed background `#RRGGBB`, `none`, or `default` (back to automatic by intensity).
- `reset: true`: resets all colours and the intensity to the original.

## Steps

1. Call the tool with no fields to read the current config.
2. Turn the request into a single call, changing as little as possible. "Stronger" means raising intensity by 15 to 20; "more discreet" means lowering it.
3. A fixed background must match the screen (`light`): dark on a dark screen, light on a light one, so the text stays readable.
4. Reply in one line with what changed, and say it can be undone with `/boxis default`.
