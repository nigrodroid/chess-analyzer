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

async function loadStockfish() {
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = "<div style='color:#fff;font-size:12px;padding:10px;'>Loading engine...</div>";
  try {
    const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');
    if (!response.ok) throw new Error('Fetch failed: ' + response.status);
    const code = await response.text();
    const blob = new Blob([code], { type: 'application/javascript' });
    stockfishWorker = new Worker(URL.createObjectURL(blob));
    resultsDiv.innerHTML = '';
    document.getElementById('coachText').innerText = 'Engine active. Paste a PGN and click Analyze.';
  } catch (err) {
    document.getElementById('coachText').innerText = 'Engine failed: ' + err.message;
  }
}
loadStockfish();

function updateEvalBar(cp, mate) {
  const fill = document.getElementById('evalBarFill');
  const label = document.getElementById('evalBarLabel');
  if (!fill || !label) return;
  let pct = 50, text = '0.0';
  if (mate !== null) {
    pct = mate > 0 ? 100 : 0;
    text = 'M' + Math.abs(mate);
  } else {
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
  if (cp === null) return 50;
  return 50 + 50 * (2 / (1 + Math.exp(-0.004 * Math.max(-2000, Math.min(2000, cp)))) - 1);
}

function evalToWinPercent(evalData) {
  if (evalData.mate !== null) return evalData.mate > 0 ? 100 : 0;
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
    'Best': 'The optimal move. Maximum pressure on the objective.',
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
  const badgeHtml = '<div class="board-custom-badge ' + classification.cls + '">' + classification.icon + '</div>';
  $('.square-' + square).css('position', 'relative').append(badgeHtml);
}

function drawEngineArrow(fromSquare, toSquare) {
  const svg = document.getElementById('arrowSvg');
  if (!svg) return;
  svg.innerHTML = '';
  resizeSvgOverlay();
  const files = boardFlipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
  const ranks = boardFlipped ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1'];
  const sqW = svg.clientWidth / 8;
  const sqH = svg.clientHeight / 8;
  const getCenter = (sq) => ({
    x: files.indexOf(sq[0]) * sqW + sqW / 2,
    y: ranks.indexOf(sq[1]) * sqH + sqH / 2
  });
  const from = getCenter(fromSquare);
  const to = getCenter(toSquare);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLength = 22;
  const targetX = to.x - headLength * Math.cos(angle);
  const targetY = to.y - headLength * Math.sin(angle);
  const ns = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(ns, 'defs');
  const marker = document.createElementNS(ns, 'marker');
  marker.setAttribute('id', 'head');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '6');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '5');
  marker.setAttribute('markerHeight', '5');
  marker.setAttribute('orient', 'auto-start-reverse');
  const pathHead = document.createElementNS(ns, 'path');
  pathHead.setAttribute('d', 'M 0 1 L 10 5 L 0 9 z');
  pathHead.setAttribute('fill', '#f7941d');
  marker.appendChild(pathHead);
  defs.appendChild(marker);
  svg.appendChild(defs);
  const line = document.createElementNS(ns, 'line');
  line.setAttribute('x1', from.x);
  line.setAttribute('y1', from.y);
  line.setAttribute('x2', targetX);
  line.setAttribute('y2', targetY);
  line.setAttribute('stroke', '#f7941d');
  line.setAttribute('stroke-width', '10');
  line.setAttribute('opacity', '0.75');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('marker-end', 'url(#head)');
  svg.appendChild(line);
}

function clearOverlays() {
  $('.board-custom-badge').remove();
  const svg = document.getElementById('arrowSvg');
  if (svg) svg.innerHTML = '';
}

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
  if (!['Best', 'Brilliant', 'Book'].includes(data.classification.label) && data.bestMove.from && data.bestMove.to) {
    setTimeout(() => { drawEngineArrow(data.bestMove.from, data.bestMove.to); }, 40);
  }
  const $el = $('.move-eval-row[data-idx="' + index + '"]');
  $el.addClass('active');
  if (currentTab === 'analysis') {
    const container = document.getElementById('results');
    if (container && $el.length) {
      container.scrollTop = $el.position().top + container.scrollTop - container.clientHeight / 2;
    }
  }
  updateNavButtonStates();
}

function togglePlay() {
  if (isPlaying) {
    clearInterval(playInterval);
    $('#btnPlay').text('▶');
    isPlaying = false;
  } else {
    if (currentMoveIndex >= analyzedMoves.length - 1) currentMoveIndex = -1;
    $('#btnPlay').text('⏸');
    isPlaying = true;
    playInterval = setInterval(() => {
      if (currentMoveIndex < analyzedMoves.length - 1) jumpToMove(currentMoveIndex + 1);
      else togglePlay();
    }, 1300);
  }
}

function updateNavButtonStates() {
  $('#btnFirst').prop('disabled', currentMoveIndex <= -1);
  $('#btnPrev').prop('disabled', currentMoveIndex <= -1);
  $('#btnNext').prop('disabled', currentMoveIndex >= analyzedMoves.length - 1);
  $('#btnLast').prop('disabled', currentMoveIndex >= analyzedMoves.length - 1);
}

