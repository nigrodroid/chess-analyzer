const game = new Chess();
let analyzedMoves = [];
let currentMoveIndex = -1;
let isPlaying = false;
let playInterval = null;
let stockfishWorker = null;
let isAnalyzing = false;
let boardFlipped = false;

let board = Chessboard('board', {
  pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
  position: 'start',
  draggable: false
});

function resizeCanvas() {
  const canvas = document.getElementById('arrowCanvas');
  const boardEl = document.getElementById('board');
  if (canvas && boardEl) {
    canvas.width = boardEl.clientWidth;
    canvas.height = boardEl.clientHeight;
  }
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', resizeCanvas);
setTimeout(resizeCanvas, 500);

async function loadStockfish() {
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = "<div style='padding:15px;text-align:center;'>Setting up engine...</div>";
  try {
    const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const code = await response.text();
    const blob = new Blob([code], { type: 'application/javascript' });
    stockfishWorker = new Worker(URL.createObjectURL(blob));
    resultsDiv.innerHTML = "<div style='padding:15px;text-align:center;color:#81b64c;'>Ready for analysis.</div>";
  } catch (err) {
    resultsDiv.innerHTML = "<div style='padding:15px;text-align:center;color:#ff5555;'>Engine failed to load: " + err.message + "</div>";
  }
}
loadStockfish();

function cpToWinPercent(cp) {
  if (cp === null || cp === undefined) return 50;
  if (Math.abs(cp) > 2000) cp = cp > 0 ? 2000 : -2000;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function mateToWinPercent(mateIn) {
  return mateIn > 0 ? 100 : 0;
}

function evalToWinPercent(evalData) {
  if (evalData.mate !== null && evalData.mate !== undefined) {
    return mateToWinPercent(evalData.mate);
  }
  return cpToWinPercent(evalData.cp);
}

function moveAccuracyFromWinPercentDrop(winPercentBefore, winPercentAfter, isWhiteMove) {
  const drop = isWhiteMove ? (winPercentBefore - winPercentAfter) : (winPercentAfter - winPercentBefore);
  const clampedDrop = Math.max(0, drop);
  const acc = 103.1668 * Math.exp(-0.04354 * clampedDrop) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

function classifyMove(cpLossForMover, isSacrifice, isOnlyGoodMove, isBookMove, isTheTopEngineMove) {
  if (isBookMove) return { label: 'Book', cls: 'bg-book' };
  if (isSacrifice && cpLossForMover <= 30) return { label: 'Brilliant', cls: 'bg-brilliant' };
  if (isOnlyGoodMove && cpLossForMover <= 30) return { label: 'Great', cls: 'bg-great' };
  if (isTheTopEngineMove) return { label: 'Best', cls: 'bg-best' };
  if (cpLossForMover < 50) return { label: 'Excellent', cls: 'bg-excellent' };
  if (cpLossForMover < 100) return { label: 'Good', cls: 'bg-good' };
  if (cpLossForMover < 300) return { label: 'Inaccuracy', cls: 'bg-inaccuracy' };
  if (cpLossForMover < 500) return { label: 'Mistake', cls: 'bg-mistake' };
  return { label: 'Blunder', cls: 'bg-blunder' };
}

function pieceValue(type) {
  const vals = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  return vals[type] || 0;
}

function countMaterial(fen) {
  const board = fen.split(' ')[0];
  let white = 0, black = 0;
  for (const ch of board) {
    if (/[A-Z]/.test(ch) && ch !== 'K') white += pieceValue(ch.toLowerCase());
    else if (/[a-z]/.test(ch) && ch !== 'k') black += pieceValue(ch);
  }
  return { white, black };
}

function isPieceHangingAfterMove(fenAfterMove, toSquare, isWhiteMoved) {
  try {
    const c = new Chess(fenAfterMove);
    const opponentMoves = c.moves({ verbose: true });
    return opponentMoves.some(m => m.to === toSquare && m.captured);
  } catch (e) {
    return false;
  }
}

function addBadgeToSquare(square, label) {
  $('.board-custom-badge').remove();
  const colors = {
    Brilliant: '#1baca6', Great: '#5c8bb0', Best: '#81b64c', Excellent: '#6fa84a',
    Good: '#4b643a', Book: '#a88865', Inaccuracy: '#f0c15c', Mistake: '#e67e22',
    Miss: '#d65c5c', Blunder: '#b33925'
  };
  const symbols = {
    Brilliant: '!!', Great: '!', Best: '✓', Excellent: '✓', Good: '✓',
    Book: '📖', Inaccuracy: '?!', Mistake: '?', Miss: '✗', Blunder: '??'
  };
  const color = colors[label] || '#888';
  const symbol = symbols[label] || '';
  const textColor = (label === 'Inaccuracy') ? '#000' : '#fff';
  const badgeHtml = `<div class="board-custom-badge" style="background-color:${color};color:${textColor};">${symbol}</div>`;
  $('.square-' + square).css('position', 'relative').append(badgeHtml);
}

function drawArrow(fromSquare, toSquare, color) {
  const canvas = document.getElementById('arrowCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  resizeCanvas();
  const files = boardFlipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
  const ranks = boardFlipped ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1'];
  const sqW = canvas.width / 8, sqH = canvas.height / 8;
  const center = (sq) => ({
    x: files.indexOf(sq[0]) * sqW + sqW / 2,
    y: ranks.indexOf(sq[1]) * sqH + sqH / 2
  });
  const from = center(fromSquare), to = center(toSquare);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - 18 * Math.cos(angle - Math.PI/6), to.y - 18 * Math.sin(angle - Math.PI/6));
  ctx.lineTo(to.x - 18 * Math.cos(angle + Math.PI/6), to.y - 18 * Math.sin(angle + Math.PI/6));
  ctx.closePath(); ctx.fill();
}

function clearBadgesAndArrows() {
  $('.board-custom-badge').remove();
  const canvas = document.getElementById('arrowCanvas');
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

function jumpToMove(index) {
  if (index < -1 || index >= analyzedMoves.length) return;
  currentMoveIndex = index;
  game.reset();
  clearBadgesAndArrows();
  $('.move-eval').removeClass('active-move');

  if (index === -1) {
    board.position('start');
    updateNavButtonStates();
    return;
  }
  for (let i = 0; i <= index; i++) game.move(analyzedMoves[i].moveObj);
  board.position(game.fen());

  const $el = $(`.move-eval[data-idx="${index}"]`);
  $el.addClass('active-move');
  const container = document.getElementById('results');
  if (container && $el.length) {
    container.scrollTop = $el.position().top + container.scrollTop - container.clientHeight / 2;
  }

  const data = analyzedMoves[index];
  addBadgeToSquare(data.moveObj.to, data.classification.label);
  if (data.bestMove.from && data.bestMove.to && data.classification.label !== 'Best' && data.classification.label !== 'Brilliant') {
    setTimeout(() => { drawArrow(data.bestMove.from, data.bestMove.to, 'rgba(230,126,34,0.72)'); }, 50);
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
    }, 1000);
  }
}

$('#btnFlip').click(() => {
  boardFlipped = !boardFlipped;
  board.flip();
  clearBadgesAndArrows();
  if (currentMoveIndex >= 0 && analyzedMoves[currentMoveIndex]) {
    const data = analyzedMoves[currentMoveIndex];
    addBadgeToSquare(data.moveObj.to, data.classification.label);
    if (data.bestMove.from && data.bestMove.to && data.classification.label !== 'Best' && data.classification.label !== 'Brilliant') {
      drawArrow(data.bestMove.from, data.bestMove.to, 'rgba(230,126,34,0.72)');
    }
  }
});

function updateNavButtonStates() {
  $('#btnFirst').prop('disabled', currentMoveIndex <= -1);
  $('#btnPrev').prop('disabled', currentMoveIndex <= -1);
  $('#btnNext').prop('disabled', currentMoveIndex >= analyzedMoves.length - 1);
  $('#btnLast').prop('disabled', currentMoveIndex >= analyzedMoves.length - 1);
}

$('#btnFirst').click(() => { if (!isAnalyzing) { jumpToMove(-1); if (isPlaying) togglePlay(); } });
$('#btnPrev').click(() => { if (!isAnalyzing) { jumpToMove(currentMoveIndex - 1); if (isPlaying) togglePlay(); } });
$('#btnNext').click(() => { if (!isAnalyzing) { jumpToMove(currentMoveIndex + 1); if (isPlaying) togglePlay(); } });
$('#btnLast').click(() => { if (!isAnalyzing) { jumpToMove(analyzedMoves.length - 1); if (isPlaying) togglePlay(); } });
$('#btnPlay').click(() => { if (!isAnalyzing && analyzedMoves.length > 0) togglePlay(); });

document.addEventListener('keydown', (e) => {
  if (isAnalyzing || analyzedMoves.length === 0) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); jumpToMove(currentMoveIndex - 1); if (isPlaying) togglePlay(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); jumpToMove(currentMoveIndex + 1); if (isPlaying) togglePlay(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); jumpToMove(-1); if (isPlaying) togglePlay(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); jumpToMove(analyzedMoves.length - 1); if (isPlaying) togglePlay(); }
});

