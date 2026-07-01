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
window.addEventListener('load', resizeSvgOverlay);
setTimeout(resizeSvgOverlay, 500);

async function loadStockfish() {
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = "<div class='info-msg'>Setting up chess engine worker...</div>";
  try {
    const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const code = await response.text();
    const blob = new Blob([code], { type: 'application/javascript' });
    stockfishWorker = new Worker(URL.createObjectURL(blob));
    resultsDiv.innerHTML = "<div class='info-msg success-msg'>Engine status initialized. Ready for PGN.</div>";
  } catch (err) {
    resultsDiv.innerHTML = "<div class='info-msg error-msg'>Engine failure: " + err.message + "</div>";
  }
}
loadStockfish();

function updateEvalBar(cp, mate) {
  const fill = document.getElementById('evalBarFill');
  const label = document.getElementById('evalBarLabel');
  if (!fill || !label) return;

  let pct = 50;
  let text = '0.0';

  if (mate !== null) {
    pct = mate > 0 ? 100 : 0;
    text = 'M' + Math.abs(mate);
  } else {
    let score = cp / 100;
    text = (score > 0 ? '+' : '') + score.toFixed(1);
    
    // Smooth standard compression sigmoid lookup
    pct = 50 + (50 * (2 / (1 + Math.exp(-0.3 * score)) - 1));
    pct = Math.max(5, Math.min(95, pct));
  }

  if (boardFlipped) pct = 100 - pct;

  fill.style.height = `${pct}%`;
  label.innerText = text;
}

function calculateEloPerformance(accuracy) {
  // Logistic regression matching reference performance curve configurations
  return Math.round(600 + (1950 / (1 + Math.exp(-0.07 * (accuracy - 72)))));
}

function cpToWinPercent(cp) {
  if (cp === null || cp === undefined) return 50;
  if (Math.abs(cp) > 2000) cp = cp > 0 ? 2000 : -2000;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function evalToWinPercent(evalData) {
  if (evalData.mate !== null && evalData.mate !== undefined) {
    return evalData.mate > 0 ? 100 : 0;
  }
  return cpToWinPercent(evalData.cp);
}

function moveAccuracyFromWinPercentDrop(winPercentBefore, winPercentAfter, isWhiteMove) {
  const drop = isWhiteMove ? (winPercentBefore - winPercentAfter) : (winPercentAfter - winPercentBefore);
  const clampedDrop = Math.max(0, drop);
  const acc = 103.1668 * Math.exp(-0.04354 * clampedDrop) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

function classifyMove(cpLossForMover, isSacrifice, isTopEngineMove, isBook) {
  if (isBook) return { label: 'Book', cls: 'bg-book', icon: '📖' };
  if (isSacrifice && cpLossForMover <= 35) return { label: 'Brilliant', cls: 'bg-brilliant', icon: '!!' };
  if (isTopEngineMove) return { label: 'Best', cls: 'bg-best', icon: '✓' };
  if (cpLossForMover < 45) return { label: 'Excellent', cls: 'bg-excellent', icon: '✓' };
  if (cpLossForMover < 90) return { label: 'Good', cls: 'bg-good', icon: '✓' };
  if (cpLossForMover < 180) return { label: 'Inaccuracy', cls: 'bg-inaccuracy', icon: '?!' };
  if (cpLossForMover < 320) return { label: 'Mistake', cls: 'bg-mistake', icon: '?' };
  return { label: 'Blunder', cls: 'bg-blunder', icon: '??' };
}

function updateCoachCard(data) {
  const title = document.getElementById('coachTitle');
  const text = document.getElementById('coachText');
  if (!title || !text || !data) return;

  const isWhite = (currentMoveIndex % 2 === 0);
  const player = isWhite ? 'White' : 'Black';
  const label = data.classification.label;

  title.innerText = `${player} played ${data.moveObj.san}`;
  
  switch(label) {
    case 'Brilliant':
      text.innerText = `An absolute masterclass transition find. This sacrifice transforms the structural dynamic of the square matrix paths entirely.`;
      break;
    case 'Best':
    case 'Excellent':
      text.innerText = `A perfectly aligned developmental engine move that maintains concrete tactical pressure across active tactical threat corridors.`;
      break;
    case 'Good':
      text.innerText = `A solid defensive or territorial option, keeping spatial configurations balanced and avoiding lines of attack.`;
      break;
    case 'Inaccuracy':
      text.innerText = `Slight deviation from the target setup engine pathway. Misses an opportunity to tighten tactical control in this key area.`;
      break;
    case 'Mistake':
      text.innerText = `A structural tracking error that surrenders strategic control over key lines. The pressure turns significantly against you here.`;
      break;
    case 'Blunder':
      text.innerText = `A serious oversight that leaves vital assets exposed or ignores an immediate forced structural threat path.`;
      break;
    default:
      text.innerText = `Analysis calculation parameters compiled. View the absolute vertical step index grid logs for move details.`;
  }
}

function addBadgeToSquare(square, classification) {
  $('.board-custom-badge').remove();
  const badgeHtml = `<div class="board-custom-badge ${classification.cls}">${classification.icon}</div>`;
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
  
  // Back out the pointer tip coordinate offset to balance layout flow line visually
  const arrowLengthReduction = 22;
  const targetX = to.x - arrowLengthReduction * Math.cos(angle);
  const targetY = to.y - arrowLengthReduction * Math.sin(angle);

  const markerId = 'arrow-marker-head';
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.appendChild(defs);
  }

  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', markerId);
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '6');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '5');
  marker.setAttribute('markerHeight', '5');
  marker.setAttribute('orient', 'auto-start-reverse');
  
  const pathHead = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  pathHead.setAttribute('d', 'M 0 1 L 10 5 L 0 9 z');
  pathHead.setAttribute('fill', '#f7941d');
  marker.appendChild(pathHead);
  defs.appendChild(marker);

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', from.x);
  line.setAttribute('y1', from.y);
  line.setAttribute('x2', targetX);
  line.setAttribute('y2', targetY);
  line.setAttribute('stroke', '#f7941d');
  line.setAttribute('stroke-width', '11');
  line.setAttribute('opacity', '0.78');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('marker-end', `url(#${markerId})`);

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

  if (data.classification.label !== 'Best' && data.classification.label !== 'Brilliant' && data.bestMove.from && data.bestMove.to) {
    setTimeout(() => { drawEngineArrow(data.bestMove.from, data.bestMove.to); }, 40);
  }

  const $el = $(`.move-eval-row[data-idx="${index}"]`);
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
    }, 1200);
  }
}

