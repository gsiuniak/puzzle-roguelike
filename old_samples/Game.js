/**
 * Game module.
 * Top-level game controller that wires together all subsystems.
 */

import { BattleSystem, BattleState } from './BattleSystem.js';
import { Board, BOARD_WIDTH, BOARD_HEIGHT } from './Board.js';
import { CanvasRenderer, Particle } from '../engine/CanvasRenderer.js';
import { Input } from '../engine/Input.js';
import { GameLoop } from '../engine/GameLoop.js';
import { UI } from './UI.js';
import { SpriteManager, loadSprites } from '../engine/SpriteManager.js';
import { TILE_TYPES } from './data/tileTypes.js';
import { CLASSES } from './data/classes.js';
import { ENEMIES } from './data/enemies.js';

/**
 * Game - the main controller that ties everything together.
 */
export class Game {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;

    // Subsystems
    this.battleSystem = null;
    this.renderer = new CanvasRenderer(canvas);
    this.input = new Input(canvas);
    this.ui = new UI();
    this.loop = null;

    // Game state for rendering
    this.currentSide = 'player';
    this.gameOver = false;
    this.winner = null;
    this.hoveredTile = null;
    this.selectedTile = null;
    this.hoveredSkill = null;

    // AI action pending flag
    this.aiActionPending = false;
    this.aiThinking = false;

    // Enemy target tile (for visual cursor)
    this.enemyTargetTile = null;

    // Animation state
    this.animating = false;
    this.swapAnimationPending = null; // {col1, row1, col2, row2}
    this.fallAnimationData = [];