// ALL BUTTON BINDINGS INSIDE document.ready — THIS FIXES THE BUTTONS
$(document).ready(function() {
  $('#btnFirst').click(function() { if (!isAnalyzing) { jumpToMove(-1); if (isPlaying) togglePlay(); } });
  $('#btnPrev').click(function() { if (!isAnalyzing) { jumpToMove(currentMoveIndex - 1); if (isPlaying) togglePlay(); } });
  $('#btnNext').click(function() { if (!isAnalyzing) { jumpToMove(currentMoveIndex + 1); if (isPlaying) togglePlay(); } });
  $('#btnLast').click(function() { if (!isAnalyzing) { jumpToMove(analyzedMoves.length - 1); if (isPlaying) togglePlay(); } });
  $('#btnPlay').click(function() { if (!isAnalyzing && analyzedMoves.length > 0) togglePlay(); });

  $('#btnFlip').click(function() {
    boardFlipped = !boardFlipped;
    board.flip();
    clearOverlays();
    if (currentMoveIndex >= 0 && analyzedMoves[currentMoveIndex]) {
      const data = analyzedMoves[currentMoveIndex];
      addBadgeToSquare(data.moveObj.to, data.classification);
      if (!['Best', 'Brilliant', 'Book'].includes(data.classification.label) && data.bestMove.from && data.bestMove.to) {
        drawEngineArrow(data.bestMove.from, data.bestMove.to);
      }
      updateEvalBar(data.evalCp, data.mate);
    }
  });

  $('#tabReviewBtn').click(function() {
    $('.tab-btn').removeClass('active');
    $(this).addClass('active');
    currentTab = 'review';
    if (analyzedMoves.length > 0) $('#summaryCard').show();
    $('#results').hide();
  });

  $('#tabAnalysisBtn').click(function() {
    $('.tab-btn').removeClass('active');
    $(this).addClass('active');
    currentTab = 'analysis';
    $('#summaryCard').hide();
    $('#results').css('display', 'flex');
  });

  document.addEventListener('keydown', function(e) {
    if (isAnalyzing || analyzedMoves.length === 0) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); jumpToMove(currentMoveIndex - 1); if (isPlaying) togglePlay(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); jumpToMove(currentMoveIndex + 1); if (isPlaying) togglePlay(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); jumpToMove(-1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); jumpToMove(analyzedMoves.length - 1); }
  });
});

function getEvalAndBestMove(fen, depth) {
  return new Promise((resolve) => {
    let cp = null, mate = null, bestFrom = null, bestTo = null;
    const sideToMoveIsWhite = fen.split(' ')[1] === 'w';
    const onMessage = (event) => {
      const line = event.data;
      if (line.includes('score cp')) {
        const m = line.match(/score cp (-?\d+)/);
        if (m) cp = sideToMoveIsWhite ? parseInt(m[1], 10) : -parseInt(m[1], 10);
      } else if (line.includes('score mate')) {
        const m = line.match(/score mate (-?\d+)/);
        if (m) mate = sideToMoveIsWhite ? parseInt(m[1], 10) : -parseInt(m[1], 10);
      }
      if (line.startsWith('bestmove')) {
        const parts = line.split(' ');
        if (parts[1] && parts[1] !== '(none)') {
          bestFrom = parts[1].substring(0, 2);
          bestTo = parts[1].substring(2, 4);
        }
        stockfishWorker.removeEventListener('message', onMessage);
        resolve({ cp, mate, from: bestFrom, to: bestTo });
      }
    };
    stockfishWorker.addEventListener('message', onMessage);
    stockfishWorker.postMessage('position fen ' + fen);
    stockfishWorker.postMessage('go depth ' + depth);
  });
}

