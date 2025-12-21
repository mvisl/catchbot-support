// Pixi.js + Matter-like lightweight physics (custom) port of the SpriteKit game.
// Base resolution: 1200x768 (matches GameScene.sks). Uses contain-fit scaling.

// CDN Pixi
(() => {
  const BASE_WIDTH = 1200;
  const BASE_HEIGHT = 768;
  const GRAVITY = 2100; // tuned to feel closer to SpriteKit gravity
  const SPAWN_POINTS = [
    { x: 62, y: 530, dir: 1 },
    { x: 92, y: 344, dir: 1 },
    { x: BASE_WIDTH - 62, y: 530, dir: -1 },
    { x: BASE_WIDTH - 92, y: 344, dir: -1 },
  ];
  const LAUNCH = { dx: 240, dy: 260 };
  const MAX_MISSES = 5;
  const BEST_KEY = 'catchbot-best-score';

  // Simple asset manifest
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

  let app;
  let rootContainer;
  let gameContainer;
  let hudContainer;
  let robot;
  let stand;
  let waterBack;
  let waterFront;
  let items = [];
  let score = 0;
  let best = 0;
  let misses = 0;
  let spawnInterval = 2000; // ms baseline (SpriteKit starts at 2s)
  let spawnTimer;
  let lastSpawnTime = 0;
  let pendingRelaxations = 0;
  let playing = false;
  let targetX = BASE_WIDTH / 2;
  let statusEl;

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
    const loader = new PIXI.Assets();
    const manifest = assets.reduce((acc, a) => ({ ...acc, [a.name]: a.url }), {});
    await PIXI.Assets.init({ manifest: { bundles: [{ name: 'main', assets: manifest }] } });
    await PIXI.Assets.loadBundle('main');
    best = Number(localStorage.getItem(BEST_KEY) || 0);
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
    score = 0;
    misses = 0;
    spawnInterval = 2000;
    lastSpawnTime = performance.now();
    pendingRelaxations = 0;
    intellect.reset();
    targetX = BASE_WIDTH / 2;

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

    // conveyors (static visual reference)
    const caterPositions = [
      { x: SPAWN_POINTS[0].x, y: SPAWN_POINTS[0].y },
      { x: SPAWN_POINTS[1].x, y: SPAWN_POINTS[1].y },
      { x: SPAWN_POINTS[2].x, y: SPAWN_POINTS[2].y },
      { x: SPAWN_POINTS[3].x, y: SPAWN_POINTS[3].y },
    ];
    caterPositions.forEach((pos) => {
      const c = createSprite('caterpillar', { anchor: { x: 0.5, y: 0.5 }, position: { x: pos.x, y: pos.y } });
      const scale = 1.15;
      c.scale.set(scale * (pos.x > BASE_WIDTH / 2 ? -1 : 1), scale);
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

    const scoreLabel = new PIXI.Text(`Score: ${score}`, textStyle);
    scoreLabel.position.set(24, 18);
    const bestLabel = new PIXI.Text(`Best: ${best}`, bestStyle);
    bestLabel.position.set(24, 50);
    const missLabel = new PIXI.Text(`Missed: ${misses}/${MAX_MISSES}`, missStyle);
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

    // Input
    app.stage.eventMode = 'static';
    app.stage.hitArea = new PIXI.Rectangle(0, 0, BASE_WIDTH, BASE_HEIGHT);
    app.stage.on('pointermove', (e) => {
      const p = e.global;
      targetX = clamp(p.x, 140, BASE_WIDTH - 140);
    });
    app.stage.on('pointerdown', (e) => {
      const p = e.global;
      const half = BASE_WIDTH / 2;
      const step = 180;
      if (e.nativeEvent && e.nativeEvent.detail === 1) {
        targetX = clamp(robot.x + (p.x < half ? -step : step), 140, BASE_WIDTH - 140);
      }
    });

    // Game loop
    app.ticker.add(update);

    // HUD refs
    hudContainer.scoreLabel = scoreLabel;
    hudContainer.bestLabel = bestLabel;
    hudContainer.missLabel = missLabel;
  }

  function togglePause() {
    if (!playing) return;
    app.ticker.started ? app.ticker.stop() : app.ticker.start();
  }

  function restartGame() {
    clearInterval(spawnTimer);
    buildScene();
    startSpawning();
    playing = true;
  }

  function startSpawning() {
    clearInterval(spawnTimer);
    spawnTimer = setInterval(spawnItem, spawnInterval);
  }

  function spawnItem() {
    if (!playing) return;
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

  function update(delta) {
    if (!playing) return;
    const dt = delta / 60; // normalized
    const now = performance.now();

    // Move robot toward target
    robot.x += (targetX - robot.x) * 0.18;
    robot.x = clamp(robot.x, 140, BASE_WIDTH - 140);

    // Parallax water
    const bias = clamp((robot.x - BASE_WIDTH / 2) / (BASE_WIDTH / 2), -1, 1);
    if (waterBack) waterBack.x = BASE_WIDTH / 2 + bias * 12;
    if (waterFront) waterFront.x = BASE_WIDTH / 2 + bias * 24;

    // Physics for items
    const g = GRAVITY * dt;
    items.forEach((item) => {
      item.vy += g * dt;
      item.x += item.vx * dt;
      item.y += item.vy * dt;

      // Simple collision with stand (cart)
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

    // Intellect: difficulty ramp + relax
    intellect.trigger();
    if (intellect.consumeRelaxation()) {
      // optional: use to schedule fish; currently just consumed
    }

    // Reschedule spawns if interval shrank
    if (now - lastSpawnTime > spawnInterval) {
      spawnItem();
      lastSpawnTime = now;
      clearInterval(spawnTimer);
      spawnTimer = setInterval(spawnItem, spawnInterval);
    }
  }

  function handleCatch(item) {
    if (item.type === 'fish') {
      score = Math.max(0, score - 500);
      playSound('fish', 0.7);
    } else {
      score += 10;
      playSound('collect', 0.7);
    }
    hudContainer.scoreLabel.text = `Score: ${score}`;
    if (score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
      hudContainer.bestLabel.text = `Best: ${best}`;
    }
    item.parent.removeChild(item);
  }

  function handleMiss(item) {
    item.parent.removeChild(item);
    misses += 1;
    hudContainer.missLabel.text = `Missed: ${misses}/${MAX_MISSES}`;
    playSound('miss', 0.65);
    if (misses >= MAX_MISSES) {
      endGame();
    }
  }

  function endGame() {
    playing = false;
    clearInterval(spawnTimer);
    items.forEach((i) => i.parent && i.parent.removeChild(i));
    items = [];
  }

  async function startCatchbot(onReady, onError) {
    try {
      if (!window.PIXI) await loadPixi();
      await loadAssets();
      initApp();
      buildScene();
      startSpawning();
      playing = true;
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
