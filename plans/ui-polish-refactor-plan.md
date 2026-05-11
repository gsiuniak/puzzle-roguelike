# UI Polish / Refactor Plan

## 1. Mismatch Analysis

### Current Architecture Summary

```
BattleScene (column)
  MainRow (row, flexGrow=1)
    PlayerPane   (CharacterPane, ~25% width)
      HeaderRow (row)
        Portrait (68x68, fitMode: cover)
        NameCol (column)
          NameText (22px bold)
          ClassText (14px italic)
      HealthBar (48px height, progress bar)
      StatsRow (row, space-around, 40px height)
        AttackGroup (row)
          AttackIcon (28x28)
          AttackLabel ("ATK", 13px)
          AttackValue (15px)
        ArmorGroup (row)
          ArmorIcon (28x28)
          ArmorLabel ("DEF", 13px)
          ArmorValue (15px)
      ManaRow (row, 80px height, background: skill_row image)
        UIOrb x5 (44x66, showAmountPlate: true)
      SkillsTitle ("Skills", 16px bold)
      SkillsContainer (column, gap: 2)
        SkillRow xN (60px height)
          Icon (48x48, contain)
          InfoCol (column, flexGrow=1)
            NameText (15px bold)
            DescText (11px italic)
          CostContainer (row, 36px height)
            UIOrb xM (32x32, simple mode)
```

---

### Problem 1: Character Pane Background Fitting

**Current State:**
- [`UIPanel.renderSelf()`](src/js/ui/UIPanel.js:18) uses cover mode: `scale = Math.max(r.w / img.width, r.h / img.height)`
- This scales the image to cover the panel, center-cropping excess
- The panel has `cornerRadius: 8` which clips the background

**Root Cause:**
- The background image `character_pane_background.png` likely has a specific aspect ratio
- When the panel is resized (responsive), the cover scaling causes unwanted cropping
- No explicit sizing constraints on the background image itself

**Assessment:**
- The cover mode in [`UIPanel.renderSelf()`](src/js/ui/UIPanel.js:30) is actually correct for "background cover" behavior
- The issue is likely that the panel dimensions don't match the intended aspect ratio of the background
- The background image may be getting cropped too aggressively on one axis

**Fix Strategy:**
- Keep cover mode (it is the correct approach)
- Ensure the panel has a minimum aspect ratio that matches the background image
- Add `minWidth`/`minHeight` constraints to preserve the intended look
- Consider adding a subtle tint overlay to handle aspect ratio mismatches gracefully

---

### Problem 2: Skill Row Internal Padding / Spacing

**Current State:**
- [`SkillRow`](src/js/ui/SkillRow.js:17) has `padding: { top: 4, right: 6, bottom: 4, left: 6 }`
- `gap: 8` between icon, info column, and cost container
- Icon is fixed at 48x48
- Info column has `flexGrow: 1`
- Cost container has fixed `height: 36`
- Row height is fixed at 60px

**Root Cause:**
- Horizontal padding of only 6px is too tight for an RPG card feel
- The 48x48 icon takes up significant space with minimal breathing room
- Description text at 11px with `maxWidth: 180` may be cramped
- No vertical subdivision between icon area, text area, and cost area

**Fix Strategy:**
- Increase horizontal padding to `{ top: 8, right: 12, bottom: 8, left: 12 }`
- Increase gap between sections to 10
- Create explicit subdivisions:
  - Icon area: fixed 56x56 container (gives 8px padding around 48px icon)
  - Text area: flexGrow=1, with internal padding
  - Cost area: fixed-width container (auto-sized to contents + padding)
- Increase row height to 64px for more vertical breathing room
- Increase name font to 16px, description to 12px

---

### Problem 3: Mana Cost Presentation

**Current State:**
- [`SkillRow._costContainer`](src/js/ui/SkillRow.js:102) is a row container with `gap: 6`
- Each cost is a [`UIOrb`](src/js/ui/UIOrb.js:17) at 32x32 in simple mode (no plate)
- Orbs are rendered without numeric values visible (count is inside orb but orb is small)
- No separator between multiple costs