function getEvalAndBestMove(fen, depth) {
  return new Promise((resolve) => {
    let cp = null, mate = null, bestFrom = null, bestTo = null;
    const sideToMoveIsWhite = fen.split(' ')[1] === 'w';

    const onMessage = (event) => {
      const line = event.data;
      const cpMatch = line.match(/score cp (-?\d+)/);
      if (cpMatch) {
        let score = parseInt(cpMatch[1], 10);
        cp = sideToMoveIsWhite ? score : -score;
        mate = null;
      }
      const mateMatch = line.match(/score mate (-?\d+)/);
      if (mateMatch) {
        let m = parseInt(mateMatch[1], 10);
        mate = sideToMoveIsWhite ? m : -m;
        cp = null;
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

  if (!pgn) { alert('Paste a PGN first!'); return; }
  if (!stockfishWorker) { alert('Engine is still loading, please wait a moment.'); return; }
  if (isAnalyzing) return;

  game.reset();
  if (!game.load_pgn(pgn)) {
    resultsDiv.innerHTML = "<div style='padding:15px;color:#ff5555;'>Invalid PGN format.</div>";
    return;
  }

  const moves = game.history({ verbose: true });
  if (moves.length === 0) return;
  if (isPlaying) togglePlay();

  analyzedMoves = [];
  currentMoveIndex = -1;
  clearBadgesAndArrows();
  document.getElementById('summaryCard').style.display = 'none';
  isAnalyzing = true;
  document.getElementById('analyzeBtn').disabled = true;

  const progressWrapper = document.getElementById('progressWrapper');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  progressWrapper.style.display = 'block';
  resultsDiv.innerHTML = '';

  const counts = {
    white: { Brilliant: 0, Great: 0, Best: 0, Excellent: 0, Good: 0, Book: 0, Inaccuracy: 0, Mistake: 0, Blunder: 0 },
    black: { Brilliant: 0, Great: 0, Best: 0, Excellent: 0, Good: 0, Book: 0, Inaccuracy: 0, Mistake: 0, Blunder: 0 }
  };
  const accSamples = { white: [], black: [] };

  let testGame = new Chess();
  const DEPTH = 12;

  let prevEvalData = await getEvalAndBestMove(testGame.fen(), DEPTH);
  let prevWinPct = evalToWinPercent(prevEvalData);
  let prevMaterial = countMaterial(testGame.fen());

  for (let i = 0; i < moves.length; i++) {
    const percent = Math.round(((i + 1) / moves.length) * 100);
    progressBar.style.width = percent + '%';
    progressText.innerText = `Reviewing (${percent}%)`;

    const isWhiteMove = (i % 2 === 0);
    const isBookMove = i < 6;

    const playedUci = moves[i].from + moves[i].to + (moves[i].promotion || '');
    const isTopEngineMove = prevEvalData.from && prevEvalData.to &&
      (prevEvalData.from + prevEvalData.to) === (moves[i].from + moves[i].to);

    testGame.move(moves[i]);

    const newEvalData = await getEvalAndBestMove(testGame.fen(), DEPTH);
    const newWinPct = evalToWinPercent(newEvalData);
    const newMaterial = countMaterial(testGame.fen());

    let cpBefore = prevEvalData.mate !== null ? (prevEvalData.mate > 0 ? 100000 : -100000) : (prevEvalData.cp || 0);
    let cpAfter = newEvalData.mate !== null ? (newEvalData.mate > 0 ? 100000 : -100000) : (newEvalData.cp || 0);
    const cpLossForMover = isWhiteMove ? Math.max(0, cpBefore - cpAfter) : Math.max(0, cpAfter - cpBefore);

    const pieceNowHanging = isPieceHangingAfterMove(testGame.fen(), moves[i].to, isWhiteMove);
    const isSacrifice = pieceNowHanging && cpLossForMover < 80 && pieceValue(moves[i].piece) >= 3;

    const isOnlyGoodMove = false;

    const classification = classifyMove(cpLossForMover, isSacrifice, isOnlyGoodMove, isBookMove, isTopEngineMove);

    const moveAcc = isBookMove ? 100 : moveAccuracyFromWinPercentDrop(prevWinPct, newWinPct, isWhiteMove);
    if (isWhiteMove) accSamples.white.push(moveAcc); else accSamples.black.push(moveAcc);

    const sideKey = isWhiteMove ? 'white' : 'black';
    counts[sideKey][classification.label]++;

    analyzedMoves.push({
      moveObj: moves[i],
      classification,
      bestMove: prevEvalData,
      evalCp: cpAfter,
      mate: newEvalData.mate
    });

    const moveDiv = document.createElement('div');
    moveDiv.className = 'move-eval';
    moveDiv.setAttribute('data-idx', i);
    const turnNum = Math.floor(i / 2) + 1;
    const prefix = isWhiteMove ? `${turnNum}. ` : `${turnNum}... `;
    const evalDisplay = newEvalData.mate !== null ? `M${newEvalData.mate}` : ((cpAfter / 100).toFixed(2) > 0 ? '+' : '') + (cpAfter / 100).toFixed(2);

    moveDiv.innerHTML = `
      <span class="move-text">${prefix}${moves[i].san}</span>
      <div class="badge-container">
        <span class="class-badge ${classification.cls}">${classification.label}</span>
        <span class="eval-badge">${evalDisplay}</span>
      </div>`;
    moveDiv.addEventListener('click', function () { jumpToMove(parseInt(this.getAttribute('data-idx'), 10)); });
    resultsDiv.appendChild(moveDiv);
    resultsDiv.scrollTop = resultsDiv.scrollHeight;

    prevEvalData = newEvalData;
    prevWinPct = newWinPct;
    prevMaterial = newMaterial;
  }

  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 100;
  const whiteAccuracy = avg(accSamples.white);
  const blackAccuracy = avg(accSamples.black);

  document.getElementById('whiteAccuracy').innerText = whiteAccuracy.toFixed(1) + '%';
  document.getElementById('blackAccuracy').innerText = blackAccuracy.toFixed(1) + '%';

  const order = ['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book', 'Inaccuracy', 'Mistake', 'Blunder'];
  const colorMap = {
    Brilliant: 'var(--cls-brilliant)', Great: 'var(--cls-great)', Best: 'var(--cls-best)',
    Excellent: 'var(--cls-excellent)', Good: 'var(--cls-good)', Book: 'var(--cls-book)',
    Inaccuracy: 'var(--cls-inaccuracy)', Mistake: 'var(--cls-mistake)', Blunder: 'var(--cls-blunder)'
  };
  const tbody = document.getElementById('breakdown-body');
  tbody.innerHTML = order.map(label => `
    <tr>
      <td><span class="dot" style="background:${colorMap[label]}"></span>${label}</td>
      <td class="count">${counts.white[label]}</td>
      <td class="count">${counts.black[label]}</td>
    </tr>`).join('');

  document.getElementById('summaryCard').style.display = 'flex';
  document.getElementById('summaryCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  progressWrapper.style.display = 'none';
  
  isAnalyzing = false; // Core Fix: unlocks UI controls
  document.getElementById('analyzeBtn').disabled = false;

  jumpToMove(moves.length - 1);
});
