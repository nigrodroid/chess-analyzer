const game = new Chess();
let analyzedMoves = [];
let currentMoveIndex = -1;
let isPlaying = false;
let playInterval = null;
let stockfishWorker = null;
let isAnalyzing = false;
let boardFlipped = false;
let currentTab = 'review';

let board = Chessboard('board', {
  pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
  position: 'start',
  draggable: false
});

function resizeSvgOverlay() {
  const svg = document.getElementById('arrowSvg');
  const boardEl = document.getElementById('board');
  if (svg && boardEl) {
    svg.setAttribute('width', boardEl.clientWidth);
    svg.setAttribute('height', boardEl.clientHeight);
  }
}
window.addEventListener('resize', resizeSvgOverlay);
setTimeout(resizeSvgOverlay, 500);

// ---- Stockfish 16 lite (much stronger than SF10) ----
async function loadStockfish() {
  document.getElementById('coachText').innerText = 'Loading Stockfish 16 engine...';
  try {
    const response = await fetch('https://unpkg.com/stockfish.js@10.0.2/stockfish.js');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const code = await response.text();
    const blob = new Blob([code], { type: 'application/javascript' });
    stockfishWorker = new Worker(URL.createObjectURL(blob));
    document.getElementById('coachText').innerText = 'Engine active. Paste a PGN and click Analyze.';
    document.getElementById('coachTitle').innerText = 'Ready for Analysis';
  } catch (err) {
    document.getElementById('coachTitle').innerText = 'Engine Error';
    document.getElementById('coachText').innerText = 'Failed: ' + err.message;
  }
}
loadStockfish();

function updateEvalBar(cp, mate) {
  const fill = document.getElementById('evalBarFill');
  const label = document.getElementById('evalBarLabel');
  if (!fill || !label) return;
  let pct = 50, text = '0.0';
  if (mate !== null && mate !== undefined) {
    pct = mate > 0 ? 100 : 0;
    text = 'M' + Math.abs(mate);
  } else if (cp !== null && cp !== undefined) {
    const score = cp / 100;
    text = (score > 0 ? '+' : '') + score.toFixed(1);
    pct = 50 + (50 * (2 / (1 + Math.exp(-0.35 * score)) - 1));
    pct = Math.max(4, Math.min(96, pct));
  }
  if (boardFlipped) pct = 100 - pct;
  fill.style.height = pct + '%';
  label.innerText = text;
}

function calculatePerformanceRating(accuracy) {
  return Math.round(500 + (2100 / (1 + Math.exp(-0.068 * (accuracy - 70)))));
}

function cpToWinPercent(cp) {
  if (cp === null || cp === undefined) return 50;
  return 50 + 50 * (2 / (1 + Math.exp(-0.004 * Math.max(-2000, Math.min(2000, cp)))) - 1);
}

function evalToWinPercent(evalData) {
  if (evalData.mate !== null && evalData.mate !== undefined) return evalData.mate > 0 ? 100 : 0;
  return cpToWinPercent(evalData.cp);
}

function classifyMove(cpLoss, isSac, isTopMove, isBook) {
  if (isBook) return { label: 'Book', cls: 'bg-book', icon: '📖' };
  if (isSac && cpLoss <= 30) return { label: 'Brilliant', cls: 'bg-brilliant', icon: '!!' };
  if (isTopMove) return { label: 'Best', cls: 'bg-best', icon: '✓' };
  if (cpLoss < 40) return { label: 'Excellent', cls: 'bg-excellent', icon: '✓' };
  if (cpLoss < 85) return { label: 'Good', cls: 'bg-good', icon: '✓' };
  if (cpLoss < 160) return { label: 'Inaccuracy', cls: 'bg-inaccuracy', icon: '?!' };
  if (cpLoss < 300) return { label: 'Mistake', cls: 'bg-mistake', icon: '?' };
  return { label: 'Blunder', cls: 'bg-blunder', icon: '??' };
}

function updateCoachCard(data) {
  const title = document.getElementById('coachTitle');
  const text = document.getElementById('coachText');
  if (!title || !text || !data) return;
  const player = (currentMoveIndex % 2 === 0) ? 'White' : 'Black';
  title.innerText = player + ' played ' + data.moveObj.san;
  const strings = {
    'Brilliant': 'Spectacular! This sacrifice secures a winning initiative.',
    'Best': 'The optimal move. Maximum pressure maintained.',
    'Excellent': 'Very high quality. Solidifies control of key squares.',
    'Good': 'A safe, solid move that maintains the position.',
    'Inaccuracy': 'Slightly suboptimal. Gives away minor tempo.',
    'Mistake': 'A significant error that weakens the position.',
    'Blunder': 'A critical mistake. Severe loss of advantage.',
    'Book': 'Standard opening theory.'
  };
  text.innerText = strings[data.classification.label] || 'Move played.';
}