document.getElementById('analyzeBtn').addEventListener('click', async () => {
  const pgn = document.getElementById('pgnInput').value.trim();
  const resultsDiv = document.getElementById('results');
  if (!pgn || !stockfishWorker || isAnalyzing) return;
  game.reset();
  if (!game.load_pgn(pgn)) { alert('Invalid PGN.'); return; }
  const moves = game.history({ verbose: true });
  if (!moves.length) return;
  if (isPlaying) togglePlay();

  analyzedMoves = []; currentMoveIndex = -1; clearOverlays();
  document.getElementById('summaryCard').style.display = 'none';
  isAnalyzing = true;
  document.getElementById('analyzeBtn').disabled = true;

  const progressWrapper = document.getElementById('progressWrapper');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  progressWrapper.style.display = 'block';
  resultsDiv.innerHTML = '';

  const counts = {
    white: { Brilliant:0, Best:0, Excellent:0, Good:0, Book:0, Inaccuracy:0, Mistake:0, Blunder:0 },
    black: { Brilliant:0, Best:0, Excellent:0, Good:0, Book:0, Inaccuracy:0, Mistake:0, Blunder:0 }
  };
  const accSamples = { white: [], black: [] };
  let testGame = new Chess();
  const DEPTH = 10;

  let prevEvalData = await getEvalAndBestMove(testGame.fen(), DEPTH);

  for (let i = 0; i < moves.length; i++) {
    const percent = Math.round(((i + 1) / moves.length) * 100);
    progressBar.style.width = percent + '%';
    progressText.innerText = 'Analyzing move ' + (i + 1) + ' of ' + moves.length;

    const isWhiteMove = (i % 2 === 0);
    const isBook = i < 4;
    const playedUci = moves[i].from + moves[i].to;
    const isTopEngineMove = !!(prevEvalData.from && prevEvalData.to && (prevEvalData.from + prevEvalData.to) === playedUci);

    testGame.move(moves[i]);
    board.position(testGame.fen());
    const newEvalData = await getEvalAndBestMove(testGame.fen(), DEPTH);

    let cpBefore = prevEvalData.mate !== null ? (prevEvalData.mate > 0 ? 10000 : -10000) : (prevEvalData.cp || 0);
    let cpAfter = newEvalData.mate !== null ? (newEvalData.mate > 0 ? 10000 : -10000) : (newEvalData.cp || 0);
    const cpLoss = isWhiteMove ? Math.max(0, cpBefore - cpAfter) : Math.max(0, cpAfter - cpBefore);

    const isSac = isPieceHangingAfterMove(testGame.fen(), moves[i].to) && cpLoss < 80 && pieceValue(moves[i].piece) >= 3;
    const classification = classifyMove(cpLoss, isSac, isTopEngineMove, isBook);
    const moveAcc = isBook ? 100 : Math.max(0, Math.min(100, 103.16 - 3.16 * Math.exp(0.04 * cpLoss)));

    if (isWhiteMove) accSamples.white.push(moveAcc); else accSamples.black.push(moveAcc);
    counts[isWhiteMove ? 'white' : 'black'][classification.label]++;

    analyzedMoves.push({ moveObj: moves[i], classification, bestMove: prevEvalData, evalCp: cpAfter, mate: newEvalData.mate });

    const rowNum = Math.floor(i / 2) + 1;
    let appendTarget = resultsDiv.querySelector('.move-turn-block[data-row="' + rowNum + '"]');
    if (!appendTarget) {
      appendTarget = document.createElement('div');
      appendTarget.className = 'move-turn-block';
      appendTarget.setAttribute('data-row', rowNum);
      appendTarget.innerHTML = '<span class="turn-index-prefix">' + rowNum + '.</span><div class="w-box"></div><div class="b-box"></div>';
      resultsDiv.appendChild(appendTarget);
    }
    const rowItem = document.createElement('div');
    rowItem.className = 'move-eval-row ' + classification.cls;
    rowItem.setAttribute('data-idx', i);
    rowItem.innerHTML = '<span class="san-text">' + moves[i].san + '</span><span class="badge-icon">' + classification.icon + '</span>';
    rowItem.addEventListener('click', function() { jumpToMove(parseInt(this.getAttribute('data-idx'), 10)); });
    appendTarget.querySelector(isWhiteMove ? '.w-box' : '.b-box').appendChild(rowItem);

    clearOverlays();
    addBadgeToSquare(moves[i].to, classification);
    if (prevEvalData.from && prevEvalData.to && !isTopEngineMove) {
      drawEngineArrow(prevEvalData.from, prevEvalData.to);
    }

    prevEvalData = newEvalData;
  }

  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 80;
  const whiteAcc = avg(accSamples.white);
  const blackAcc = avg(accSamples.black);

  document.getElementById('whiteAccuracy').innerText = whiteAcc.toFixed(1) + '%';
  document.getElementById('blackAccuracy').innerText = blackAcc.toFixed(1) + '%';
  document.getElementById('whiteRating').innerText = calculatePerformanceRating(whiteAcc);
  document.getElementById('blackRating').innerText = calculatePerformanceRating(blackAcc);

  const order = ['Brilliant', 'Best', 'Excellent', 'Good', 'Book', 'Inaccuracy', 'Mistake', 'Blunder'];
  document.getElementById('breakdown-body').innerHTML = order.map(label =>
    '<tr class="matrix-row"><td class="lbl-cell"><span class="matrix-badge-dot circle-' + label.toLowerCase() + '"></span>' + label + '</td><td class="count-val">' + counts.white[label] + '</td><td class="count-val">' + counts.black[label] + '</td></tr>'
  ).join('');

  progressWrapper.style.display = 'none';
  document.getElementById('setupBox').style.display = 'none';
  isAnalyzing = false;
  document.getElementById('analyzeBtn').disabled = false;
  document.getElementById('summaryCard').style.display = 'flex';

  $('#tabReviewBtn').click();
  jumpToMove(moves.length - 1);
});

function isPieceHangingAfterMove(fen, sq) {
  try { return new Chess(fen).moves({ verbose: true }).some(m => m.to === sq && m.captured); }
  catch(e) { return false; }
}

function pieceValue(t) {
  return { p:1, n:3, b:3, r:5, q:9, k:0 }[t] || 0;
}