    // Track last resolved matches for particle effects
    this.lastMatchPositions = [];
    this.lastMatchColors = [];
    this.particleDelay = 0;
  }

  /**
   * Initialize tile sprites via SpriteManager.
   * @returns {Promise<void>}
   * @private
   */
  async _initSprites() {
    const tileSpriteMappings = {};
    for (const [key, type] of Object.entries(TILE_TYPES)) {
      if (type.spriteKey) {
        tileSpriteMappings[type.spriteKey] = {
          url: `assets/sprites/tiles/${type.id}_tile.png`,
          width: 56,
          height: 56
        };
      }
    }
    SpriteManager.registerMultiple(tileSpriteMappings);
    
    // Load all registered tile sprites
    const urls = Object.values(tileSpriteMappings).map(m => m.url);
    await loadSprites(urls);
  }

  /**
   * Initialize character panel sprites (portraits, icons, skills).
   * @returns {Promise<void>}
   * @private
   */
  async _initCharacterPanelSprites() {
    // Collect all unique URLs from classes and enemies
    const urlSet = new Set();
    
    // Panel background
    urlSet.add('assets/sprites/character_pane/background/character_pane_background.png');
    
    // Mana sprites
    urlSet.add('assets/sprites/character_pane/mana/mana_red.png');
    urlSet.add('assets/sprites/character_pane/mana/mana_blue.png');
    urlSet.add('assets/sprites/character_pane/mana/mana_green.png');
    urlSet.add('assets/sprites/character_pane/mana/mana_yellow.png');
    urlSet.add('assets/sprites/character_pane/mana/mana_purple.png');
    
    // From classes
    for (const cls of Object.values(CLASSES)) {
      if (cls.portraitUrl) urlSet.add(cls.portraitUrl);
      if (cls.attackIconUrl) urlSet.add(cls.attackIconUrl);
      if (cls.armorIconUrl) urlSet.add(cls.armorIconUrl);
      for (const skill of cls.skills) {
        if (skill.iconUrl) urlSet.add(skill.iconUrl);
      }
    }
    
    // From enemies
    for (const enemy of Object.values(ENEMIES)) {
      if (enemy.portraitUrl) urlSet.add(enemy.portraitUrl);
      if (enemy.attackIconUrl) urlSet.add(enemy.attackIconUrl);
      if (enemy.armorIconUrl) urlSet.add(enemy.armorIconUrl);
      for (const skill of enemy.skills) {
        if (skill.iconUrl) urlSet.add(skill.iconUrl);
      }
    }
    
    // Load all character panel sprites
    const urls = Array.from(urlSet);
    if (urls.length > 0) {
      await loadSprites(urls);
    }
  }

  /**
   * Initialize the game.
   */
  async init() {
    // Register and load tile sprites
    await this._initSprites();
    // Load character panel sprites
    await this._initCharacterPanelSprites();
    
    // Set canvas size
    this.renderer.setSize();

    // Set input layout info
    this.input.boardX = this.renderer.boardX;
    this.input.boardY = this.renderer.boardY;
    this.input.tileSize = this.renderer.tileSize;
    this.input.boardWidth = BOARD_WIDTH;
    this.input.boardHeight = BOARD_HEIGHT;

    // Create battle system
    this.battleSystem = new BattleSystem('warrior', 'goblin');

    // Wire up canvas renderer with battle system
    this.renderer.setBattleSystem(this.battleSystem);
    this.renderer.setOnSkillClick((skill) => {
      this._handleSkillClick(skill);
    });

    // Wire up battle system events
    this._setupEventListeners();

    // Wire up input callbacks
    this.input.setSwapCallback((col1, row1, col2, row2) => {
      this._handleSwap(col1, row1, col2, row2);
    });

    this.input.setSkillClickCallback((skill) => {
      this._handleSkillClick(skill);
    });

    // Create game loop
    this.loop = new GameLoop(this);
  }

  /**
   * Set up event listeners from battle system.
   * @private
   */
  _setupEventListeners() {
    // Combat log updates
    this.battleSystem.on('combatLog', ({ message }) => {
      this.ui.addLogEntry(message);
    });

    // Mana gained
    this.battleSystem.on('manaGained', ({ side, color, amount }) => {
      // Particles handled in matchFound
    });

    // Damage events - trigger screen shake and red flash
    this.battleSystem.on('damageDealt', ({ source, target, amount, type }) => {
      // Screen shake effect for both skull and skill damage
      this.renderer.triggerScreenShake(8, 300);
      // Red flash on the damaged character's panel
      this.renderer.triggerRedFlash(target.side, 400);
    });

    // Game over
    this.battleSystem.on('gameOver', ({ winner }) => {
      this.gameOver = true;
      this.winner = winner;
      this.ui.setGameOver(winner);
      this.input.setEnabled(false);
    });

    // Swap started - trigger swap animation
    this.battleSystem.on('swap', ({ from, to }) => {
      this.renderer.startSwapAnimation(from.col, from.row, to.col, to.row);
      // Clear player selection immediately when swap starts
      this.input.selectedTile = null;
    });

    // Enemy swap - show destination tile cursor
    this.battleSystem.on('enemySwap', ({ from, to, targetTile }) => {
      // Highlight the destination tile of the swap (where tile is moving TO)
      this.enemyTargetTile = to;
      this.renderer.setEnemyTargetTile(to);
    });

    // Extra turn toast (triggered immediately when 4+ match is detected)
    this.battleSystem.on('extraTurn', ({ side }) => {
      // Trigger extra turn overlay animation
      this.renderer.triggerExtraTurnOverlay(side);
    });

    // Extra turn confirmed (emitted after all cascades complete - updates game state)
    this.battleSystem.on('extraTurnConfirmed', ({ side }) => {
      this.currentSide = side;
      this.battleSystem.grantExtraTurn(side);
    });

    // Board settled
    this.battleSystem.on('boardSettled', () => {
      // Clear any remaining animations
      this.renderer.tileAnimations = {};
      this.animating = false;
      // Clear enemy target tile
      this.enemyTargetTile = null;
      this.renderer.setEnemyTargetTile(null);
      // Re-enable input for player turn
      if (this.currentSide === 'player' && !this.gameOver) {
        this.input.setEnabled(true);
      }
    });

    // Match found - spawn particles
    this.battleSystem.on('matchFound', ({ matches, cascade }) => {
      for (const match of matches) {
        const tileType = match.typeId;
        const color = match.typeId === 'skull' ? '#2C3E50' :
          match.typeId === 'red' ? '#E74C3C' :
          match.typeId === 'blue' ? '#3498DB' :
          match.typeId === 'green' ? '#2ECC71' :
          match.typeId === 'yellow' ? '#F1C40F' :
          match.typeId === 'purple' ? '#9B59B6' : '#FFFFFF';

        for (const pos of match.positions) {
          this.renderer.addExplosion(pos.col, pos.row, color);
        }
      }
    });

    // Tiles falling - trigger fall animations
    this.battleSystem.on('tilesFalling', ({ fallData }) => {
      this.renderer.startFallAnimations(fallData);
    });

    // Turn start events update currentSide
    this.battleSystem.on('turnStart', ({ side }) => {
      this.currentSide = side;
      this.animating = false; // Reset animating flag when turn starts
      if (side === 'player') {
        this.input.setEnabled(true);
        this.aiThinking = false;
      } else {
        this.input.setEnabled(false);
        this.aiThinking = true;
      }
    });
  }

  /**
   * Start the game.
   */
  start() {
    this.battleSystem.start();
    this.currentSide = 'player';
    this.input.setEnabled(true);
    this.loop.start();
  }

  /**
   * Update called each frame.
   * @param {number} deltaTime
   */
  update(deltaTime) {
    // Update tile animations
    this.renderer.updateTileAnimations();
    
    // Handle AI turn
    if (this.battleSystem && this.battleSystem.state === BattleState.ENEMY_ACTION && !this.aiActionPending && this.aiThinking) {
      this.aiActionPending = true;
      this.battleSystem.executeEnemyAction(() => {
        this.aiActionPending = false;
      });
    }
  }

  /**
   * Render called each frame.
   */
  render() {
    if (!this.battleSystem) return;

    // Update skill button positions from the player panel
    const skillButtons = [];
    if (this.renderer.playerPanel) {
      this.renderer.playerPanel.forEachSkillButton((btn) => {
        if (btn.skill) {
          skillButtons.push({
            x: btn.x,
            y: btn.y,
            width: btn.width,
            height: btn.height,
            skill: btn.skill,
          });
        }
      });
    }
    this.input.setSkillButtons(skillButtons);

    // Update tooltip position (legacy support)
    const skillBtns = this.input.skillButtons;
    let hoveredBtn = null;

    for (const btn of skillBtns) {
      if (this.input._mouseX >= btn.x && this.input._mouseX <= btn.x + btn.width &&
          this.input._mouseY >= btn.y && this.input._mouseY <= btn.y + btn.height) {
        hoveredBtn = btn;
        break;
      }
    }

    if (hoveredBtn && hoveredBtn.skill && this.currentSide === 'player') {
      this.renderer.setTooltip(hoveredBtn.skill.description, this.input._mouseX, this.input._mouseY);
    } else {
      this.renderer.setTooltip(null, 0, 0);
    }

    // Build game state for rendering
    const gameState = {
      board: this.battleSystem.board,
      player: this.battleSystem.player,
      enemy: this.battleSystem.enemy,
      currentSide: this.currentSide,
      combatLog: this.ui.getLogEntries(),
      hoveredTile: this.input.getHoveredTile(),
      selectedTile: this.input.getSelectedTile(),
      hoveredSkill: this.ui.getHoveredSkill(),
      gameOver: this.gameOver,
      winner: this.winner,
      boardOffsetX: this.renderer.boardX,
      boardOffsetY: this.renderer.boardY,
      isPlayerTurn: this.currentSide === 'player' && !this.animating,
      enemyTargetTile: this.enemyTargetTile,
      animating: this.animating,
    };

    this.renderer.render(gameState);
  }

  /**
   * Handle a tile swap attempt.
   * @param {number} col1
   * @param {number} row1
   * @param {number} col2
   * @param {number} row2
   * @private
   */
  _handleSwap(col1, row1, col2, row2) {
    if (this.currentSide !== 'player' || this.gameOver) return;
    if (this.battleSystem.state !== BattleState.PLAYER_ACTION) return;
    if (this.animating) return;

    this.animating = true;
    this.input.setEnabled(false);

    const success = this.battleSystem.playerSwap(col1, row1, col2, row2);
    if (!success) {
      this.animating = false;
      if (this.currentSide === 'player') {
        this.input.setEnabled(true);
      }
    }
  }

  /**
   * Handle a skill click.
   * @param {Object} skill
   * @private
   */
  _handleSkillClick(skill) {
    if (!skill || !skill.id) return;
    if (this.currentSide !== 'player' || this.gameOver) return;
    if (this.battleSystem.state !== BattleState.PLAYER_ACTION) return;
    if (this.animating) return;

    // Check if player has enough mana
    if (!this.battleSystem.player.canAffordSkill(skill)) {
      this.ui.addLogEntry(`Not enough mana for ${skill.name}.`);
      return;
    }

    this.animating = true;
    this.battleSystem.playerUseSkill(skill.id);
  }
}
