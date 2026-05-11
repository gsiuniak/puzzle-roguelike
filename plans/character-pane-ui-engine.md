# Character Pane UI Engine - Architecture Plan

## Overview

A reusable HTML5 Canvas-based UI engine with flexbox-inspired layout, used to render a dynamic character pane from mock data. This is the foundation layer -- no game logic, no combat, no match-3.

## File Structure

```
src/
  index.html
  js/
    main.js
    engine/
      CanvasApp.js       -- Canvas wrapper, resize handling, context management
      GameLoop.js        -- requestAnimationFrame loop with dt
      AssetManager.js    -- Image loading, caching, asset key resolution
      InputManager.js    -- Mouse/touch event handling, hit testing
    ui/
      Rect.js            -- Rectangle utility with x, y, w, h
      UIElement.js       -- Base class: layout, render, hitTest, padding, margin, debug
      UIContainer.js     -- Extends UIElement: flexbox-like layout (row/column, gap, justifyContent, alignItems)
      UIText.js          -- Text rendering with font, color, alignment, bold/italic
      UIImage.js         -- Sprite rendering with asset key, fit modes, fallback
      UIProgressBar.js   -- Value/maxValue bar with fill, background, centered label
      UIOrb.js           -- Circular mana orb with color, count text, optional image
      UIPanel.js         -- Panel with background image, border, rounded corners
      CharacterPane.js   -- Composite: header, health bar, stats, mana row, skills
      SkillRow.js        -- Single skill row: icon, name, description, cost orbs
    data/
      mockCharacter.js   -- Mock character data object
```

## Asset Key Mapping

The `AssetManager` resolves string keys to file paths:

```javascript
// AssetManager pathMap
{
  'placeholder':       'assets/sprites/placeholder.png',
  'character_pane_background': 'assets/sprites/character_pane/background/character_pane_background.png',
  'portrait_warrior':  'assets/sprites/character_pane/portraits/portrait_warrior.png',
  'portrait_goblin':   'assets/sprites/character_pane/portraits/portrait_goblin.png',
  'icon_attack':       'assets/sprites/character_pane/icons/icon_attack.png',
  'icon_block':        'assets/sprites/character_pane/icons/icon_block.png',
  'mana_red':          'assets/sprites/character_pane/mana/mana_red.png',
  'mana_blue':         'assets/sprites/character_pane/mana/mana_blue.png',
  'mana_green':        'assets/sprites/character_pane/mana/mana_green.png',
  'mana_yellow':       'assets/sprites/character_pane/mana/mana_yellow.png',
  'mana_purple':       'assets/sprites/character_pane/mana/mana_purple.png',
  'skill_slash':       'assets/sprites/character_pane/skills/skill_slash.png',
  'skill_bash':        'assets/sprites/character_pane/skills/skill_bash.png',
  'skill_defend':      'assets/sprites/character_pane/skills/skill_defend.png',
}
```

Skill icon mapping in mock data uses these keys:
- `whirlwind` -> `skill_slash` (swirling motion)
- `shield_bash` -> `skill_bash` (shield)
- `battle_roar` -> `placeholder` (no matching asset)
- `earthshaker` -> `skill_bash` (hammer/impact)
- `champions_resolve` -> `skill_defend` (defend/resolve)

## UI Engine Class Hierarchy

```
UIElement (base)
  |-- UIContainer (adds children + flexbox layout)
  |     |-- UIText
  |     |-- UIImage
  |     |-- UIProgressBar
  |     |-- UIOrb
  |     |-- UIPanel
  |     |-- CharacterPane
  |           |-- HeaderContainer
  |           |     |-- UIImage (portrait)
  |           |     |-- UIText (name)
  |           |     |-- UIText (className)
  |           |-- UIProgressBar (health)
  |           |-- StatsRow (UIContainer row)
  |           |     |-- UIImage (attack icon)
  |           |     |-- UIText (attack label)
  |           |     |-- UIText (attack value)
  |           |     |-- UIImage (armor icon)
  |           |     |-- UIText (armor label)
  |           |     |-- UIText (armor value)
  |           |-- ManaRow (UIContainer row)
  |           |     |-- UIOrb (red)
  |           |     |-- UIOrb (blue)
  |           |     |-- UIOrb (green)
  |           |     |-- UIOrb (yellow)
  |           |     |-- UIOrb (purple)
  |           |-- SkillsContainer (UIContainer column)
  |                 |-- UIText ("Skills" title)
  |                 |-- SkillRow (from skills[0])
  |                 |-- SkillRow (from skills[1])
  |                 |-- ...
  |                       |-- UIImage (icon)
  |                       |-- SkillInfoContainer (column)
  |                             |-- UIText (name)
  |                             |-- UIText (description)
  |                       |-- SkillCostContainer (row)
  |                             |-- UIOrb (red cost)
  |                             |-- UIOrb (yellow cost)
```