**Root Cause:**
- The 32x32 simple orb renders the count inside, but at small size the number is hard to read
- Multiple costs like `{ red: 8, yellow: 4 }` render as `[orb] [orb]` without clear separation
- No explicit right-alignment within the skill row

**Fix Strategy:**
- Create a dedicated `ManaCostRow` component (reusable, data-driven)
- Each cost item renders: `[simple orb 24x24] [number text]`
- Multiple costs separated by a vertical divider or slash
- Container aligns right within the skill row
- Support arbitrary cost counts dynamically

**Component Design:**
```
ManaCostRow (UIContainer, row, alignItems: center)
  CostItem xN
    SimpleOrb (24x24)
    CostValue (14px bold, right-aligned)
  Separator (optional, between items)
```

---

### Problem 4: Attack / Armor Area

**Current State:**
- [`StatsRow`](src/js/ui/CharacterPane.js:145) uses `justifyContent: 'space-around'`
- Fixed height of 40px
- Each stat group: icon (28x28) + label (13px) + value (15px)
- Gap of 16px between groups
- Background: `rgba(0,0,0,0.3)` with `cornerRadius: 4`

**Root Cause:**
- `space-around` distributes space unevenly when groups have different widths
- 40px height is tight for icon + label + value hierarchy
- No visual separation between attack and armor sections
- Label and value colors are similar (both light), reducing hierarchy

**Fix Strategy:**
- Increase height to 48px
- Use `justifyContent: 'center'` with explicit gap of 24px
- Add a vertical divider between attack and armor
- Increase icon size to 32x32
- Increase label to 14px, value to 18px
- Add subtle background panel to each stat group
- Use distinct color hierarchy: icon colored, label muted, value bright

---

### Problem 5: Mana Orb + Decorative Plate Layering

**Current State:**
- [`UIOrb._renderWithPlate()`](src/js/ui/UIOrb.js:101) renders:
  1. Amount plate at `plateY = r.y + orbSize * 0.48`
  2. Orb circle at `orbCy = r.y + orbSize / 2`
  3. Count text at `countY = plateY + plateH / 2`
- Plate dimensions: `plateW = orbSize * 0.7`, `plateH = orbSize * 0.5`
- Orb size: `orbSize = Math.min(r.w, r.h * 0.65)`

**Root Cause:**
- The plate offset (`0.48`) may not align well with the orb bottom
- The count text is centered on the plate, but the visual balance point should be between orb bottom and plate top
- The plate image (`mana_amount`) may not match the intended decorative style

**Fix Strategy:**
- Adjust plate vertical position to sit slightly below orb bottom
- Recalculate count Y position to sit between orb and plate
- Visual hierarchy should be:
  ```
        [ORB]       <- orbCy at ~35% of container height
     [decorative]    <- plateY at ~55% of container height
          12         <- count at ~50% (between orb and plate)
  ```
- Increase orb size to use more vertical space (70% of container)
- Plate should be positioned so orb overlaps it by ~15%

---

## 2. Implementation Plan

### Phase 1: Foundation Changes (Layout Constants)

**File: [`CharacterPane.js`](src/js/ui/CharacterPane.js)**

| Change | Current | Target | Reason |
|--------|---------|--------|--------|
| Panel padding | `{ top: 12, right: 14, bottom: 14, left: 14 }` | `{ top: 14, right: 16, bottom: 16, left: 16 }` | More breathing room at edges |
| Panel gap | `8` | `10` | Better section separation |
| Header height | `80` | `88` | Accommodate larger portrait |
| Portrait size | `68x68` | `76x76` | More prominent character identity |
| Health bar height | `48` | `52` | Better visibility |
| Stats row height | `40` | `48` | Balanced stat presentation |
| Stats row gap | `16` | `24` | Clearer separation |
| Mana row height | `80` | `88` | Better orb visibility |
| Orb size | `44x66` | `48x72` | Larger, more readable |
| Skill row height | `60` | `64` | More padding room |
| Skills container gap | `2` | `4` | Better card separation |

