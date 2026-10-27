# Page design

Every page (home, `/all`, a work page, present mode) follows this. The colours and the shared parts
live in `server.js`: `DARK`, `LIGHT`, `THEME_CSS` and `DESIGN_CSS`. Change them there, never per page.

## Colour

Dark is the default. Light is used when the system asks for it. Each colour has one job.

| Token | Job |
| --- | --- |
| `--bg` | page background |
| `--panel` | a panel or card that holds content |
| `--card` | a card inside a panel |
| `--line` | borders and dividers |
| `--fg` | text you read first |
| `--dim` | text you read second: detail, times, labels |
| `--acc` | something you can click, and code names |
| `--warn` | needs the owner: attention panel, open questions, waiting work |
| `--ok` | done |
| `--bad` | rejected or failed |

Contrast holds at low screen brightness: `--dim` stays readable on `--panel`. Never add a colour
that only differs from another by a few shades.

## Reading order

A reader scans first and reads second. Every block gives the scan something to land on.

1. **Section label:** small, uppercase, monospace, `--dim`. It says what the block is.
2. **Headline:** the first sentence of a point, or a card title. `--fg`, weight 500.
3. **Detail:** everything after the headline. `--dim`.
4. **Code:** function, module, column and file names, and constants. Monospace on a light `--acc`
   tint. Written without backticks, they are still picked up.
5. **Numbers and times:** monospace, so columns of them line up.

Hierarchy comes from order, weight and colour, not from many sizes. Body text is 13 to 15px.

## Layout

- **Home fits one screen.** No page scroll. What does not fit in a panel becomes "+N more", which
  links to the same part of `/all`.
- **One reading column.** Points run straight down, at most about 80 characters wide. Never two or
  three across, which makes the eye zig-zag.
- **Click to go deeper.** A count jumps to its part. A card opens its work page.
- **Old work steps back.** A work item with no change for 2 days gets a dashed border and a grey
  ring instead of the blue dot.

## Parts

| Part | Used for |
| --- | --- |
| `panel` | a titled block of rows or cards; `panel attention` for things that need the owner |
| `row` | one line in a panel: text left, time or tag right |
| `tile` | one work item: status dot, title, age, open questions, next step |
| `stat` | a count in the top bar; amber when it needs the owner and is not zero |

## Not used

- No sci-fi screen effects: no glow, scan lines, grids or angled corners.
- No colour to decorate. Colour always means one of the jobs above.
- Hand-drawn diagrams (Virgil font) stay on work pages and in present mode, nowhere else.