$('#btnFlip').click(() => {
  boardFlipped = !boardFlipped;
  board.flip();
  clearOverlays();
  if (currentMoveIndex >= 0 && analyzedMoves[currentMoveIndex]) {
    const data = analyzedMoves[currentMoveIndex];
    addBadgeToSquare(data.moveObj.to, data.classification);
    if (data.classification.label !== 'Best' && data.classification.label !== 'Brilliant' && data.bestMove.from && data.bestMove.to) {
      drawEngineArrow(data.bestMove.from, data.bestMove.to);
    }
    updateEvalBar(data.evalCp, data.mate);
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
});

// Setup tab routing switches
$('#tabReviewBtn').click(function() {
  $('.tab-btn').removeClass('active'); $(this).addClass('active');
  currentTab = 'review';
  $('#summaryCard').show();
  $('#results').hide();
});

$('#tabAnalysisBtn').click(function() {
  $('.tab-btn').removeClass('active'); $(this).addClass('active');
  currentTab = 'analysis';
  $('#summaryCard').hide();
  $('#results').show();
});

function getEvalAndBestMove(fen, depth) {
  return new Promise((resolve) => {
    let cp = null, mate = null, bestFrom = null, bestTo = null;
    const sideToMoveIsWhite = fen.split(' ')[1] === 'w';

    const onMessage = (event) => {
      const line = event.data;
      if (line.includes('score cp')) {
        const cpMatch = line.match(/score cp (-?\d+)/);
        if (cpMatch) {
          let score = parseInt(cpMatch[1], 10);
          cp = sideToMoveIsWhite ? score : -score;
        }
      } else if (line.includes('score mate')) {
        const mateMatch = line.match(/score mate (-?\d+)/);
        if (mateMatch) {
          let m = parseInt(mateMatch[1], 10);
          mate = sideToMoveIsWhite ? m : -m;
        }
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

  if (!pgn) return;
  if (!stockfishWorker || isAnalyzing) return;

  game.reset();
  if (!game.load_pgn(pgn)) {
    alert("Invalid PGN context tracking mapping error.");
    return;
  }

  const moves = game.history({ verbose: true });
  if (moves.length === 0) return;
  if (isPlaying) togglePlay();

  analyzedMoves = [];
  currentMoveIndex = -1;
  clearOverlays();
  
  isAnalyzing = true;
  document.getElementById('analyzeBtn').disabled = true;
  $('#summaryCard').hide();

  const progressWrapper = document.getElementById('progressWrapper');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  
  progressWrapper.style.display = 'block';
  resultsDiv.innerHTML = '';

  const counts = {
    white: { Brilliant: 0, Best: 0, Excellent: 0, Good: 0, Book: 0, Inaccuracy: 0, Mistake: 0, Blunder: 0 },
    black: { Brilliant: 0, Best: 0, Excellent: 0, Good: 0, Book: 0, Inaccuracy: 0, Mistake: 0, Blunder: 0 }
  };
  const accSamples = { white: [], black: [] };

  let testGame = new Chess();
  const DEPTH = 10; // Optimized analysis execution speed threshold

  let prevEvalData = await getEvalAndBestMove(testGame.fen(), DEPTH);
  let prevWinPct = evalToWinPercent(prevEvalData);

  for (let i = 0; i < moves.length; i++) {
    const percent = Math.round(((i + 1) / moves.length) * 100);
    progressBar.style.width = percent + '%';
    progressText.innerText = `Analyzing Loop: Move ${i+1}/${moves.length}`;

    const isWhiteMove = (i % 2 === 0);
    const isBook = i < 5; 

    const playedUci = moves[i].from + moves[i].to;
    const isTopEngineMove = prevEvalData.from && prevEvalData.to && (prevEvalData.from + prevEvalData.to) === playedUci;

    testGame.move(moves[i]);

    const newEvalData = await getEvalAndBestMove(testGame.fen(), DEPTH);
    const newWinPct = evalToWinPercent(newEvalData);

    let cpBefore = prevEvalData.mate !== null ? (prevEvalData.mate > 0 ? 100000 : -100000) : (prevEvalData.cp || 0);
    let cpAfter = newEvalData.mate !== null ? (newEvalData.mate > 0 ? 100000 : -100000) : (newEvalData.cp || 0);
    const cpLossForMover = isWhiteMove ? Math.max(0, cpBefore - cpAfter) : Math.max(0, cpAfter - cpBefore);

    const isSacrifice = (!isWhiteMove && moves[i].captured && ['q','r','b','n'].includes(moves[i].captured));

    const classification = classifyMove(cpLossForMover, isSacrifice, isTopEngineMove, isBook);
    const moveAcc = isBook ? 100 : moveAccuracyFromWinPercentDrop(prevWinPct, newWinPct, isWhiteMove);
    
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

    // Append table record row context matching Chess.com structural index paragraphs
    const rowNum = Math.floor(i / 2) + 1;
    let appendTarget = resultsDiv.querySelector(`.move-turn-block[data-row="${rowNum}"]`);
    if (!appendTarget) {
      appendTarget = document.createElement('div');
      appendTarget.className = 'move-turn-block';
      appendTarget.setAttribute('data-row', rowNum);
      appendTarget.innerHTML = `<span class="turn-index-prefix">${rowNum}.</span><div class="white-box-target"></div><div class="black-box-target"></div>`;
      resultsDiv.appendChild(appendTarget);
    }

    const rowItem = document.createElement('div');
    rowItem.className = `move-eval-row ${classification.cls}`;
    rowItem.setAttribute('data-idx', i);
    rowItem.innerHTML = `<span class="san-text">${moves[i].san}</span><span class="badge-icon">${classification.icon}</span>`;
    rowItem.addEventListener('click', function() { jumpToMove(parseInt(this.getAttribute('data-idx'), 10)); });

    if (isWhiteMove) {
      appendTarget.querySelector('.white-box-target').appendChild(rowItem);
    } else {
      appendTarget.querySelector('.black-box-target').appendChild(rowItem);
    }

    prevEvalData = newEvalData;
    prevWinPct = newWinPct;
  }

  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 95.0;
  const whiteAccuracy = avg(accSamples.white);
  const blackAccuracy = avg(accSamples.black);

  document.getElementById('whiteAccuracy').innerText = whiteAccuracy.toFixed(1) + '%';
  document.getElementById('blackAccuracy').innerText = blackAccuracy.toFixed(1) + '%';
  document.getElementById('whiteRating').innerText = calculateEloPerformance(whiteAccuracy);
  document.getElementById('blackRating').innerText = calculateEloPerformance(blackAccuracy);

  const order = ['Brilliant', 'Best', 'Excellent', 'Good', 'Book', 'Inaccuracy', 'Mistake', 'Blunder'];
  const tbody = document.getElementById('breakdown-body');
  tbody.innerHTML = order.map(label => `
    <tr class="matrix-row">
      <td class="lbl-cell"><span class="matrix-badge-dot circle-${label.toLowerCase()}"></span>${label}</td>
      <td class="count-val">${counts.white[label]}</td>
      <td class="count-val">${counts.black[label]}</td>
    </tr>`).join('');

  progressWrapper.style.display = 'none';
  document.getElementById('setupBox').style.display = 'none';
  
  isAnalyzing = false;
  document.getElementById('analyzeBtn').disabled = false;

  $('#tabReviewBtn').click();
  jumpToMove(moves.length - 1);
});
