(() => {
  const BASE_WIDTH = 1200;
  const BASE_HEIGHT = 768;
  const GRAVITY = 1400;
  const START_INTERVAL = 1800;
  const MIN_INTERVAL = 800;
  const INTERVAL_STEP = 35;
  const MAX_MISSES = 5;
  const ROBOT_STEP = 180;
  const PARALLAX_RANGE = 24;
  const BEST_KEY = 'catchbot-best-score';
  const START_LIVES = 5;

  let gameInstance = null;

  class PreloadScene extends Phaser.Scene {
    constructor() {
      super('preload');
    }
    preload() {
      // ensure paths work on GitHub Pages and locally
      this.load.setPath('assets');
      this.load.image('background', 'background.png');
      this.load.image('robot', 'robot.png');
      this.load.image('stand', 'stand.png');
      this.load.image('screw', 'screw.png');
      this.load.image('fish', 'fish.png');
      this.load.image('waterBack', 'waterBack.png');
      this.load.image('waterFront', 'waterFront.png');
      this.load.image('uiPause', 'ui-pause.png');
      this.load.image('uiReplay', 'ui-replay.png');
      this.load.image('uiPlay', 'ui-play.png');
      this.load.audio('sfxCollect', 'sfx/collect.wav');
      this.load.audio('sfxFish', 'sfx/ouch.wav');
      this.load.audio('sfxMiss', 'sfx/miss.wav');

      const loadingText = this.add.text(BASE_WIDTH / 2, BASE_HEIGHT / 2, 'Loading game...', {
        fontFamily: 'Roboto, sans-serif',
        fontSize: '22px',
        color: '#CFEFD2'
      }).setOrigin(0.5);
      const errorText = this.add.text(BASE_WIDTH / 2, BASE_HEIGHT / 2 + 36, '', {
        fontFamily: 'Roboto, sans-serif',
        fontSize: '16px',
        color: '#FFBABA',
        align: 'center',
        wordWrap: { width: BASE_WIDTH * 0.8 }
      }).setOrigin(0.5);

      this.load.on('loaderror', (file) => {
        errorText.setText(`Failed to load ${file.key}`);
      });

      this.load.on('complete', () => loadingText.destroy());
    }
    create() {
      this.scene.start('main');
    }
  }

  class MainScene extends Phaser.Scene {
    constructor() {
      super('main');
      this.score = 0;
      this.misses = 0;
      this.spawnInterval = START_INTERVAL;
      this.spawnTimer = null;
      this.items = null;
      this.robot = null;
      this.cartZone = null;
      this.targetX = BASE_WIDTH / 2;
      this.cursors = null;
      this.keys = null;
      this.gameOver = false;
      this.hud = {};
      this.bestScore = 0;
      this.lives = START_LIVES;
      this.ui = {};
    }

    create() {
      this.physics.world.setBounds(0, 0, BASE_WIDTH, BASE_HEIGHT);
      this.physics.world.gravity.y = GRAVITY;

      this.add.image(BASE_WIDTH / 2, BASE_HEIGHT / 2, 'background')
        .setDisplaySize(BASE_WIDTH, BASE_HEIGHT)
        .setOrigin(0.5, 0.5);

      this.stand = this.add.image(BASE_WIDTH / 2, BASE_HEIGHT - 80, 'stand');
      this.stand.setOrigin(0.5, 1);
      const standScale = (BASE_WIDTH * 0.35) / this.stand.width;
      this.stand.setScale(standScale);

      this.waterBack = this.add.tileSprite(BASE_WIDTH / 2, BASE_HEIGHT - 120, BASE_WIDTH, 135, 'waterBack')
        .setOrigin(0.5, 0.5)
        .setAlpha(0.65);
      this.waterFront = this.add.tileSprite(BASE_WIDTH / 2, BASE_HEIGHT - 60, BASE_WIDTH, 100, 'waterFront')
        .setOrigin(0.5, 0.5)
        .setAlpha(0.8);
      this.parallaxOrigin = BASE_WIDTH / 2;

      this.robot = this.physics.add.image(BASE_WIDTH / 2, BASE_HEIGHT - 140, 'robot');
      this.robot.setImmovable(true);
      this.robot.body.allowGravity = false;
      this.robot.setCollideWorldBounds(true);
      const robotScale = (BASE_HEIGHT * 0.6) / this.robot.height;
      this.robot.setScale(robotScale);
      this.robot.body.setSize(this.robot.displayWidth * 0.45, this.robot.displayHeight * 0.2);
      this.robot.body.setOffset(this.robot.displayWidth * 0.275, this.robot.displayHeight * 0.65);

      this.cartZone = this.add.zone(this.robot.x, this.robot.y + this.robot.displayHeight * 0.05,
        this.robot.displayWidth * 0.5, this.robot.displayHeight * 0.25);
      this.physics.world.enable(this.cartZone);
      this.cartZone.body.setAllowGravity(false);
      this.cartZone.body.moves = false;

      this.items = this.physics.add.group({
        allowGravity: true,
        collideWorldBounds: false
      });

      this.physics.add.overlap(this.cartZone, this.items, this.handleCatch, undefined, this);

      this.cursors = this.input.keyboard.createCursorKeys();
      this.keys = this.input.keyboard.addKeys('A,D');

      this.input.on('pointermove', (pointer) => {
        this.targetX = Phaser.Math.Clamp(pointer.worldX, 120, BASE_WIDTH - 120);
      });
      this.input.on('pointerdown', (pointer) => {
        // tap left/right half to nudge robot; drag still positions directly
        const half = this.scale.gameSize.width / 2;
        const step = ROBOT_STEP;
        if (pointer.isDown && pointer.getDuration() < 250) {
          if (pointer.worldX < half) {
            this.targetX = Phaser.Math.Clamp(this.robot.x - step, 120, BASE_WIDTH - 120);
          } else {
            this.targetX = Phaser.Math.Clamp(this.robot.x + step, 120, BASE_WIDTH - 120);
          }
        } else {
          this.targetX = Phaser.Math.Clamp(pointer.worldX, 120, BASE_WIDTH - 120);
        }
      });

      this.createHud();
      this.startSpawning();
    }

    createHud() {
      const textStyle = { fontFamily: 'Roboto, sans-serif', fontSize: '24px', color: '#E8FCE9' };
      this.hud.score = this.add.text(24, 18, 'Score: 0', textStyle).setScrollFactor(0);
      // load best score from local storage to mirror iOS persistence
      const bestStored = Number(localStorage.getItem(BEST_KEY) || 0);
      this.bestScore = Number.isFinite(bestStored) ? bestStored : 0;
      this.hud.best = this.add.text(24, 50, `Best: ${this.bestScore}`, { ...textStyle, fontSize: '20px', color: '#8DE9FF' }).setScrollFactor(0);
      this.hud.miss = this.add.text(24, 50, `Missed: 0/${MAX_MISSES}`, { ...textStyle, fontSize: '20px', color: '#F6D7D7' });
      this.hud.miss.setY(this.hud.best.y + 26);
      this.hud.prompt = this.add.text(BASE_WIDTH / 2, BASE_HEIGHT - 32, 'Tap left/right or drag to steer. Arrows/A/D also work.',
        { ...textStyle, fontSize: '18px', color: '#CFEFD2' }).setOrigin(0.5, 1);
      this.hud.gameOver = this.add.text(BASE_WIDTH / 2, BASE_HEIGHT / 2, '', {
        fontFamily: 'Roboto, sans-serif',
        fontSize: '40px',
        color: '#FFFFFF',
        align: 'center'
      }).setOrigin(0.5).setVisible(false);

      this.ui.pauseBtn = this.add.image(BASE_WIDTH - 72, 48, 'uiPause').setInteractive({ useHandCursor: true });
      this.ui.pauseBtn.setScale(0.7);
      this.ui.pauseBtn.on('pointerdown', () => this.togglePause());

      this.ui.restartBtn = this.add.image(BASE_WIDTH - 72, 116, 'uiReplay').setInteractive({ useHandCursor: true });
      this.ui.restartBtn.setScale(0.7);
      this.ui.restartBtn.on('pointerdown', () => this.scene.restart());
    }

    startSpawning() {
      this.spawnTimer = this.time.addEvent({
        delay: this.spawnInterval,
        loop: true,
        callback: () => {
          this.spawnItem();
          this.speedUp();
        }
      });
    }

    speedUp() {
      if (this.spawnInterval <= MIN_INTERVAL) return;
      this.spawnInterval = Math.max(MIN_INTERVAL, this.spawnInterval - INTERVAL_STEP);
      if (this.spawnTimer) {
        this.spawnTimer.remove(false);
      }
      this.startSpawning();
    }

    spawnItem() {
      if (this.gameOver) return;
      const isFish = Math.random() < this.fishChance();
      const key = isFish ? 'fish' : 'screw';
      const x = Phaser.Math.Between(80, BASE_WIDTH - 80);
      const y = -40;
      const item = this.items.create(x, y, key);
      const baseScale = isFish ? 0.5 : 0.45;
      item.setScale(baseScale);
      item.body.setCircle(Math.max(item.displayWidth, item.displayHeight) * 0.25);
      item.body.setBounce(0.08);
      const horizontalBias = (x - BASE_WIDTH / 2) / (BASE_WIDTH / 2);
      const vx = Phaser.Math.Between(-70, 70) + horizontalBias * 40;
      const vy = Phaser.Math.Between(240, 340);
      item.setVelocity(vx, vy);
      item.setData('type', isFish ? 'fish' : 'screw');
    }

    fishChance() {
      if (this.score < 50) return 0.08;
      if (this.score < 150) return 0.12;
      return 0.16;
    }

    handleCatch(zone, item) {
      const type = item.getData('type');
      if (type === 'fish') {
        this.addScore(-500);
        this.flashText('Fish! -500', '#FFBA5C');
        this.sound.play('sfxFish', { volume: 0.7 });
      } else {
        this.addScore(10);
        this.flashText('+10', '#9CFFC2', item.x, item.y);
        this.sound.play('sfxCollect', { volume: 0.7 });
      }
      item.destroy();
    }

    addScore(value) {
      this.score = Math.max(0, this.score + value);
      this.hud.score.setText(`Score: ${this.score}`);
      if (this.score > this.bestScore) {
        this.bestScore = this.score;
        this.hud.best.setText(`Best: ${this.bestScore}`);
        localStorage.setItem(BEST_KEY, String(this.bestScore));
      }
    }

    registerMiss(item) {
      item.destroy();
      this.misses += 1;
      this.hud.miss.setText(`Missed: ${this.misses}/${MAX_MISSES}`);
      this.sound.play('sfxMiss', { volume: 0.65 });
      if (this.misses >= MAX_MISSES) {
        this.endGame();
      }
    }

    flashText(text, color, x = BASE_WIDTH / 2, y = BASE_HEIGHT / 2) {
      const label = this.add.text(x, y, text, {
        fontFamily: 'Roboto, sans-serif',
        fontSize: '24px',
        color
      }).setOrigin(0.5);
      this.tweens.add({
        targets: label,
        y: y - 40,
        alpha: 0,
        duration: 650,
        ease: 'Cubic.easeOut',
        onComplete: () => label.destroy()
      });
    }

    endGame() {
      this.gameOver = true;
      if (this.spawnTimer) {
        this.spawnTimer.remove(false);
      }
      this.items.children.each((item) => item.destroy());
      this.hud.gameOver.setText(`Game Over\nScore: ${this.score}\nClick to restart`);
      this.hud.gameOver.setVisible(true);
      this.input.once('pointerdown', () => this.scene.restart());
      this.input.keyboard.once('keydown', () => this.scene.restart());
      this.time.timeScale = 1;
    }

    togglePause() {
      if (this.gameOver) return;
      const paused = this.physics.world.isPaused;
      this.physics.world.isPaused = !paused;
      this.time.timeScale = paused ? 1 : 0;
      this.hud.pauseBtn.setText(paused ? '[ Pause ]' : '[ Resume ]');
    }

    update() {
      if (this.gameOver) return;

      let keyboardDelta = 0;
      if (this.cursors.left.isDown || this.keys.A.isDown) keyboardDelta -= 1;
      if (this.cursors.right.isDown || this.keys.D.isDown) keyboardDelta += 1;
      if (keyboardDelta !== 0) {
        this.targetX = Phaser.Math.Clamp(this.robot.x + keyboardDelta * 18, 120, BASE_WIDTH - 120);
      }

      this.robot.x = Phaser.Math.Linear(this.robot.x, this.targetX, 0.15);
      this.cartZone.x = this.robot.x;
      this.cartZone.y = this.robot.y + this.robot.displayHeight * 0.05;

      this.items.children.each((item) => {
        if (item.y > BASE_HEIGHT + 80) {
          this.registerMiss(item);
        }
      });

      // simple parallax based on robot offset from center
      const bias = Phaser.Math.Clamp((this.robot.x - this.parallaxOrigin) / (BASE_WIDTH / 2), -1, 1);
      const shift = bias * PARALLAX_RANGE;
      if (this.waterBack && this.waterFront) {
        this.waterBack.tilePositionX = shift * 0.4;
        this.waterFront.tilePositionX = shift;
      }
    }
  }

  const startGame = (onReady, onError) => {
    if (gameInstance) {
      if (onReady) onReady();
      return;
    }
    try {
      gameInstance = new Phaser.Game({
        type: Phaser.WEBGL, // explicit render type to avoid custom env error
        canvas: document.getElementById('game-canvas'),
        parent: document.getElementById('game-shell'),
        width: BASE_WIDTH,
        height: BASE_HEIGHT,
        backgroundColor: '#0B1C0A',
        resolution: window.devicePixelRatio || 1,
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          width: BASE_WIDTH,
          height: BASE_HEIGHT
        },
        render: {
          antialias: true,
          pixelArt: false,
          powerPreference: 'high-performance'
        },
        physics: {
          default: 'arcade',
          arcade: {
            gravity: { y: GRAVITY },
            debug: false
          }
        },
        scene: [PreloadScene, MainScene]
      });
      if (onReady) onReady();
    } catch (err) {
      console.error('Failed to start game', err);
      if (onError) onError(err.message || 'Failed to start game');
    }
  };

  window.startCatchbot = startGame;
})();
