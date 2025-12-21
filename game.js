// Pixi.js implementation approximating SpriteKit scene (1200x768). Contains
// conveyors, water, stand, robot, and SpawnScrewIntellect-inspired difficulty.
// Next steps: fish trajectories, magic screws, HUD from atlases, robot parts/animations.

(() => {
  const BASE_WIDTH = 1200;
  const BASE_HEIGHT = 768;
  const GRAVITY = 2100;
  const SPAWN_POINTS = [
    { x: 62, y: 530, dir: 1 },
    { x: 92, y: 344, dir: 1 },
    { x: BASE_WIDTH - 62, y: 530, dir: -1 },
    { x: BASE_WIDTH - 92, y: 344, dir: -1 },
  ];
  const LAUNCH = { dx: 240, dy: 260 };
  const MAX_MISSES = 5;
  const BEST_KEY = 'catchbot-best-score';

  const assets = [
    { name: 'background', url: 'assets/background.png' },
    { name: 'stand', url: 'assets/stand.png' },
    { name: 'robot', url: 'assets/robot.png' },
    { name: 'waterBack', url: 'assets/waterBack.png' },
    { name: 'waterFront', url: 'assets/waterFront.png' },
    { name: 'screw', url: 'assets/screw.png' },
    { name: 'fish', url: 'assets/fish.png' },
    { name: 'caterpillar', url: 'assets/caterpillar_track.png' },
    { name: 'uiPause', url: 'assets/ui-pause.png' },
    { name: 'uiReplay', url: 'assets/ui-replay.png' },
    { name: 'uiPlay', url: 'assets/ui-play.png' },
  ];

  const sounds = {
    collect: 'assets/sfx/collect.wav',
    miss: 'assets/sfx/miss.wav',
    fish: 'assets/sfx/ouch.wav',
  };

  // Simplified SpawnScrewIntellect
  const intellect = {
    minInterval: 250,
    maxInterval: 2500,
    waveRelaxationBoost: 120,
    fishRelaxationBoost: 200,
    relaxationHeadroom: 200,
    minimumRelaxationCap: 900,
    relaxationTighteningScore: 120,
    relaxationEntryEpsilon: 20,
    waveScoreStep: 25,
    nextRelaxationScore: 25,
    bestDifficultyInterval: 2000,
    pendingRelaxations: 0,
    reset(spawnInterval) {
      this.nextRelaxationScore = this.waveScoreStep;
      this.pendingRelaxations = 0;
      this.bestDifficultyInterval = spawnInterval;
    },
    trigger(state) {
      let { spawnInterval, score } = state;
      if (spawnInterval > 500) {
        spawnInterval = Math.max(this.minInterval, spawnInterval - 0.96);
      } else {
        spawnInterval = Math.max(this.minInterval, spawnInterval - 0.08);
      }
      ({ spawnInterval, score } = this.maybeRelax(spawnInterval, score));
      this.bestDifficultyInterval = Math.min(this.bestDifficultyInterval, spawnInterval);
      state.spawnInterval = spawnInterval;
    },
    maybeRelax(spawnInterval, score) {
      if (score < this.nextRelaxationScore) return { spawnInterval, score };
      if (spawnInterval > this.bestDifficultyInterval + this.relaxationEntryEpsilon) return { spawnInterval, score };
      const eased = spawnInterval + this.waveRelaxationBoost;
      const capped = Math.min(this.relaxationCeiling(), eased);
      spawnInterval = Math.max(spawnInterval, capped);
      this.nextRelaxationScore += this.waveScoreStep;
      this.pendingRelaxations += 1;
      return { spawnInterval, score };
    },
    consumeRelaxation() {
      if (this.pendingRelaxations > 0) {
        this.pendingRelaxations -= 1;
        return true;
      }
      return false;
    },
    applyFishRelaxation(state) {
      if (state.spawnInterval > this.bestDifficultyInterval + this.relaxationEntryEpsilon) return;
      const boosted = state.spawnInterval + this.fishRelaxationBoost;
      const capped = Math.min(this.relaxationCeiling(), boosted);
      state.spawnInterval = Math.max(state.spawnInterval, capped);
    },
    relaxationCeiling() {
      const scoreFactor = Math.min(1, gameState.score / this.relaxationTighteningScore);
      const scoreCap = this.maxInterval - (this.maxInterval - this.minimumRelaxationCap) * scoreFactor;
      const progressCap = Math.max(this.minInterval, this.bestDifficultyInterval + this.relaxationHeadroom);
      return Math.min(scoreCap, progressCap);
    },
  };

  let app;
  let rootContainer;
  let gameContainer;
  let hudContainer;
  let robot;
  let stand;
  let waterBack;
  let waterFront;
  let items = [];
  let statusEl;

  const gameState = {
    score: 0,
    best: 0,
    misses: 0,
    spawnInterval: 2000,
    lastSpawnTime: 0,
    playing: false,
    targetX: BASE_WIDTH / 2,
  };

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  async function loadPixi() {
    if (window.PIXI) return;
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/pixi.js@8.1.5/dist/pixi.min.js';
    document.head.appendChild(script);
    await new Promise((res, rej) => {
      script.onload = res;
      script.onerror = rej;
    });
  }

  function initApp() {
    app = new PIXI.Application({
      width: BASE_WIDTH,
      height: BASE_HEIGHT,
      backgroundColor: 0x0b1c0a,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    const canvas = document.getElementById('game-canvas');
    canvas.replaceWith(app.view);
    app.view.id = 'game-canvas';
    app.view.className = 'game-canvas';

    rootContainer = new PIXI.Container();
    app.stage.addChild(rootContainer);
    gameContainer = new PIXI.Container();
    hudContainer = new PIXI.Container();
    rootContainer.addChild(gameContainer);
    rootContainer.addChild(hudContainer);

    window.addEventListener('resize', handleResize);
    handleResize();
  }

  function handleResize() {
    if (!app) return;
    const shell = document.getElementById('game-shell');
    const rect = shell.getBoundingClientRect();
    const scale = Math.min(rect.width / BASE_WIDTH, rect.height / BASE_HEIGHT);
    app.renderer.resolution = window.devicePixelRatio || 1;
    app.renderer.resize(BASE_WIDTH * scale, BASE_HEIGHT * scale);
    rootContainer.scale.set(scale);
    rootContainer.position.set((rect.width - BASE_WIDTH * scale) / 2, (rect.height - BASE_HEIGHT * scale) / 2);
  }

  async function loadAssets() {
    const manifest = assets.reduce((acc, a) => ({ ...acc, [a.name]: a.url }), {});
    await PIXI.Assets.init({ manifest: { bundles: [{ name: 'main', assets: manifest }] } });
    await PIXI.Assets.loadBundle('main');
    gameState.best = Number(localStorage.getItem(BEST_KEY) || 0);
  }

  function createSprite(name, opts = {}) {
    const sprite = PIXI.Sprite.from(name);
    if (opts.anchor) sprite.anchor.set(opts.anchor.x, opts.anchor.y);
    if (opts.scale) sprite.scale.set(opts.scale);
    if (opts.position) sprite.position.set(opts.position.x, opts.position.y);
    if (opts.alpha !== undefined) sprite.alpha = opts.alpha;
    return sprite;
  }

  function buildScene() {
    gameContainer.removeChildren();
    hudContainer.removeChildren();
    items = [];
    gameState.score = 0;
    gameState.misses = 0;
    gameState.spawnInterval = 2000;
    gameState.lastSpawnTime = performance.now();
    gameState.targetX = BASE_WIDTH / 2;
    intellect.reset(gameState.spawnInterval);

    const bg = createSprite('background', { anchor: { x: 0.5, y: 0.5 }, position: { x: BASE_WIDTH / 2, y: BASE_HEIGHT / 2 } });
    bg.width = BASE_WIDTH;
    bg.height = BASE_HEIGHT;
    gameContainer.addChild(bg);

    waterBack = createSprite('waterBack', { anchor: { x: 0.5, y: 0.5 }, position: { x: BASE_WIDTH / 2, y: BASE_HEIGHT - 120 }, alpha: 0.65 });
    waterBack.width = BASE_WIDTH;
    waterFront = createSprite('waterFront', { anchor: { x: 0.5, y: 0.5 }, position: { x: BASE_WIDTH / 2, y: BASE_HEIGHT - 60 }, alpha: 0.8 });
    waterFront.width = BASE_WIDTH;
    gameContainer.addChild(waterBack, waterFront);

    stand = createSprite('stand', { anchor: { x: 0.5, y: 1 }, position: { x: BASE_WIDTH / 2, y: BASE_HEIGHT - 60 } });
    const standScale = (BASE_WIDTH * 0.42) / stand.width;
    stand.scale.set(standScale);
    gameContainer.addChild(stand);

    // conveyors
    SPAWN_POINTS.forEach((pos) => {
      const c = createSprite('caterpillar', { anchor: { x: 0.5, y: 0.5 }, position: { x: pos.x, y: pos.y } });
      const scale = 1.15;
      c.scale.set(scale * (pos.dir > 0 ? 1 : -1), scale);
      c.alpha = 0.9;
      gameContainer.addChild(c);
    });

    robot = createSprite('robot', { anchor: { x: 0.5, y: 0.5 }, position: { x: BASE_WIDTH / 2, y: BASE_HEIGHT - 180 } });
    const robotScale = (BASE_HEIGHT * 0.5) / robot.height;
    robot.scale.set(robotScale);
    robot.zIndex = 10;
    gameContainer.addChild(robot);

    const textStyle = new PIXI.TextStyle({ fontFamily: 'Roboto, Arial', fontSize: 28, fill: '#E8FCE9' });
    const bestStyle = new PIXI.TextStyle({ fontFamily: 'Roboto, Arial', fontSize: 22, fill: '#8DE9FF' });
    const missStyle = new PIXI.TextStyle({ fontFamily: 'Roboto, Arial', fontSize: 22, fill: '#F6D7D7' });
    const promptStyle = new PIXI.TextStyle({ fontFamily: 'Roboto, Arial', fontSize: 18, fill: '#CFEFD2' });

    const scoreLabel = new PIXI.Text(`Score: ${gameState.score}`, textStyle);
    scoreLabel.position.set(24, 18);
    const bestLabel = new PIXI.Text(`Best: ${gameState.best}`, bestStyle);
    bestLabel.position.set(24, 50);
    const missLabel = new PIXI.Text(`Missed: ${gameState.misses}/${MAX_MISSES}`, missStyle);
    missLabel.position.set(24, 76);
    const prompt = new PIXI.Text('Tap left/right or drag to steer. Arrows/A/D also work.', promptStyle);
    prompt.anchor.set(0.5, 1);
    prompt.position.set(BASE_WIDTH / 2, BASE_HEIGHT - 12);

    hudContainer.addChild(scoreLabel, bestLabel, missLabel, prompt);

    const pauseBtn = createSprite('uiPause', { anchor: { x: 0.5, y: 0.5 }, position: { x: BASE_WIDTH - 72, y: 48 } });
    pauseBtn.scale.set(0.7);
    pauseBtn.eventMode = 'static';
    pauseBtn.cursor = 'pointer';
    pauseBtn.on('pointerdown', togglePause);
    const restartBtn = createSprite('uiReplay', { anchor: { x: 0.5, y: 0.5 }, position: { x: BASE_WIDTH - 72, y: 118 } });
    restartBtn.scale.set(0.7);
    restartBtn.eventMode = 'static';
    restartBtn.cursor = 'pointer';
    restartBtn.on('pointerdown', restartGame);
    hudContainer.addChild(pauseBtn, restartBtn);

    hudContainer.sortableChildren = true;
    hudContainer.zIndex = 100;

    app.stage.eventMode = 'static';
    app.stage.hitArea = new PIXI.Rectangle(0, 0, BASE_WIDTH, BASE_HEIGHT);
    app.stage.on('pointermove', (e) => {
      const p = e.global;
      gameState.targetX = clamp(p.x, 140, BASE_WIDTH - 140);
    });
    app.stage.on('pointerdown', (e) => {
      const p = e.global;
      const half = BASE_WIDTH / 2;
      const step = 180;
      if (e.nativeEvent && e.nativeEvent.detail === 1) {
        gameState.targetX = clamp(robot.x + (p.x < half ? -step : step), 140, BASE_WIDTH - 140);
      }
    });

    app.ticker.add(update);

    hudContainer.scoreLabel = scoreLabel;
    hudContainer.bestLabel = bestLabel;
    hudContainer.missLabel = missLabel;
  }

  function togglePause() {
    if (!gameState.playing) return;
    app.ticker.started ? app.ticker.stop() : app.ticker.start();
  }

  function restartGame() {
    clearInterval(spawnTimer);
    buildScene();
    startSpawning();
    gameState.playing = true;
  }

  function startSpawning() {
    clearInterval(spawnTimer);
    spawnTimer = setInterval(spawnItem, gameState.spawnInterval);
  }

  function spawnItem() {
    if (!gameState.playing) return;
    const isFish = Math.random() < 0.12;
    const key = isFish ? 'fish' : 'screw';
    const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    const sprite = createSprite(key, { anchor: { x: 0.5, y: 0.5 }, position: { x: spawn.x, y: spawn.y }, scale: isFish ? 0.5 : 0.45 });
    sprite.vx = spawn.dir * (LAUNCH.dx + (Math.random() * 80 - 40));
    sprite.vy = -(LAUNCH.dy + (Math.random() * 80 - 40));
    sprite.type = key;
    items.push(sprite);
    gameContainer.addChild(sprite);
  }

  function playSound(key, volume = 0.7) {
    const url = sounds[key];
    if (!url) return;
    const audio = new Audio(url);
    audio.volume = volume;
    audio.play().catch(() => {});
  }

  function handleCatch(item) {
    if (item.type === 'fish') {
      gameState.score = Math.max(0, gameState.score - 500);
      playSound('fish', 0.7);
    } else {
      gameState.score += 10;
      playSound('collect', 0.7);
    }
    hudContainer.scoreLabel.text = `Score: ${gameState.score}`;
    if (gameState.score > gameState.best) {
      gameState.best = gameState.score;
      localStorage.setItem(BEST_KEY, String(gameState.best));
      hudContainer.bestLabel.text = `Best: ${gameState.best}`;
    }
    item.parent.removeChild(item);
  }

  function handleMiss(item) {
    item.parent.removeChild(item);
    gameState.misses += 1;
    hudContainer.missLabel.text = `Missed: ${gameState.misses}/${MAX_MISSES}`;
    playSound('miss', 0.65);
    if (gameState.misses >= MAX_MISSES) {
      endGame();
    }
  }

  function endGame() {
    gameState.playing = false;
    clearInterval(spawnTimer);
    items.forEach((i) => i.parent && i.parent.removeChild(i));
    items = [];
  }

  function update(delta) {
    if (!gameState.playing) return;
    const dt = delta / 60;
    const now = performance.now();

    robot.x += (gameState.targetX - robot.x) * 0.18;
    robot.x = clamp(robot.x, 140, BASE_WIDTH - 140);

    const bias = clamp((robot.x - BASE_WIDTH / 2) / (BASE_WIDTH / 2), -1, 1);
    if (waterBack) waterBack.x = BASE_WIDTH / 2 + bias * 12;
    if (waterFront) waterFront.x = BASE_WIDTH / 2 + bias * 24;

    const g = GRAVITY * dt;
    items.forEach((item) => {
      item.vy += g * dt;
      item.x += item.vx * dt;
      item.y += item.vy * dt;

      const cartTop = stand.y - stand.height * stand.scale.y * 0.12;
      const cartWidth = stand.width * stand.scale.x * 0.4;
      const withinCart = Math.abs(item.x - robot.x) < cartWidth && Math.abs(item.y - cartTop) < 80;

      if (withinCart && item.vy > 0) {
        handleCatch(item);
      } else if (item.y > BASE_HEIGHT + 120) {
        handleMiss(item);
      }
    });
    items = items.filter((i) => i.parent);

    intellect.trigger(gameState);
    if (intellect.consumeRelaxation()) {
      // hook for fish scheduling if needed
    }

    if (now - gameState.lastSpawnTime > gameState.spawnInterval) {
      spawnItem();
      gameState.lastSpawnTime = now;
      clearInterval(spawnTimer);
      spawnTimer = setInterval(spawnItem, gameState.spawnInterval);
    }
  }

  async function startCatchbot(onReady, onError) {
    try {
      if (!window.PIXI) await loadPixi();
      await loadAssets();
      initApp();
      buildScene();
      startSpawning();
      gameState.playing = true;
      if (statusEl) statusEl.style.display = 'none';
      if (onReady) onReady();
    } catch (err) {
      console.error(err);
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.textContent = err?.message || 'Failed to start game';
      }
      if (onError) onError(err?.message);
    }
  }

  window.startCatchbot = startCatchbot;
})();