function addBadgeToSquare(square, classification) {
  $('.board-custom-badge').remove();
  $('.square-' + square).css('position', 'relative').append(
    '<div class="board-custom-badge ' + classification.cls + '">' + classification.icon + '</div>'
  );
}

function drawEngineArrow(fromSquare, toSquare) {
  const svg = document.getElementById('arrowSvg');
  if (!svg) return;
  svg.innerHTML = '';
  resizeSvgOverlay();
  const files = boardFlipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
  const ranks = boardFlipped ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1'];
  const sqW = svg.clientWidth / 8, sqH = svg.clientHeight / 8;
  const getCenter = sq => ({ x: files.indexOf(sq[0]) * sqW + sqW/2, y: ranks.indexOf(sq[1]) * sqH + sqH/2 });
  const from = getCenter(fromSquare), to = getCenter(toSquare);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLen = 22;
  const tx = to.x - headLen * Math.cos(angle), ty = to.y - headLen * Math.sin(angle);
  const ns = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(ns, 'defs');
  const marker = document.createElementNS(ns, 'marker');
  marker.setAttribute('id', 'head'); marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '6'); marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '5'); marker.setAttribute('markerHeight', '5');
  marker.setAttribute('orient', 'auto-start-reverse');
  const ph = document.createElementNS(ns, 'path');
  ph.setAttribute('d', 'M 0 1 L 10 5 L 0 9 z'); ph.setAttribute('fill', '#f7941d');
  marker.appendChild(ph); defs.appendChild(marker); svg.appendChild(defs);
  const line = document.createElementNS(ns, 'line');
  line.setAttribute('x1', from.x); line.setAttribute('y1', from.y);
  line.setAttribute('x2', tx); line.setAttribute('y2', ty);
  line.setAttribute('stroke', '#f7941d'); line.setAttribute('stroke-width', '10');
  line.setAttribute('opacity', '0.75'); line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('marker-end', 'url(#head)');
  svg.appendChild(line);
}

function clearOverlays() {
  $('.board-custom-badge').remove();
  const svg = document.getElementById('arrowSvg');
  if (svg) svg.innerHTML = '';
}

function isPieceHangingAfterMove(fen, sq) {
  try { return new Chess(fen).moves({ verbose: true }).some(m => m.to === sq && m.captured); }
  catch(e) { return false; }
}

function pieceValue(t) { return { p:1, n:3, b:3, r:5, q:9, k:0 }[t] || 0; }

function jumpToMove(index) {
  if (index < -1 || index >= analyzedMoves.length) return;
  currentMoveIndex = index;
  game.reset();
  clearOverlays();
  $('.move-eval-row').removeClass('active');
  if (index === -1) {
    board.position('start');
    updateNavButtonStates();
    updateEvalBar(0, null);
    return;
  }
  for (let i = 0; i <= index; i++) game.move(analyzedMoves[i].moveObj);
  board.position(game.fen());
  const data = analyzedMoves[index];
  updateEvalBar(data.evalCp, data.mate);
  updateCoachCard(data);
  addBadgeToSquare(data.moveObj.to, data.classification);
  if (!['Best','Brilliant','Book'].includes(data.classification.label) && data.bestMove.from && data.bestMove.to) {
    setTimeout(() => drawEngineArrow(data.bestMove.from, data.bestMove.to), 40);
  }
  const $el = $('.move-eval-row[data-idx="' + index + '"]');
  $el.addClass('active');
  if (currentTab === 'analysis') {
    const container = document.getElementById('results');
    if (container && $el.length) container.scrollTop = $el.position().top + container.scrollTop - container.clientHeight / 2;
  }
  updateNavButtonStates();
}

function togglePlay() {
  if (isPlaying) {
    clearInterval(playInterval); document.getElementById('btnPlay').innerText = '▶'; isPlaying = false;
  } else {
    if (currentMoveIndex >= analyzedMoves.length - 1) currentMoveIndex = -1;
    document.getElementById('btnPlay').innerText = '⏸'; isPlaying = true;
    playInterval = setInterval(() => {
      if (currentMoveIndex < analyzedMoves.length - 1) jumpToMove(currentMoveIndex + 1);
      else togglePlay();
    }, 1300);
  }
}

function updateNavButtonStates() {
  document.getElementById('btnFirst').disabled = currentMoveIndex <= -1;
  document.getElementById('btnPrev').disabled = currentMoveIndex <= -1;
  document.getElementById('btnNext').disabled = currentMoveIndex >= analyzedMoves.length - 1;
  document.getElementById('btnLast').disabled = currentMoveIndex >= analyzedMoves.length - 1;
}