### Phase 2: SkillRow Refactor

**File: [`SkillRow.js`](src/js/ui/SkillRow.js)**

| Change | Current | Target |
|--------|---------|--------|
| Padding | `{ top: 4, right: 6, bottom: 4, left: 6 }` | `{ top: 8, right: 12, bottom: 8, left: 12 }` |
| Gap | `8` | `10` |
| Icon container | None (direct image) | 56x56 container with centered 48x48 icon |
| Icon size | `48x48` | `48x48` (in 56x56 container) |
| Name font | `15px` | `16px` |
| Desc font | `11px` | `12px` |
| Desc maxWidth | `180` | `200` |
| Cost container | Inline row | Right-aligned ManaCostRow |
| Cost orb size | `32x32` | `24x24` (simple) |
| Cost value text | None | `14px bold` next to orb |

### Phase 3: ManaCostRow Component

**New File: `src/js/ui/ManaCostRow.js`**

```javascript
/**
 * ManaCostRow - renders skill mana costs in a clean right-aligned row.
 *
 * Structure:
 *   [red orb] 8  /  [yellow orb] 4
 *
 * Properties:
 *   costData - { red: 8, yellow: 4, ... }
 *   assetManager - AssetManager instance
 */
export default class ManaCostRow extends UIContainer {
  constructor(costData = null, assetManager = null) {
    super();
    this.direction = 'row';
    this.gap = 4;
    this.alignItems = 'center';
    this.justifyContent = 'end';
    
    this._costData = costData;
    this._assetManager = assetManager;
    this._costOrbs = [];
    this._costValues = [];
    this._separators = [];
    
    if (costData) this.buildHierarchy();
  }
  
  buildHierarchy() {
    // Clear existing
    this.clearChildren();
    this._costOrbs = [];
    this._costValues = [];
    this._separators = [];
    
    const manaColors = {
      red: '#cc3333',
      blue: '#3366cc',
      green: '#33aa33',
      yellow: '#cccc33',
      purple: '#9933cc',
    };
    
    const colors = Object.keys(this._costData).filter(c => this._costData[c] > 0);
    
    for (let i = 0; i < colors.length; i++) {
      const color = colors[i];
      const amount = this._costData[color];
      
      // Separator between multiple costs
      if (i > 0) {
        const separator = new UIText('/');
        separator.setStyle({
          fontSize: 14,
          color: '#888888',
          bold: true,
          alignH: 'center',
          alignV: 'center',
        });
        this.addChild(separator);
        this._separators.push(separator);
        this.gap = 6; // slightly more space with separator
      }
      
      // Simple orb
      const orb = new UIOrb();
      orb.setStyle({
        color: manaColors[color] || '#888888',
        count: amount,
        countColor: '#ffffff',
        fontSize: 10,
        width: 24,
        height: 24,
        borderWidth: 1,
        showAmountPlate: false,
      });
      
      if (this._assetManager) {
        const key = `mana_${color}_simple`;
        if (this._assetManager.get(key)) {
          orb.assetKey = key;
          orb.assetManager = this._assetManager;
        }
      }
      
      this.addChild(orb);
      this._costOrbs.push(orb);
      
      // Value text
      const value = new UIText(String(amount));
      value.setStyle({
        fontSize: 14,
        color: '#ffffff',
        bold: true,
        alignH: 'center',
        alignV: 'center',
      });
      this.addChild(value);
      this._costValues.push(value);
    }
  }
  
  setCostData(data) {
    this._costData = data;
    this.clearChildren();
    this._costOrbs = [];
    this._costValues = [];
    this._separators = [];
    this.buildHierarchy();
  }
}
```

### Phase 4: UIOrb Layering Fix

**File: [`UIOrb.js`](src/js/ui/UIOrb.js)**

Changes to `_renderWithPlate()`:

```javascript
_renderWithPlate(ctx, r) {
  // Larger orb: 70% of container height
  const orbSize = Math.min(r.w, r.h * 0.70);
  const orbCx = r.x + r.w / 2;
  const orbCy = r.y + orbSize * 0.35;  // orb centered at 35% from top
  const orbRadius = orbSize / 2 - this.borderWidth;
  
  // Plate: positioned below orb, slightly overlapped
  const plateW = orbSize * 0.80;  // slightly wider plate
  const plateH = orbSize * 0.35;  // thinner plate
  const plateX = r.x + (r.w - plateW) / 2;
  const plateY = r.y + orbSize * 0.55;  // plate starts at 55% from top
  
  // Count text: centered between orb bottom and plate center
  const countY = plateY + plateH * 0.5;
  
  // ... rest of render logic unchanged
}
```

### Phase 5: Stats Row Enhancement

**File: [`CharacterPane.js`](src/js/ui/CharacterPane.js)**

Changes to stats row construction:

```javascript
const statsRow = new UIContainer();
statsRow.direction = 'row';
statsRow.justifyContent = 'center';  // changed from space-around
statsRow.alignItems = 'center';
statsRow.gap = 24;                    // increased from 16
statsRow.padding = { top: 6, right: 12, bottom: 6, left: 12 };
statsRow.height = 48;                 // increased from 40
statsRow.background = 'rgba(0,0,0,0.35)';
statsRow.cornerRadius = 6;            // increased from 4

// Each stat group gets its own mini-panel
const statGroup = new UIContainer();
statGroup.direction = 'row';
statGroup.gap = 8;                    // increased from 6
statGroup.alignItems = 'center';
statGroup.background = 'rgba(255,255,255,0.05)';
statGroup.cornerRadius = 4;
statGroup.padding = { top: 4, right: 8, bottom: 4, left: 8 };

// Icon: 32x32 (increased from 28)
icon.setStyle({ width: 32, height: 32, fitMode: 'contain' });

// Label: 14px (increased from 13)
label.setStyle({ fontSize: 14, ... });

// Value: 18px (increased from 15)
value.setStyle({ fontSize: 18, ... });
```

---

## 3. Component Responsibilities

| Component | Responsibility | Changes |
|-----------|---------------|---------|
| [`CharacterPane`](src/js/ui/CharacterPane.js) | Top-level composite, data binding | Update all sizing constants, stats layout |
| [`SkillRow`](src/js/ui/SkillRow.js) | Single skill card layout | Increase padding, restructure subdivisions |
| [`ManaCostRow`](src/js/ui/ManaCostRow.js) | NEW: Mana cost display | New component for clean cost presentation |
| [`UIOrb`](src/js/ui/UIOrb.js) | Orb rendering (simple + plate) | Fix plate layering offsets |
| [`UIPanel`](src/js/ui/UIPanel.js) | Background image rendering | No changes needed (cover mode is correct) |
| [`UIImage`](src/js/ui/UIImage.js) | Image rendering | No changes needed |
| [`UIText`](src/js/ui/UIText.js) | Text rendering | No changes needed |
| [`UIContainer`](src/js/ui/UIContainer.js) | Flexbox layout | No changes needed |
| [`UIProgressBar`](src/js/ui/UIProgressBar.js) | Health bar | Minor height increase only |

---

## 4. Layout Hierarchy Improvements

### Before (Current)

```
CharacterPane (padding: 14, gap: 8)
  HeaderRow (height: 80, gap: 10)
    Portrait (68x68)
    NameCol
      Name (22px)
      Class (14px)
  HealthBar (48px)
  StatsRow (height: 40, gap: 16, space-around)
    Attack (icon: 28, label: 13px, value: 15px)
    Armor  (icon: 28, label: 13px, value: 15px)
  ManaRow (height: 80)
    Orb (44x66) x5
  SkillsTitle (16px)
  SkillsContainer (gap: 2)
    SkillRow (height: 60, padding: 6)
      Icon (48x48)
      InfoCol (name: 15px, desc: 11px)
      CostContainer (32x32 orbs)
```

### After (Planned)

