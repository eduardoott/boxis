# Boxis

A Claude Code mod: Claude's answers drawn in colour-coded boxes, one box per part of the answer. A risk, a decision for you, what was left out, the steps to test and the wrap-up each get their own box, so a long answer can be scanned at a glance.

## Install

```
claude plugin marketplace add eduardoott/boxis
claude plugin install boxis@boxis
```

Then run `/reload-plugins` in any Claude window that is already open.

Boxis is opt-in: it changes how every answer looks, so each person installs it for themselves. `/boxis off` turns it off without uninstalling.

After updating, restart any Claude window that is already open: an older version still running could rewrite pins saved in the new shape.

## Slot contract

Boxis splits an answer by the start of its lines. A line that starts with one of these prefixes opens a box of that type; the lines after it stay in that box until another prefix or plain text. Each label works in English and in Portuguese, and both give identical boxes.

| Line starts with | Box type | Title on screen |
|---|---|---|
| `❓ About you:` or `❓ Sobre você:` | about-you | about you (grey, no background) |
| `❓` | decision | your call |
| `⚠️` | warning | warning |
| `🚧` | scope | left out |
| `📄` | document | documents |
| `📌` | object | to apply |
| `🧪 Test:` or `🧪 Testar:`, then numbered or indented steps | test | test for you |
| `✅ Done:` or `✅ Feito:`, as in `✅ Done: ... ➡️ Next: ...` | wrap-up | wrap-up |
| `## subject` or `### subject` | body | the subject |

A labelled prefix needs the emoji, the label and the colon: `🧪 Test` without the colon or a bare `✅ passed` is body text. A table right under a warning or a decision (its alternatives) stays in that box. Everything else is body text, in a purple box with no title. A heading starts a new body box titled with its subject, so an answer that covers several subjects gives one box per subject. A heading with nothing under it still shows as a title-only box; text that comes after a slot inside a subject goes to an untitled body box. A label in bold works too, with the colon inside or outside the bold (`✅ **Done:**`, `🧪 **Test**:`). An answer with none of these prefixes is one plain box. Code blocks never split, and an answer over 9000 characters stays in one box.

## Commands and the colour pane

`/boxis` opens the colour pane: per type, ◀ ▶ step the border colour and a button turns the background on or off; the top row sets on/off, background intensity, max pins, light or dark screen, the ✓ check, the skin and the position of the buttons. Changes apply to every session; other open windows pick them up on their next session start or pin.

```
/boxis status                    the config as text
/boxis on | off                  boxes on or off
/boxis intensity 0-100           how much colour goes into the background
/boxis color <type> #RRGGBB      border and title colour (default restores it)
/boxis background <type> #RRGGBB fixed background (none removes it)
/boxis screen light | dark       backgrounds for a light or a dark screen
/boxis check on | off            the ✓ button
/boxis skin none|animated-i|animated-ii   look and effects of the boxes
/boxis buttons top|bottom        the pin and check buttons at the top right or the bottom right of the box
/boxis pins                      opens the Pins pane
/boxis pins max 1-10             pins kept per session (default 5)
/boxis default                   every colour and the intensity back to the original (the pin limit stays)
```

Claude can make the same changes through the `design` tool, for example "make the warning box orange".

### Boxis skins

- **None**: plain boxes, no effects.
- **Animated I**: the title line is animated. A dot pulses on arrival and a glow runs along the border of a warning or a decision. Under the pointer the box thickens and brightens and its buttons light up in the box colour. The pin spins before landing on 📌 (and spins back on unpin), the ✓ fills up on click while the title is wiped out from the left, and the box blinks while closing.
- **Animated II (Neon)**: everything in Animated I, with bold borders (double on a decision) and brighter titles. A new warning or decision is drawn in: the border starts dim and the glow paints it in as it runs, with a spark at each corner. The pointer on the title row runs a shimmer across the title; closing ramps the background to green and runs the glow twice round; pinning plays a spark burst and a lap of light along the top border.

`/boxis skin animated i` and `/boxis skin Animated II` work too. The old `/boxis animation` command still works as an alias: `client` and `clock` set Animated I, `none` sets None. A config saved by an older version maps the same way.

## Check

Each box has a ○ on its title line. Clicking it marks the box as understood: it turns green and its text is dimmed and struck. The last box of the last answer also has **all**, which checks every box drawn in the conversation. Check marks are kept between sessions.

## Pins

The pin glyph ⚲ on a box pins it; it turns 📌. Pinning opens the **Pins** pane (`/boxis pins` opens it too), which redraws each pinned box as in the chat, with × to unpin. Pins are kept per session, 5 by default and up to 10 (`/boxis pins max N` or the −/+ in the colour pane). At the limit, pinning a new box unpins the oldest one of the session and a toast names it. Lowering the limit unpins nothing by itself: a session over it is trimmed on its next new pin. A pin older than 30 days is dropped on the next pin change, from any session: the mod is never told when a session is archived or deleted, so expiry is what clears the pins those sessions leave behind. The size of the stored pins is capped by a byte budget: past it, the oldest pins go first.

In the terminal, ↗ on a pin jumps back to that box in the chat. Jumping works only in the terminal: the desktop app does not support it yet, so there the pane shows the boxes with × alone.

## Skins

Optional. When the Skins mod is on, the text inside each box is drawn in the Skins theme. Without it, Boxis draws plain markdown. Boxis colours do not depend on Skins.

## Tests

The tests are run by the author, not in CI:

```bash
claude plugin validate .
claude plugin test .
```
