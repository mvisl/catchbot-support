// Pixi.js implementation approximating SpriteKit scene (1200x768). Contains
// conveyors, water, stand, robot, and SpawnScrewIntellect-inspired difficulty.
// Includes fish arcs/unlock, magic screws with recovery, HUD, and sound effects.

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
  const FISH_UNLOCK_SCORE = 300; // score uses +10 per catch, matches ~30 catches
  const FISH_INTERVAL_MIN = 7000;
  const FISH_INTERVAL_RANGE = 5000;
  const FISH_HIT_RADIUS = 120;
  const FISH_UP_DURATION = 1.1;
  const FISH_DOWN_DURATION = 1.05;
  const MAGIC_COUNTDOWN = 30;
  const MAGIC_CHANCE = 0.08;

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
  let activeFish = null;
  let nextFishAt = 0;
  let fishWindowClosed = false;
  let tickerAttached = false;

  const gameState = {
    score: 0,
    best: 0,
    misses: 0,
    spawnInterval: 2000,
    lastSpawnTime: 0,
    playing: false,
    targetX: BASE_WIDTH / 2,
    fishUnlocked: false,
    magicCountdown: 0,
    forceMagic: false,
  };

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const randRange = (min, max) => Math.random() * (max - min) + min;

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

  async function initApp() {
    app = new PIXI.Application();
    await app.init({
      width: BASE_WIDTH,
      height: BASE_HEIGHT,
      background: 0x0b1c0a,
      resolution: window.devicePixelRatio || 1,
      antialias: true,
      powerPreference: 'high-performance',
    });

    const canvas = document.getElementById('game-canvas');
    canvas.replaceWith(app.canvas);
    app.canvas.id = 'game-canvas';
    app.canvas.className = 'game-canvas';

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
    activeFish = null;
    fishWindowClosed = false;
    nextFishAt = performance.now() + randRange(FISH_INTERVAL_MIN, FISH_INTERVAL_MIN + FISH_INTERVAL_RANGE);
    gameState.score = 0;
    gameState.misses = 0;
    gameState.spawnInterval = 2000;
    gameState.lastSpawnTime = performance.now();
    gameState.targetX = BASE_WIDTH / 2;
    gameState.magicCountdown = 0;
    gameState.forceMagic = false;
    gameState.fishUnlocked = false;
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

    app.stage.removeAllListeners();
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

    if (!tickerAttached) {
      app.ticker.add(update);
      tickerAttached = true;
    }

    hudContainer.scoreLabel = scoreLabel;
    hudContainer.bestLabel = bestLabel;
    hudContainer.missLabel = missLabel;
  }

  function togglePause() {
    if (!gameState.playing) return;
    app.ticker.started ? app.ticker.stop() : app.ticker.start();
  }

  function restartGame() {
    buildScene();
    gameState.playing = true;
  }

  function startSpawning() {
    gameState.lastSpawnTime = performance.now();
  }

  function spawnItem() {
    if (!gameState.playing) return;
    const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    const type = nextSpawnType();
    const sprite = createSprite('screw', { anchor: { x: 0.5, y: 0.5 }, position: { x: spawn.x, y: spawn.y }, scale: type === 'magic' ? 0.5 : 0.45 });
    sprite.vx = spawn.dir * (LAUNCH.dx + (Math.random() * 80 - 40));
    sprite.vy = -(LAUNCH.dy + (Math.random() * 80 - 40));
    sprite.type = type;
    if (type === 'magic') {
      sprite.tint = 0x6de7ff;
      sprite.alpha = 0.92;
    }
    items.push(sprite);
    gameContainer.addChild(sprite);
  }

  function nextSpawnType() {
    if (gameState.forceMagic && gameState.misses > 0) {
      gameState.forceMagic = false;
      gameState.magicCountdown = MAGIC_COUNTDOWN;
      return 'magic';
    }
    if (gameState.misses > 0 && Math.random() < MAGIC_CHANCE) {
      return 'magic';
    }
    return 'screw';
  }

  function playSound(key, volume = 0.7) {
    const url = sounds[key];
    if (!url) return;
    const audio = new Audio(url);
    audio.volume = volume;
    audio.play().catch(() => {});
  }

  function handleCatch(item) {
    if (item.type === 'magic') {
      // recover one miss and reward a small bonus
      gameState.score += 10;
      gameState.misses = Math.max(0, gameState.misses - 1);
      gameState.magicCountdown = MAGIC_COUNTDOWN;
      playSound('collect', 0.9);
      hudContainer.missLabel.text = `Missed: ${gameState.misses}/${MAX_MISSES}`;
    } else {
      gameState.score += 10;
      playSound('collect', 0.7);
      if (gameState.misses > 0) {
        gameState.magicCountdown = Math.max(0, gameState.magicCountdown - 1);
        if (gameState.magicCountdown === 0) {
          gameState.forceMagic = true;
        }
      }
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
    requestMagicGuarantee();
    if (gameState.misses >= MAX_MISSES) {
      endGame();
    }
  }

  function endGame() {
    gameState.playing = false;
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

    // fish unlock once score reached
    if (!gameState.fishUnlocked && gameState.score >= FISH_UNLOCK_SCORE) {
      gameState.fishUnlocked = true;
      nextFishAt = now + randRange(FISH_INTERVAL_MIN * 0.5, FISH_INTERVAL_MIN + FISH_INTERVAL_RANGE);
    }
    maybeSpawnFish(now);

    if (now - gameState.lastSpawnTime > gameState.spawnInterval) {
      spawnItem();
      gameState.lastSpawnTime = now;
      intellect.trigger(gameState);
    }

    updateFish(dt);
  }

  async function startCatchbot(onReady, onError) {
    try {
      statusEl = document.getElementById('game-status');
      if (!window.PIXI) await loadPixi();
      await loadAssets();
      await initApp();
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

  function requestMagicGuarantee() {
    if (gameState.misses > 0) {
      gameState.magicCountdown = MAGIC_COUNTDOWN;
      gameState.forceMagic = false;
    } else {
      gameState.magicCountdown = 0;
    }
  }

  function maybeSpawnFish(now) {
    if (!gameState.fishUnlocked) return;
    if (activeFish) return;
    if (now < nextFishAt) return;
    spawnFish(now);
  }

  function spawnFish(now) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const start = { x: side === -1 ? 82 : BASE_WIDTH - 82, y: BASE_HEIGHT - 90 };
    const clampLeft = BASE_WIDTH * 0.22;
    const clampRight = BASE_WIDTH * 0.78;
    const targetX = clamp(side === -1 ? Math.min(robot.x, BASE_WIDTH * 0.48) : Math.max(robot.x, BASE_WIDTH * 0.52), clampLeft, clampRight);
    const targetY = stand.y - stand.height * stand.scale.y * 0.35;
    const target = { x: targetX, y: targetY };
    const splash = { x: start.x + (side === -1 ? 96 : -96), y: BASE_HEIGHT - 24 };
    const controlUp = { x: start.x + (targetX - start.x) * 0.6, y: targetY + 220 };
    const controlDown = { x: targetX, y: targetY - 140 };

    const fish = createSprite('fish', { anchor: { x: 0.5, y: 0.5 }, position: start, scale: 0.55 });
    fish.zIndex = 8;
    gameContainer.addChild(fish);

    activeFish = {
      sprite: fish,
      phase: 'up',
      t: 0,
      start,
      target,
      splash,
      controlUp,
      controlDown,
      durationUp: FISH_UP_DURATION,
      durationDown: FISH_DOWN_DURATION,
    };
    fishWindowClosed = false;
    nextFishAt = now + randRange(FISH_INTERVAL_MIN, FISH_INTERVAL_MIN + FISH_INTERVAL_RANGE);
  }

  function quadPoint(p0, p1, p2, t) {
    const inv = 1 - t;
    const x = inv * inv * p0.x + 2 * inv * t * p1.x + t * t * p2.x;
    const y = inv * inv * p0.y + 2 * inv * t * p1.y + t * t * p2.y;
    return { x, y };
  }

  function updateFish(dt) {
    if (!activeFish) return;
    const f = activeFish;
    const duration = f.phase === 'up' ? f.durationUp : f.durationDown;
    f.t += dt / duration;
    let pos;
    if (f.phase === 'up') {
      pos = quadPoint(f.start, f.controlUp, f.target, Math.min(1, f.t));
      f.sprite.position.copyFrom(pos);
      checkFishCatchWindow(pos);
      if (f.t >= 1) {
        f.phase = 'down';
        f.t = 0;
      }
    } else {
      pos = quadPoint(f.target, f.controlDown, f.splash, Math.min(1, f.t));
      f.sprite.position.copyFrom(pos);
      if (f.t >= 1 || pos.y > BASE_HEIGHT + 20) {
        playSound('miss', 0.4);
        disposeFish(false);
      }
    }
  }

  function checkFishCatchWindow(pos) {
    if (!activeFish) return;
    const cartTop = stand.y - stand.height * stand.scale.y * 0.12;
    const cartCenter = { x: robot.x, y: cartTop };
    if (pos.y < cartTop - 36) {
      fishWindowClosed = true;
      return;
    }
    if (fishWindowClosed) return;
    if (pos.y <= cartTop + 10) {
      const dx = pos.x - cartCenter.x;
      const dy = pos.y - cartCenter.y;
      const dist = Math.hypot(dx, dy);
      const withinCart = Math.abs(dx) < stand.width * stand.scale.x * 0.4;
      if (dist <= FISH_HIT_RADIUS && withinCart) {
        disposeFish(true);
      }
    }
  }

  function disposeFish(hitCart) {
    if (!activeFish) return;
    const fish = activeFish.sprite;
    if (hitCart) {
      gameState.score = Math.max(0, gameState.score - 500);
      hudContainer.scoreLabel.text = `Score: ${gameState.score}`;
      gameState.misses += 1;
      hudContainer.missLabel.text = `Missed: ${gameState.misses}/${MAX_MISSES}`;
      requestMagicGuarantee();
      intellect.applyFishRelaxation(gameState);
      playSound('fish', 0.7);
      if (gameState.misses >= MAX_MISSES) {
        endGame();
      }
    } else {
      playSound('miss', 0.35);
    }
    fish.parent && fish.parent.removeChild(fish);
    activeFish = null;
    fishWindowClosed = false;
  }
})();