## Layout System Design

### Rect

Simple rectangle utility:

```javascript
class Rect {
  constructor(x, y, w, h)
  clone()
  copy(other)
  containsPoint(px, py)
  intersects(other)
  inflate(dx, dy)
}
```

### UIElement (base)

Properties:
- `parent` (UIElement | null)
- `children` (UIElement[])
- `rect` (Rect) -- computed layout rect
- `padding` (number | {top, right, bottom, left})
- `margin` (number | {top, right, bottom, left})
- `width` (number | null) -- null = auto
- `height` (number | null)
- `widthPercent` (number | null) -- fraction of available width (0-1)
- `heightPercent` (number | null)
- `flexGrow` (number) -- 0 = fixed, >0 = fill remaining space
- `minWidth` (number)
- `maxWidth` (number)
- `minHeight` (number)
- `maxHeight` (number)
- `alignSelfH` ('left' | 'center' | 'right' | 'stretch')
- `alignSelfV` ('top' | 'center' | 'bottom' | 'stretch')
- `debug` (boolean) -- draw debug outline
- `visible` (boolean)

Methods:
- `layout(parentRect)` -- compute this element's rect from parent
- `render(ctx)` -- no-op base
- `update(dt)` -- no-op base
- `hitTest(x, y)` -- returns true if point is inside rect
- `addChild(child)` -- add child with parent set
- `removeChild(child)` -- remove child
- `clearChildren()` -- remove all children
- `setStyle(styleObj)` -- batch set properties

### UIContainer (extends UIElement)

Additional properties:
- `direction` ('row' | 'column')
- `gap` (number)
- `justifyContent` ('start' | 'center' | 'end' | 'space-between')
- `alignItems` ('start' | 'center' | 'end' | 'stretch')
- `background` (string | null) -- color or asset key
- `borderColor` (string | null)
- `borderWidth` (number)

Layout algorithm:
1. Calculate available space from parent rect minus padding minus margins
2. First pass: measure all children (fixed sizes first, then percent, then flexGrow)
3. Distribute remaining space according to justifyContent / alignItems
4. Layout each child with its computed rect
5. Recursively call `layout()` on each child

### UIText (extends UIElement)

Properties:
- `text` (string) -- dynamic, can change
- `fontSize` (number)
- `fontFamily` (string)
- `color` (string) -- CSS color
- `bold` (boolean)
- `italic` (boolean)
- `alignH` ('left' | 'center' | 'right')
- `alignV` ('top' | 'center' | 'bottom')
- `maxWidth` (number, for clipping)

Render:
- Draw text with `ctx.fillText()` / `ctx.strokeText()`
- Measure text for alignment
- Clip if text exceeds maxWidth

### UIImage (extends UIElement)

Properties:
- `assetKey` (string) -- key into AssetManager
- `fitMode` ('contain' | 'cover' | 'stretch')
- `drawWidth` (number) -- explicit draw size override
- `drawHeight` (number)

Render:
- Look up image from AssetManager by assetKey
- If not loaded or null, draw placeholder
- Draw image according to fitMode within element rect

### UIProgressBar (extends UIElement)

Properties:
- `value` (number)
- `maxValue` (number)
- `fillColor` (string)
- `backgroundColor` (string)
- `label` (string) -- centered text inside bar
- `labelColor` (string)
- `borderColor` (string)
- `borderWidth` (number)
- `cornerRadius` (number)

Render:
- Draw background rect
- Draw fill rect (clipped to corner radius)
- Draw border
- Draw centered label text

### UIOrb (extends UIElement)

Properties:
- `color` (string) -- fallback fill color
- `count` (number) -- text displayed inside
- `assetKey` (string | null) -- optional image overlay
- `fontSize` (number)
- `textColor` (string)
- `borderColor` (string)
- `borderWidth` (number)

Render:
- Draw circle with color fill
- Draw border ring
- Draw count text centered
- If assetKey provided, draw image centered (optional overlay)

### UIPanel (extends UIContainer)

Properties:
- `backgroundAssetKey` (string) -- asset key for background image
- `cornerRadius` (number)

