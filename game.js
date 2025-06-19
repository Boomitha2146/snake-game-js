(() => {
  'use strict';

  // Constants
  const GRID_SIZE = 20;      // number of cells horizontally
  const GRID_ROWS = 16;      // number of cells vertically
  const CELL_SIZE = 30;      // pixels per cell (canvas size = GRID_SIZE*CELL_SIZE, GRID_ROWS*CELL_SIZE)

  // Setup canvas
  const canvas = document.getElementById('game-canvas');
  canvas.width = GRID_SIZE * CELL_SIZE;
  canvas.height = GRID_ROWS * CELL_SIZE;
  const ctx = canvas.getContext('2d');

  // Game Data Structure
  const gameData = {
    gameState: {
      level: 1,
      score: 0,
      lives: 3,
      health: 100,       // percent
      combo: 0,
      powerUps: [],
      isPaused: false,
      isGameOver: false,
      difficulty: 1
    },
    player: {
      x: 10,
      y: 8,
      velocity: 5,      // cells per second
      direction: 'right', 
      nextDirection: 'right',
      nextDirectionQueue: [],
      tail: [],
      abilities: {},
      inventory: [],
      stats: {
        length: 5,
        maxLength: 100,
        speed: 5,
      }
    },
    enemies: [],       // will keep AI snakes or obstacles for future levels
    collectibles: [],  // food or powerups
    highScores: JSON.parse(localStorage.getItem('snakeHighScores')||'[]'),
    achievements: [
      {
        id: 'score_100',
        name: 'Score 100 Points',
        description: 'Reach 100 points.',
        icon: 'star',
        unlocked: false,
        progress: 0,
        reward: 50
      },
      {
        id: 'level_5',
        name: 'Reach Level 5',
        description: 'Advance to level 5.',
        icon: 'rocket_launch',
        unlocked: false,
        progress: 0,
        reward: 100
      },
      {
        id: 'eat_50_food',
        name: 'Eat 50 Food',
        description: 'Consuming 50 food items.',
        icon: 'restaurant',
        unlocked: false,
        progress: 0,
        reward: 80
      }
    ],
    settings: {
      soundVolume: 0.5,
      musicVolume: 0.5,
      graphics: 'high', // can be 'low', 'medium', 'high'
      controls: 'keyboard',
      fullscreen: false
    }
  };

  // State variables
  let lastFrameTime = 0;
  let accumulator = 0;
  let frameDuration = 1000 / 60; // target 60 fps baseline update step for logic
  let elapsedGameTime = 0; // milliseconds game time (played)

  // UI references
  const scoreValueEl = document.getElementById('score-value');
  const levelValueEl = document.getElementById('level-value');
  const livesValueEl = document.getElementById('lives-value');
  const timerEl = document.getElementById('timer');
  const powerUpsListEl = document.getElementById('power-ups-list');
  const achievementsListEl = document.getElementById('achievements-list');
  const actionButtons = document.getElementById('action-buttons');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayBody = document.getElementById('overlay-body');
  const overlayPrimaryBtn = document.getElementById('overlay-primary-btn');
  const statusMessageEl = document.getElementById('status-message');

  // Sound placeholders
  const sounds = {
    collision: new Audio('https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg'),
    eat: new Audio('https://actions.google.com/sounds/v1/cartoon/clang.ogg'),
    powerup: new Audio('https://actions.google.com/sounds/v1/cartoon/woodpecker_peck.ogg'),
    death: new Audio('https://actions.google.com/sounds/v1/cartoon/boing.ogg'),
    levelup: new Audio('https://actions.google.com/sounds/v1/cartoon/metal_falling.ogg'),
    achievement: new Audio('https://actions.google.com/sounds/v1/cartoon/concussive_hit_guitar_boing.ogg'),
    background: new Audio('https://cdn.pixabay.com/download/audio/2023/05/02/audio_2bd0d54836.mp3?filename=space-ambient-116346.mp3')
  };
  sounds.background.loop = true;
  sounds.background.volume = gameData.settings.musicVolume;

  // Particle system
  const particleSystem = (() => {
    const particles = [];
    function create(x, y, color='#38bdf8') {
      for(let i=0; i<12; i++) {
        particles.push({
          x, y,
          vx: (Math.random()-0.5)*3,
          vy: (Math.random()-0.5)*3,
          life: 20 + Math.random()*20,
          color,
          radius: 2 + Math.random()*2
        });
      }
    }
    function update() {
      for(let i=particles.length-1; i>=0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        if(p.life <= 0) {
          particles.splice(i, 1);
        }
      }
    }
    function draw(ctx) {
      ctx.save();
      particles.forEach(p => {
        ctx.beginPath();
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(p.life / 40, 0);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI*2);
        ctx.fill();
      });
      ctx.restore();
    }
    return { create, update, draw };
  })();

  // Screen shake state
  let screenShakeIntensity = 0;
  function applyScreenShake(ctx) {
    if(screenShakeIntensity > 0) {
      const dx = (Math.random()-0.5) * screenShakeIntensity;
      const dy = (Math.random()-0.5) * screenShakeIntensity;
      ctx.translate(dx, dy);
      screenShakeIntensity *= 0.85;
      if(screenShakeIntensity < 0.1) screenShakeIntensity = 0;
    }
  }
  function triggerScreenShake(intensity=8) {
    screenShakeIntensity = Math.min(screenShakeIntensity + intensity, 15);
  }

  // Game utilities
  function randomGridPosition() {
    return {
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_ROWS)
    };
  }

  function checkCollision(a, b) {
    return a.x === b.x && a.y === b.y;
  }

  function triggerCollisionEffects(x, y) {
    sounds.collision.currentTime = 0;
    sounds.collision.volume = gameData.settings.soundVolume;
    sounds.collision.play().catch(() => {});
    particleSystem.create(x*CELL_SIZE + CELL_SIZE/2, y*CELL_SIZE + CELL_SIZE/2, '#38bdf8');
    triggerScreenShake(10);
  }

  function spawnFood() {
    let pos;
    do {
      pos = randomGridPosition();
    } while (
      gameData.player.tail.some(t => t.x === pos.x && t.y === pos.y) ||
      gameData.collectibles.some(c => c.x === pos.x && c.y === pos.y)
    );
    gameData.collectibles.push({
      id: 'food_' + Date.now(),
      type: 'food',
      x: pos.x,
      y: pos.y,
      value: 10,
      effects: {},
      animation: 0
    });
  }

  function spawnPowerUp() {
    const types = ['speed', 'shield', 'doublePoints'];
    let type = types[Math.floor(Math.random()*types.length)];
    let pos;
    do {
      pos = randomGridPosition();
    } while (
      gameData.player.tail.some(t => t.x === pos.x && t.y === pos.y) ||
      gameData.collectibles.some(c => c.x === pos.x && c.y === pos.y)
    );
    gameData.collectibles.push({
      id: 'powerup_' + Date.now(),
      type: 'powerup',
      powerUpType: type,
      x: pos.x,
      y: pos.y,
      value: 0,
      effects: { type },
      animation: 0
    });
  }

  function initCollectibles() {
    gameData.collectibles = [];
    for(let i=0; i<3; i++) spawnFood();
    if(gameData.gameState.level >= 2) {
      spawnPowerUp();
    }
  }

  function updateUI() {
    if(parseInt(scoreValueEl.textContent) !== gameData.gameState.score) {
      scoreValueEl.textContent = gameData.gameState.score;
      scoreValueEl.classList.add('scale-up');
      setTimeout(() => scoreValueEl.classList.remove('scale-up'), 400);
    }
    if(parseInt(levelValueEl.textContent) !== gameData.gameState.level) {
      levelValueEl.textContent = gameData.gameState.level;
      levelValueEl.classList.add('scale-up');
      setTimeout(() => levelValueEl.classList.remove('scale-up'), 400);
    }
    if(parseInt(livesValueEl.textContent) !== gameData.gameState.lives) {
      livesValueEl.textContent = gameData.gameState.lives;
      livesValueEl.classList.add('scale-up');
      setTimeout(() => livesValueEl.classList.remove('scale-up'), 400);
    }
    
    const seconds = Math.floor(elapsedGameTime / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2,'0')}`;

    if(gameData.gameState.powerUps.length === 0) {
      powerUpsListEl.textContent = 'No active power-ups';
    } else {
      powerUpsListEl.innerHTML = '';
      gameData.gameState.powerUps.forEach(pu => {
        const div = document.createElement('div');
        div.className = 'power-up-item';
        div.textContent = pu.type.charAt(0).toUpperCase() + pu.type.slice(1);
        const timerSpan = document.createElement('span');
        timerSpan.className = 'power-up-timer';
        timerSpan.textContent = Math.ceil(pu.timeLeft / 1000);
        div.appendChild(timerSpan);
        powerUpsListEl.appendChild(div);
      });
    }

    achievementsListEl.innerHTML = '';
    gameData.achievements.forEach(ach => {
      const div = document.createElement('div');
      div.className = 'achievement-item' + (ach.unlocked ? ' unlocked' : '');
      div.innerHTML = `<span class="achievement-icon material-icons">${ach.icon}</span><span>${ach.name}</span>`;
      achievementsListEl.appendChild(div);
    });
  }

  function showAchievement(ach) {
    statusMessageEl.textContent = `Achievement Unlocked: ${ach.name}`;
    sounds.achievement.currentTime = 0;
    sounds.achievement.play().catch(()=>{});
    setTimeout(() => {
      if(statusMessageEl.textContent === `Achievement Unlocked: ${ach.name}`) {
        statusMessageEl.textContent = '';
      }
    }, 5000);
  }

  function checkAchievements() {
    gameData.achievements.forEach(ach => {
      if(!ach.unlocked) {
        if(ach.id === 'score_100' && gameData.gameState.score >= 100) {
          ach.unlocked = true;
          showAchievement(ach);
          gameData.gameState.score += ach.reward;
        }
        if(ach.id === 'level_5' && gameData.gameState.level >= 5) {
          ach.unlocked = true;
          showAchievement(ach);
          gameData.gameState.score += ach.reward;
        }
        if(ach.id === 'eat_50_food' && ach.progress >= 50) {
          ach.unlocked = true;
          showAchievement(ach);
          gameData.gameState.score += ach.reward;
        }
      }
    });
  }

  function saveHighScore(name) {
    const newScore = {
      name,
      score: gameData.gameState.score,
      level: gameData.gameState.level,
      date: new Date().toISOString(),
      achievements: gameData.achievements.filter(a => a.unlocked).map(a => a.name)
    };
    gameData.highScores.push(newScore);
    gameData.highScores.sort((a,b) => b.score - a.score);
    if(gameData.highScores.length > 10) {
      gameData.highScores.length = 10;
    }
    localStorage.setItem('snakeHighScores', JSON.stringify(gameData.highScores));
  }

  function initSnake() {
    gameData.player.x = Math.floor(GRID_SIZE/2);
    gameData.player.y = Math.floor(GRID_ROWS/2);
    gameData.player.tail = [];
    for(let i=gameData.player.stats.length-1; i>=0; i--) {
      gameData.player.tail.push({x: gameData.player.x - i, y: gameData.player.y});
    }
    gameData.player.direction = 'right';
    gameData.player.nextDirection = 'right';
    gameData.player.nextDirectionQueue = [];
  }

  function gameOver() {
    gameData.gameState.isGameOver = true;
    gameData.gameState.isPaused = false;
    sounds.death.currentTime = 0;
    sounds.death.volume = gameData.settings.soundVolume;
    sounds.death.play().catch(()=>{});

    showOverlay('Game Over', `Your final score was ${gameData.gameState.score}.`, 'Restart');
  }

  function togglePause() {
    if(gameData.gameState.isGameOver) return;
    gameData.gameState.isPaused = !gameData.gameState.isPaused;
    if(gameData.gameState.isPaused) {
      showOverlay('Paused', 'Game is paused. Press Resume to continue playing.', 'Resume');
      sounds.background.pause();
    } else {
      hideOverlay();
      sounds.background.play().catch(()=>{});
    }
    btnPause.setAttribute('aria-pressed', gameData.gameState.isPaused.toString());
  }

  function showOverlay(title, body, btnText) {
    overlayTitle.textContent = title;
    overlayBody.textContent = body;
    overlayPrimaryBtn.textContent = btnText;
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('show');
    overlayPrimaryBtn.focus();
  }

  function hideOverlay() {
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function restartGame() {
    gameData.gameState = {
      ...gameData.gameState,
      level: 1,
      score: 0,
      lives: 3,
      health: 100,
      combo: 0,
      powerUps: [],
      isPaused: false,
      isGameOver: false,
      difficulty: 1
    };
    gameData.player.stats.length = 5;
    gameData.player.stats.speed = 5;
    initSnake();
    initCollectibles();
    elapsedGameTime = 0;
    lastFrameTime = 0;
    hideOverlay();
    updateUI();
    sounds.background.play().catch(()=>{});
  }

  // Improved input handling
  function handleInput() {
    while (gameData.player.nextDirectionQueue && gameData.player.nextDirectionQueue.length > 0) {
      const newDir = gameData.player.nextDirectionQueue.shift();
      if (!isOppositeDirection(newDir, gameData.player.direction)) {
        gameData.player.nextDirection = newDir;
        break;
      }
    }
  }

  function isOppositeDirection(dir1, dir2) {
    return (dir1 === 'left' && dir2 === 'right') ||
      (dir1 === 'right' && dir2 === 'left') ||
      (dir1 === 'up' && dir2 === 'down') ||
      (dir1 === 'down' && dir2 === 'up');
  }

  window.addEventListener('keydown', e => {
    if(gameData.gameState.isPaused || gameData.gameState.isGameOver) return;
    const key = e.key.toLowerCase();
    
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      e.preventDefault();
    }

    if (!gameData.player.nextDirectionQueue) {
      gameData.player.nextDirectionQueue = [];
    }

    if (key === 'arrowup' || key === 'w') {
      gameData.player.nextDirectionQueue.push('up');
    } else if (key === 'arrowdown' || key === 's') {
      gameData.player.nextDirectionQueue.push('down');
    } else if (key === 'arrowleft' || key === 'a') {
      gameData.player.nextDirectionQueue.push('left');
    } else if (key === 'arrowright' || key === 'd') {
      gameData.player.nextDirectionQueue.push('right');
    } else if (key === ' ' || key === 'p') {
      e.preventDefault();
      togglePause();
    }
  });

  // Touch controls
  let touchStartX=0, touchStartY=0;
  let touchEndX=0, touchEndY=0;

  canvas.addEventListener('touchstart', e => {
    if(e.changedTouches.length === 1) {
      touchStartX = e.changedTouches[0].clientX;
      touchStartY = e.changedTouches[0].clientY;
    }
  });
  canvas.addEventListener('touchend', e => {
    if(e.changedTouches.length === 1) {
      touchEndX = e.changedTouches[0].clientX;
      touchEndY = e.changedTouches[0].clientY;
      const dx = touchEndX - touchStartX;
      const dy = touchEndY - touchStartY;
      if(Math.abs(dx) > Math.abs(dy)) {
        if(dx > 30) pushDirectionInput('right');
        else if(dx < -30) pushDirectionInput('left');
      } else {
        if(dy > 30) pushDirectionInput('down');
        else if(dy < -30) pushDirectionInput('up');
      }
    }
  });
  function pushDirectionInput(dir) {
    if(!gameData.player.nextDirectionQueue) gameData.player.nextDirectionQueue = [];
    gameData.player.nextDirectionQueue.push(dir);
  }

  function moveSnake() {
    gameData.player.direction = gameData.player.nextDirection;
    let newX = gameData.player.x;
    let newY = gameData.player.y;
    
    if(gameData.player.direction === 'up') newY--;
    else if(gameData.player.direction === 'down') newY++;
    else if(gameData.player.direction === 'left') newX--;
    else if(gameData.player.direction === 'right') newX++;

    // Wrap around
    if(newX < 0) newX = GRID_SIZE - 1;
    else if(newX >= GRID_SIZE) newX = 0;
    if(newY < 0) newY = GRID_ROWS - 1;
    else if(newY >= GRID_ROWS) newY = 0;

    const headPos = {x: newX, y: newY};

    // Check self collision
    if(gameData.player.tail.some(t => t.x === headPos.x && t.y === headPos.y)) {
      if(gameData.gameState.lives > 1) {
        gameData.gameState.lives--;
        gameData.player.stats.length = Math.max(5, gameData.player.stats.length - 3);
        initSnake();
        triggerScreenShake(15);
        sounds.collision.play().catch(()=>{});
        return;
      } else {
        gameOver();
        return;
      }
    }

    // Advance snake tail
    gameData.player.tail.push({x: gameData.player.x, y: gameData.player.y});
    while(gameData.player.tail.length > gameData.player.stats.length) {
      gameData.player.tail.shift();
    }
    gameData.player.x = headPos.x;
    gameData.player.y = headPos.y;

    // Check collectible collisions
    let eatenFood = false;
    for(let i=gameData.collectibles.length-1; i>=0; i--) {
      const c = gameData.collectibles[i];
      if(checkCollision(c, headPos)) {
        if(c.type === 'food') {
          gameData.collectibles.splice(i,1);
          eatenFood = true;
          gameData.player.stats.length++;
          gameData.gameState.score += c.value;
          sounds.eat.currentTime=0;
          sounds.eat.volume=gameData.settings.soundVolume;
          sounds.eat.play().catch(()=>{});
          particleSystem.create(c.x*CELL_SIZE+CELL_SIZE/2, c.y*CELL_SIZE+CELL_SIZE/2, '#22c55e');
          achEatFoodProgress++;
        } else if(c.type === 'powerup' && c.effects && c.effects.type) {
          activatePowerUp(c.effects.type);
          gameData.collectibles.splice(i,1);
          particleSystem.create(c.x*CELL_SIZE+CELL_SIZE/2, c.y*CELL_SIZE+CELL_SIZE/2, '#facc15');
          sounds.powerup.currentTime=0;
          sounds.powerup.volume=gameData.settings.soundVolume;
          sounds.powerup.play().catch(()=>{});
        }
      }
    }
    if(eatenFood && gameData.gameState.score % 50 === 0) {
      levelUp();
    }

    // Spawn new collectibles if none left
    if(gameData.collectibles.length < 3) {
      if(Math.random() < 0.8) spawnFood();
      else spawnPowerUp();
    }

    // Update power-ups timers
    updatePowerUps(frameDuration);

    // Check achievements
    checkAchievements();

    updateUI();
  }

  function updateGame(deltaTime) {
    elapsedGameTime += deltaTime;
    accumulator += deltaTime;
    
    let moveInterval = 1000 / gameData.player.stats.speed;
    
    while (accumulator >= moveInterval) {
      accumulator -= moveInterval;
      moveSnake();
    }
  }

  function activatePowerUp(type) {
    let existing = gameData.gameState.powerUps.find(pu => pu.type === type);
    if(existing) {
      existing.timeLeft = 10000;
    } else {
      gameData.gameState.powerUps.push({
        type,
        timeLeft: 10000
      });
    }
    
    if(type === 'speed') {
      gameData.player.stats.speed = 10;
    } else if(type === 'shield') {
      // For demonstration: invulnerability not implemented fully
    } else if(type === 'doublePoints') {
      // Apply during food score addition (Handled in score increment?)
    }
  }

  function updatePowerUps(deltaTime) {
    for(let i=gameData.gameState.powerUps.length-1; i>=0; i--) {
      const pu = gameData.gameState.powerUps[i];
      pu.timeLeft -= deltaTime;
      if(pu.timeLeft <= 0) {
        gameData.gameState.powerUps.splice(i,1);
        if(pu.type === 'speed') {
          gameData.player.stats.speed = 5;
        }
      }
    }
  }

  function levelUp() {
    gameData.gameState.level++;
    gameData.gameState.difficulty += 0.1;
    gameData.player.stats.speed += 1;
    sounds.levelup.currentTime=0;
    sounds.levelup.volume=gameData.settings.soundVolume;
    sounds.levelup.play().catch(()=>{});
    statusMessageEl.textContent = `Level Up! Level ${gameData.gameState.level}`;
    setTimeout(() => {
      if(statusMessageEl.textContent === `Level Up! Level ${gameData.gameState.level}`) {
        statusMessageEl.textContent = '';
      }
    }, 5000);
  }

  // Rendering functions
  function renderGrid(ctx) {
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    for(let i=0;i<=GRID_SIZE;i++){
      ctx.beginPath();
      ctx.moveTo(i*CELL_SIZE, 0);
      ctx.lineTo(i*CELL_SIZE, GRID_ROWS*CELL_SIZE);
      ctx.stroke();
    }
    for(let j=0;j<=GRID_ROWS;j++){
      ctx.beginPath();
      ctx.moveTo(0, j*CELL_SIZE);
      ctx.lineTo(GRID_SIZE*CELL_SIZE, j*CELL_SIZE);
      ctx.stroke();
    }
  }

  function renderSnake(ctx) {
    gameData.player.tail.forEach((segment, index) => {
      const alpha = 0.7 + (index / gameData.player.tail.length) * 0.3;
      ctx.fillStyle = `rgba(14, 165, 233, ${alpha})`;
      ctx.shadowColor = 'rgba(34, 211, 238, 0.8)';
      ctx.shadowBlur = 8;
      ctx.fillRect(
        segment.x * CELL_SIZE + 1,
        segment.y * CELL_SIZE + 1,
        CELL_SIZE - 2,
        CELL_SIZE - 2
      );
    });
    
    ctx.fillStyle = '#0ea5e9';
    ctx.shadowColor = '#0ea5e9';
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.roundRect(
      gameData.player.x * CELL_SIZE + 2,
      gameData.player.y * CELL_SIZE + 2,
      CELL_SIZE - 4,
      CELL_SIZE - 4,
      4
    );
    ctx.fill();
    
    ctx.fillStyle = 'white';
    const eyeSize = CELL_SIZE / 6;
    const eyeOffset = CELL_SIZE / 3;
    
    if (gameData.player.direction === 'right') {
      ctx.fillRect(
        gameData.player.x * CELL_SIZE + CELL_SIZE - eyeOffset - eyeSize,
        gameData.player.y * CELL_SIZE + eyeOffset,
        eyeSize,
        eyeSize
      );
      ctx.fillRect(
        gameData.player.x * CELL_SIZE + CELL_SIZE - eyeOffset - eyeSize,
        gameData.player.y * CELL_SIZE + CELL_SIZE - eyeOffset * 1.5,
        eyeSize,
        eyeSize
      );
    } else if (gameData.player.direction === 'left') {
      ctx.fillRect(
        gameData.player.x * CELL_SIZE + eyeOffset,
        gameData.player.y * CELL_SIZE + eyeOffset,
        eyeSize,
        eyeSize
      );
      ctx.fillRect(
        gameData.player.x * CELL_SIZE + eyeOffset,
        gameData.player.y * CELL_SIZE + CELL_SIZE - eyeOffset * 1.5,
        eyeSize,
        eyeSize
      );
    } else if (gameData.player.direction === 'up') {
      ctx.fillRect(
        gameData.player.x * CELL_SIZE + eyeOffset,
        gameData.player.y * CELL_SIZE + eyeOffset,
        eyeSize,
        eyeSize
      );
      ctx.fillRect(
        gameData.player.x * CELL_SIZE + CELL_SIZE - eyeOffset * 1.5,
        gameData.player.y * CELL_SIZE + eyeOffset,
        eyeSize,
        eyeSize
      );
    } else if (gameData.player.direction === 'down') {
      ctx.fillRect(
        gameData.player.x * CELL_SIZE + eyeOffset,
        gameData.player.y * CELL_SIZE + CELL_SIZE - eyeOffset - eyeSize,
        eyeSize,
        eyeSize
      );
      ctx.fillRect(
        gameData.player.x * CELL_SIZE + CELL_SIZE - eyeOffset * 1.5,
        gameData.player.y * CELL_SIZE + CELL_SIZE - eyeOffset - eyeSize,
        eyeSize,
        eyeSize
      );
    }
  }

  function renderCollectibles(ctx) {
    gameData.collectibles.forEach(c => {
      if(c.type === 'food') {
        ctx.fillStyle = '#22c55e';
        ctx.shadowColor = '#22c55e';
      } else if(c.type === 'powerup') {
        ctx.fillStyle = '#facc15';
        ctx.shadowColor = '#facc15';
      } else {
        ctx.fillStyle = '#999';
        ctx.shadowColor = '#999';
      }
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(
        c.x*CELL_SIZE + CELL_SIZE/2,
        c.y*CELL_SIZE + CELL_SIZE/2,
        CELL_SIZE/3,
        0, Math.PI*2
      );
      ctx.fill();
      c.animation += 0.1;
      if(c.animation > Math.PI*2) c.animation = 0;
    });
  }

  function renderGame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    applyScreenShake(ctx);
    renderGrid(ctx);
    renderCollectibles(ctx);
    renderSnake(ctx);
    particleSystem.draw(ctx);
    ctx.restore();
    particleSystem.update();
  }

  // Game loop
  const gameLoop = (timestamp) => {
    if(!lastFrameTime) lastFrameTime = timestamp;
    const deltaTime = timestamp - lastFrameTime;
    lastFrameTime = timestamp;

    if(!gameData.gameState.isPaused && !gameData.gameState.isGameOver) {
      handleInput();
      updateGame(deltaTime);
    }
    
    renderGame();
    requestAnimationFrame(gameLoop);
  };

  // UI Event Listeners
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  fullscreenBtn.addEventListener('click', () => {
    if(!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(_ => {});
      gameData.settings.fullscreen = true;
    } else {
      document.exitFullscreen().catch(_ => {});
      gameData.settings.fullscreen = false;
    }
  });

  overlayPrimaryBtn.addEventListener('click', () => {
    if(gameData.gameState.isGameOver) {
      restartGame();
    } else if(gameData.gameState.isPaused) {
      togglePause();
    }
  });

  const btnPause = document.getElementById('btn-pause');
  btnPause.addEventListener('click', () => togglePause());

  const btnRestart = document.getElementById('btn-restart');
  btnRestart.addEventListener('click', () => {
    if(confirm('Are you sure you want to restart the game?')) restartGame();
  });

  const btnSettings = document.getElementById('btn-settings');
  btnSettings.addEventListener('click', () => {
    if(gameData.gameState.isPaused) {
      showSettingsMenu();
    } else {
      gameData.gameState.isPaused = true;
      showSettingsMenu();
    }
  });

  function showSettingsMenu() {
    overlayTitle.textContent = 'Settings';
    overlayBody.innerHTML = `
      <form id="settings-form" novalidate>
        <label for="soundVolume">Sound Volume: <output for="soundVolume" id="soundVolumeOutput">${Math.round(gameData.settings.soundVolume*100)}</output>%</label>
        <input type="range" id="soundVolume" name="soundVolume" min="0" max="1" step="0.01" value="${gameData.settings.soundVolume}" />
        <br/>
        <label for="musicVolume">Music Volume: <output for="musicVolume" id="musicVolumeOutput">${Math.round(gameData.settings.musicVolume*100)}</output>%</label>
        <input type="range" id="musicVolume" name="musicVolume" min="0" max="1" step="0.01" value="${gameData.settings.musicVolume}" />
        <br/>
        <label for="graphics">Graphics Quality:</label>
        <select id="graphics" name="graphics">
          <option value="low" ${gameData.settings.graphics==='low'?'selected':''}>Low</option>
          <option value="medium" ${gameData.settings.graphics==='medium'?'selected':''}>Medium</option>
          <option value="high" ${gameData.settings.graphics==='high'?'selected':''}>High</option>
        </select>
        <br/>
        <button type="submit" style="margin-top:16px;padding:12px 24px;border:none;border-radius:16px;background:#38bdf8;color:#0f172a;font-weight:700;cursor:pointer;">Save & Resume</button>
      </form>
    `;
    overlayPrimaryBtn.style.display = 'none';
    const form = document.getElementById('settings-form');
    const soundVolumeInput = form.elements['soundVolume'];
    const musicVolumeInput = form.elements['musicVolume'];
    const soundVolumeOutput = document.getElementById('soundVolumeOutput');
    const musicVolumeOutput = document.getElementById('musicVolumeOutput');

    function updateOutput() {
      soundVolumeOutput.textContent = Math.round(parseFloat(soundVolumeInput.value)*100);
      musicVolumeOutput.textContent = Math.round(parseFloat(musicVolumeInput.value)*100);
    }
    soundVolumeInput.addEventListener('input', () => {
      updateOutput();
      gameData.settings.soundVolume = parseFloat(soundVolumeInput.value);
    });
    musicVolumeInput.addEventListener('input', () => {
      updateOutput();
      gameData.settings.musicVolume = parseFloat(musicVolumeInput.value);
      sounds.background.volume = gameData.settings.musicVolume;
    });
    form.elements['graphics'].addEventListener('change', e => {
      gameData.settings.graphics = e.target.value;
    });

    form.addEventListener('submit', e => {
      e.preventDefault();
      overlayPrimaryBtn.style.display = '';
      overlayPrimaryBtn.textContent = 'Resume';
      overlayPrimaryBtn.focus();
      hideSettingsMenu();
      togglePause();
    });
  }

  function hideSettingsMenu() {
    overlayBody.textContent = '';
  }

  // Sidebar sections collapsible toggles
  [['controls-toggle', 'controls-content', 'controls-icon'],
  ['powerups-toggle', 'powerups-content', 'powerups-icon'],
  ['achievements-toggle', 'achievements-content', 'achievements-icon']].forEach(([toggleId, contentId, iconId]) => {
    const toggle = document.getElementById(toggleId);
    const content = document.getElementById(contentId);
    const icon = document.getElementById(iconId);
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      content.classList.toggle('collapsed', expanded);
      icon.textContent = expanded ? 'expand_more' : 'expand_less';
    });
    toggle.addEventListener('keydown', e => {
      if(e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle.click();
      }
    });
  });

  // Achievement progress tracking variable
  let achEatFoodProgress = 0;
  gameData.achievements.find(a => a.id === 'eat_50_food').progress = achEatFoodProgress;

  // Initialization
  function init() {
    initSnake();
    initCollectibles();
    updateUI();
    sounds.background.volume = gameData.settings.musicVolume;
    sounds.background.play().catch(() => {});
    lastFrameTime = 0;
    gameData.gameState.isPaused = false;
    gameData.gameState.isGameOver = false;
    requestAnimationFrame(gameLoop);
  }

  // Start game
  init();

})(); 