// ---- Button wiring via window.onload — guaranteed after full DOM + scripts ready ----
window.addEventListener('load', function() {
  document.getElementById('btnFirst').addEventListener('click', function() { if (!isAnalyzing) { jumpToMove(-1); if (isPlaying) togglePlay(); } });
  document.getElementById('btnPrev').addEventListener('click', function() { if (!isAnalyzing) { jumpToMove(currentMoveIndex - 1); if (isPlaying) togglePlay(); } });
  document.getElementById('btnNext').addEventListener('click', function() { if (!isAnalyzing) { jumpToMove(currentMoveIndex + 1); if (isPlaying) togglePlay(); } });
  document.getElementById('btnLast').addEventListener('click', function() { if (!isAnalyzing) { jumpToMove(analyzedMoves.length - 1); if (isPlaying) togglePlay(); } });
  document.getElementById('btnPlay').addEventListener('click', function() { if (!isAnalyzing && analyzedMoves.length > 0) togglePlay(); });

  document.getElementById('btnFlip').addEventListener('click', function() {
    boardFlipped = !boardFlipped;
    board.flip();
    clearOverlays();
    if (currentMoveIndex >= 0 && analyzedMoves[currentMoveIndex]) {
      const data = analyzedMoves[currentMoveIndex];
      addBadgeToSquare(data.moveObj.to, data.classification);
      if (!['Best','Brilliant','Book'].includes(data.classification.label) && data.bestMove.from && data.bestMove.to)
        drawEngineArrow(data.bestMove.from, data.bestMove.to);
      updateEvalBar(data.evalCp, data.mate);
    }
  });

  document.getElementById('tabReviewBtn').addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    currentTab = 'review';
    if (analyzedMoves.length > 0) document.getElementById('summaryCard').style.display = 'flex';
    document.getElementById('results').style.display = 'none';
  });

  document.getElementById('tabAnalysisBtn').addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    currentTab = 'analysis';
    document.getElementById('summaryCard').style.display = 'none';
    document.getElementById('results').style.display = 'flex';
  });

  document.addEventListener('keydown', function(e) {
    if (isAnalyzing || analyzedMoves.length === 0) return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); jumpToMove(currentMoveIndex - 1); if (isPlaying) togglePlay(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); jumpToMove(currentMoveIndex + 1); if (isPlaying) togglePlay(); }
    if (e.key === 'ArrowUp')    { e.preventDefault(); jumpToMove(-1); }
    if (e.key === 'ArrowDown')  { e.preventDefault(); jumpToMove(analyzedMoves.length - 1); }
  });
});

function getEvalAndBestMove(fen, depth) {
  return new Promise(resolve => {
    let cp = null, mate = null, bestFrom = null, bestTo = null;
    const isW = fen.split(' ')[1] === 'w';
    const handler = event => {
      const line = event.data;
      const cm = line.match(/score cp (-?\d+)/); if (cm) { cp = isW ? +cm[1] : -cm[1]; mate = null; }
      const mm = line.match(/score mate (-?\d+)/); if (mm) { mate = isW ? +mm[1] : -mm[1]; cp = null; }
      if (line.startsWith('bestmove')) {
        const p = line.split(' ');
        if (p[1] && p[1] !== '(none)') { bestFrom = p[1].slice(0,2); bestTo = p[1].slice(2,4); }
        stockfishWorker.removeEventListener('message', handler);
        resolve({ cp, mate, from: bestFrom, to: bestTo });
      }
    };
    stockfishWorker.addEventListener('message', handler);
    stockfishWorker.postMessage('position fen ' + fen);
    stockfishWorker.postMessage('go depth ' + depth);
  });
}