```
CharacterPane (padding: 16, gap: 10)
  HeaderRow (height: 88, gap: 12)
    Portrait (76x76)
    NameCol
      Name (24px bold)
      Class (15px italic)
  HealthBar (52px)
  StatsRow (height: 48, gap: 24, center)
    [Attack Panel]
      Icon (32x32) + Label (14px) + Value (18px)
    [Divider]
    [Armor Panel]
      Icon (32x32) + Label (14px) + Value (18px)
  ManaRow (height: 88)
    Orb (48x72, improved plate) x5
  SkillsTitle (18px bold)
  SkillsContainer (gap: 4)
    SkillRow (height: 64, padding: 12)
      IconContainer (56x56)
        Icon (48x48)
      InfoCol (name: 16px, desc: 12px)
      ManaCostRow (right-aligned)
        [Orb 24x24] Value / [Orb 24x24] Value
```

---

## 5. Reusable Component Changes

### Constraints Preserved

1. **No hardcoded values for specific characters** - All sizing uses relative constants
2. **Data-driven architecture** - Components still accept data objects
3. **Reusable CharacterPane** - Same component works for player and enemy
4. **Reusable SkillRow** - Works with any skill data
5. **Reusable ManaCostRow** - Works with any mana cost combination
6. **Responsive scaling** - flexGrow and widthPercent still work

### New Constants (Configurable)

These should be defined as module-level constants for easy tuning:

```javascript
// CharacterPane constants
const CHAR_PANE = {
  PADDING: 16,
  GAP: 10,
  HEADER_HEIGHT: 88,
  HEADER_GAP: 12,
  PORTRAIT_SIZE: 76,
  HEALTH_BAR_HEIGHT: 52,
  STATS_HEIGHT: 48,
  STATS_GAP: 24,
  MANA_ROW_HEIGHT: 88,
  ORB_SIZE: { width: 48, height: 72 },
  SKILLS_TITLE_SIZE: 18,
  SKILLS_GAP: 4,
};

// SkillRow constants
const SKILL_ROW = {
  HEIGHT: 64,
  PADDING: { top: 8, right: 12, bottom: 8, left: 12 },
  GAP: 10,
  ICON_CONTAINER: 56,
  ICON_SIZE: 48,
  NAME_FONT_SIZE: 16,
  DESC_FONT_SIZE: 12,
  DESC_MAX_WIDTH: 200,
  COST_ORB_SIZE: 24,
  COST_VALUE_FONT_SIZE: 14,
};

// Stats constants
const STATS = {
  ICON_SIZE: 32,
  LABEL_FONT_SIZE: 14,
  VALUE_FONT_SIZE: 18,
  GROUP_PADDING: { top: 4, right: 8, bottom: 4, left: 8 },
  GROUP_GAP: 8,
};

// UIOrb constants
const ORB = {
  PLATE_VERTICAL_OFFSET: 0.55,
  ORB_VERTICAL_OFFSET: 0.35,
  ORB_SIZE_RATIO: 0.70,
  PLATE_WIDTH_RATIO: 0.80,
  PLATE_HEIGHT_RATIO: 0.35,
};
```

---

## 6. Implementation Order

1. **Phase A**: Update constants in [`CharacterPane.js`](src/js/ui/CharacterPane.js) (sizing, padding, gaps)
2. **Phase B**: Refactor [`SkillRow.js`](src/js/ui/SkillRow.js) (padding, subdivisions, cost layout)
3. **Phase C**: Create [`ManaCostRow.js`](src/js/ui/ManaCostRow.js) (new component)
4. **Phase D**: Fix [`UIOrb.js`](src/js/ui/UIOrb.js) plate layering
5. **Phase E**: Update [`BattleScene.js`](src/js/ui/BattleScene.js) if needed for container sizing

---

## 7. Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Background image looks wrong at new sizes | Low | Cover mode handles most cases; add min-size constraints |
| Text overflows at small screen sizes | Medium | Use maxWidth on text elements; test responsive behavior |
| ManaCostRow breaks existing skill data | Low | Component handles empty/missing cost gracefully |
| Plate layering looks off with different orb colors | Low | Plate uses separate mana_amount asset, not color-dependent |
| Layout breaks on very narrow panels | Medium | Add minWidth constraints to CharacterPane |