Render:
- Draw background image stretched or tiled
- Draw children
- Draw border if specified

### CharacterPane (extends UIPanel)

This is the main composite component. It takes a character data object and builds its internal hierarchy from it.

Constructor:
- `constructor(characterData)` -- stores reference to data object

Build method:
- `buildHierarchy()` -- creates all child UIElements from characterData
- `updateFromData()` -- updates text/values from current characterData (called when data changes)

Internal structure:
```
CharacterPane (panel, column, padding)
  |-- HeaderSection (row, padding)
  |     |-- Portrait (UIImage, fixed size)
  |     |-- HeaderInfo (column, gap)
  |           |-- NameText (UIText)
  |           |-- ClassText (UIText)
  |-- HealthBar (UIProgressBar)
  |-- StatsRow (UIContainer, row, space-between)
  |     |-- AttackStat (row)
  |     |     |-- AttackIcon (UIImage)
  |     |     |-- AttackLabel (UIText)
  |     |     |-- AttackValue (UIText)
  |     |-- ArmorStat (row)
  |           |-- ArmorIcon (UIImage)
  |           |-- ArmorLabel (UIText)
  |           |-- ArmorValue (UIText)
  |-- ManaRow (UIContainer, row, center, space-between)
  |     |-- RedOrb (UIOrb)
  |     |-- BlueOrb (UIOrb)
  |     |-- GreenOrb (UIOrb)
  |     |-- YellowOrb (UIOrb)
  |     |-- PurpleOrb (UIOrb)
  |-- SkillsSection (column, gap)
        |-- SkillsTitle (UIText)
        |-- SkillsList (column, gap)
              |-- SkillRow (from skills[0])
              |-- SkillRow (from skills[1])
              |-- ...
```

### SkillRow (extends UIContainer)

Each skill row is generated dynamically from a skill object.

Constructor:
- `constructor(skillData)` -- stores reference to skill data

Build method:
- `buildHierarchy()` -- creates child elements from skillData

Internal structure:
```
SkillRow (container, row, padding)
  |-- SkillIcon (UIImage, fixed size)
  |-- SkillInfo (column, gap)
  |     |-- SkillName (UIText, bold)
  |     |-- SkillDesc (UIText)
  |-- SkillCosts (row, gap)
        |-- CostOrb (UIOrb, red, count)
        |-- CostOrb (UIOrb, yellow, count)
        |-- ... (one per cost entry)
```

## Data Flow

```
mockCharacter.js
    |
    v
main.js -- creates AssetManager, loads assets
    |                    |
    |                    v
    |              CanvasApp
    |                    |
    v                    v
CharacterPane <-- GameLoop (update + render)
    |
    +-- updateFromData() called when character data changes
```

## Main.js Flow

1. Create `AssetManager`
2. Define asset key map
3. Load all assets (preload)
4. Create `CanvasApp` (full window)
5. Create `mockCharacter` data object
6. Create `CharacterPane` with mock character data
7. Position pane centered on canvas
8. In game loop: `characterPane.update(dt)` then `characterPane.render(ctx)`
9. On resize: recalculate pane position

## Debug Mode

`DEBUG_UI_LAYOUT = true` draws:
- Red outline around every UIElement rect
- Element type label in corner
- This helps verify layout correctness

## Key Design Decisions

1. **No hardcoded values in renderers** -- All text, values, icons come from data objects
2. **Skills are fully dynamic** -- Number, names, costs, icons all from data
3. **Asset keys, not paths** -- UI code references `assetKey` strings, resolved by AssetManager
4. **Graceful degradation** -- Missing assets show placeholder, missing costs are skipped
5. **Data reference, not copy** -- CharacterPane holds reference to data object, so changing data and calling `updateFromData()` reflects changes
6. **Flexbox-inspired** -- Container uses row/column, gap, justifyContent, alignItems
7. **Canvas-only** -- No DOM elements for UI, pure Canvas rendering

## Visual Design Targets

- Pane size: ~400x600px (scaled to fit screen, capped)
- Background: dark stone texture from `character_pane_background.png`
- Portrait: circular frame from `portrait_warrior.png`
- Health bar: red fill, ~60px tall, centered HP text
- Stats row: icon + label + value, clean alignment
- Mana orbs: ~40px diameter, colored circles with count text
- Skills: ~80px tall rows, icon + name + description + cost orbs
- Font: fantasy-style serif (e.g., 'Georgia', 'Times New Roman')
- Colors: dark backgrounds, gold/white text, colored mana orbs