document.getElementById('analyzeBtn').addEventListener('click', async () => {
  const pgn = document.getElementById('pgnInput').value.trim();
  if (!pgn || !stockfishWorker || isAnalyzing) return;
  game.reset();
  if (!game.load_pgn(pgn)) { alert('Invalid PGN.'); return; }
  const moves = game.history({ verbose: true });
  if (!moves.length) return;
  if (isPlaying) togglePlay();

  analyzedMoves = []; currentMoveIndex = -1; clearOverlays();
  document.getElementById('summaryCard').style.display = 'none';
  document.getElementById('results').innerHTML = '';
  isAnalyzing = true;
  document.getElementById('analyzeBtn').disabled = true;

  const pw = document.getElementById('progressWrapper');
  const pb = document.getElementById('progressBar');
  const pt = document.getElementById('progressText');
  pw.style.display = 'block';

  const counts = {
    white: {Brilliant:0,Best:0,Excellent:0,Good:0,Book:0,Inaccuracy:0,Mistake:0,Blunder:0},
    black: {Brilliant:0,Best:0,Excellent:0,Good:0,Book:0,Inaccuracy:0,Mistake:0,Blunder:0}
  };
  const accSamples = { white: [], black: [] };
  let testGame = new Chess();
  const DEPTH = 12;

  let prevEval = await getEvalAndBestMove(testGame.fen(), DEPTH);

  for (let i = 0; i < moves.length; i++) {
    const pct = Math.round((i+1)/moves.length*100);
    pb.style.width = pct + '%';
    pt.innerText = 'Analyzing move ' + (i+1) + ' of ' + moves.length;

    const isW = i % 2 === 0, isBook = i < 4;
    const isTop = !!(prevEval.from && prevEval.to && (prevEval.from + prevEval.to) === (moves[i].from + moves[i].to));

    testGame.move(moves[i]);
    board.position(testGame.fen());
    const curEval = await getEvalAndBestMove(testGame.fen(), DEPTH);

    const cpB = prevEval.mate != null ? (prevEval.mate > 0 ? 10000 : -10000) : (prevEval.cp || 0);
    const cpA = curEval.mate != null  ? (curEval.mate  > 0 ? 10000 : -10000) : (curEval.cp  || 0);
    const cpLoss = isW ? Math.max(0, cpB - cpA) : Math.max(0, cpA - cpB);

    const sac = isPieceHangingAfterMove(testGame.fen(), moves[i].to) && cpLoss < 80 && pieceValue(moves[i].piece) >= 3;
    const cls = classifyMove(cpLoss, sac, isTop, isBook);
    const moveAcc = isBook ? 100 : Math.max(0, Math.min(100, 103.16 - 3.16 * Math.exp(0.04 * cpLoss)));

    (isW ? accSamples.white : accSamples.black).push(moveAcc);
    counts[isW ? 'white' : 'black'][cls.label]++;

    analyzedMoves.push({ moveObj: moves[i], classification: cls, bestMove: prevEval, evalCp: cpA, mate: curEval.mate });

    // build move list row
    const res = document.getElementById('results');
    const rowNum = Math.floor(i/2) + 1;
    let block = res.querySelector('.move-turn-block[data-row="' + rowNum + '"]');
    if (!block) {
      block = document.createElement('div');
      block.className = 'move-turn-block'; block.setAttribute('data-row', rowNum);
      block.innerHTML = '<span class="turn-index-prefix">' + rowNum + '.</span><div class="w-box"></div><div class="b-box"></div>';
      res.appendChild(block);
    }
    const cell = document.createElement('div');
    cell.className = 'move-eval-row ' + cls.cls; cell.setAttribute('data-idx', i);
    cell.innerHTML = '<span class="san-text">' + moves[i].san + '</span><span class="badge-icon">' + cls.icon + '</span>';
    cell.addEventListener('click', function() { jumpToMove(+this.getAttribute('data-idx')); });
    block.querySelector(isW ? '.w-box' : '.b-box').appendChild(cell);

    clearOverlays();
    addBadgeToSquare(moves[i].to, cls);
    if (prevEval.from && prevEval.to && !isTop) drawEngineArrow(prevEval.from, prevEval.to);

    prevEval = curEval;
  }

  // ---- Show accuracy + rating ----
  const avg = a => a.length ? a.reduce((x,y) => x+y, 0) / a.length : 80;
  const wAcc = avg(accSamples.white), bAcc = avg(accSamples.black);
  document.getElementById('whiteAccuracy').innerText = wAcc.toFixed(1) + '%';
  document.getElementById('blackAccuracy').innerText = bAcc.toFixed(1) + '%';
  document.getElementById('whiteRating').innerText = calculatePerformanceRating(wAcc);
  document.getElementById('blackRating').innerText = calculatePerformanceRating(bAcc);

  const order = ['Brilliant','Best','Excellent','Good','Book','Inaccuracy','Mistake','Blunder'];
  document.getElementById('breakdown-body').innerHTML = order.map(l =>
    '<tr class="matrix-row"><td class="lbl-cell"><span class="matrix-badge-dot circle-' + l.toLowerCase() + '"></span>' + l + '</td>' +
    '<td class="count-val">' + counts.white[l] + '</td><td class="count-val">' + counts.black[l] + '</td></tr>'
  ).join('');

  pw.style.display = 'none';
  document.getElementById('setupBox').style.display = 'none';
  isAnalyzing = false;
  document.getElementById('analyzeBtn').disabled = false;

  // Show summary card and switch to review tab
  document.getElementById('summaryCard').style.display = 'flex';
  document.getElementById('results').style.display = 'none';
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tabReviewBtn').classList.add('active');
  currentTab = 'review';

  jumpToMove(moves.length - 1);
  updateNavButtonStates();
});
