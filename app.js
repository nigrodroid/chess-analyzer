// ===== Chess Game Analyzer — real Stockfish analysis =====
// Stockfish loads from a public CDN as a Web Worker. No data ever leaves the browser.

const PIECE_UNICODE = {
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
  P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔'
};

let game = null;
let history = [];          // SAN moves
let positions = [];        // FEN at each ply (index 0 = start)
let analysisResults = [];  // per-ply: { evalCp, bestMove, classification }
let currentPly = 0;
let playing = false;
let playTimer = null;
let stockfish = null;
let engineReady = false;
let dailyLimitKey = 'chessAnalyzer_lastUse';

const els = {
  pgnInput: document.getElementById('pgn-input'),
  analyzeBtn: document.getElementById('analyze-btn'),
  statusText: document.getElementById('status-text'),
  boardSection: document.getElementById('board-section'),
  board: document.getElementById('board'),
  moveList: document.getElementById('move-list'),
  moveCounter: document.getElementById('move-counter'),
  evalFill: document.getElementById('eval-fill'),
  evalScore: document.getElementById('eval-score'),
  classRow: document.getElementById('class-row'),
  classBadge: document.getElementById('class-badge'),
  bestMoveLine: document.getElementById('best-move-line'),
  whiteAcc: document.getElementById('white-acc'),
  blackAcc: document.getElementById('black-acc'),
  statBlunders: document.getElementById('stat-blunders'),
  statMistakes: document.getElementById('stat-mistakes'),
  statInaccuracies: document.getElementById('stat-inaccuracies'),
  statBest: document.getElementById('stat-best'),
  summaryText: document.getElementById('summary-text'),
  limitInfo: document.getElementById('limit-info'),
};

// ---------- Daily limit (client-side, free tier feel) ----------
function checkDailyLimit() {
  const last = localStorage.getItem(dailyLimitKey);
  const today = new Date().toDateString();
  if (last === today) {
    els.limitInfo.textContent = "You've used today's free review";
    els.analyzeBtn.disabled = true;
    els.statusText.textContent = 'Come back tomorrow for another free review.';
    return false;
  }
  return true;
}

function markUsedToday() {
  localStorage.setItem(dailyLimitKey, new Date().toDateString());
}

// ---------- Stockfish engine setup ----------
// Uses the official Stockfish.js lite single-threaded build (same engine family
// Chess.com sponsors/uses). No CORS headers or special server config needed.
const STOCKFISH_ENGINE_URL = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish-nnue-16-single.js';
const STOCKFISH_FALLBACK_URL = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';

function initEngine() {
  return new Promise((resolve) => {
    function tryLoad(url, onFail) {
      try {
        stockfish = new Worker(url);
      } catch (e) {
        onFail();
        return;
      }
      stockfish.onerror = onFail;
      stockfish.onmessage = function (e) {
        const line = typeof e === 'string' ? e : e.data;
        if (line === 'uciok' || (typeof line === 'string' && line.startsWith('id name'))) {
          engineReady = true;
        }
      };
      stockfish.postMessage('uci');
    }

    let failedOnce = false;
    tryLoad(STOCKFISH_ENGINE_URL, () => {
      if (failedOnce) return;
      failedOnce = true;
      tryLoad(STOCKFISH_FALLBACK_URL, () => {
        console.error('Could not load Stockfish engine from either source.');
      });
    });

    setTimeout(() => resolve(), 700); // give engine a moment to init
  });
}

function evaluatePosition(fen, depth = 14) {
  return new Promise((resolve) => {
    let bestMove = null;
    let evalCp = 0;
    let mate = null;

    const handler = function (e) {
      const line = typeof e === 'string' ? e : e.data;

      const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
      if (scoreMatch) {
        if (scoreMatch[1] === 'cp') {
          evalCp = parseInt(scoreMatch[2], 10);
          mate = null;
        } else {
          mate = parseInt(scoreMatch[2], 10);
        }
      }

      if (line.startsWith('bestmove')) {
        bestMove = line.split(' ')[1];
        stockfish.removeEventListener('message', handler);
        resolve({ evalCp, mate, bestMove });
      }
    };

    stockfish.addEventListener('message', handler);
    stockfish.postMessage('position fen ' + fen);
    stockfish.postMessage('go depth ' + depth);
  });
}

// ---------- PGN parsing using chess.js ----------
function parseGame(pgnText) {
  const chess = new Chess();
  const ok = chess.load_pgn(pgnText, { sloppy: true });
  if (!ok) return null;

  const moveHistory = chess.history();
  const replay = new Chess();
  const fens = [replay.fen()];
  for (const san of moveHistory) {
    replay.move(san, { sloppy: true });
    fens.push(replay.fen());
  }
  return { moves: moveHistory, fens };
}

// ---------- Classification (Chess.com-style labels) ----------
function classifyMove(prevEvalCp, newEvalCp, isWhiteMove, plyIndex, wasBestMove) {
  if (plyIndex < 6) return 'book';

  // Convert eval to "from mover's perspective" loss
  const lossCp = isWhiteMove ? (prevEvalCp - newEvalCp) : (newEvalCp - prevEvalCp);

  if (wasBestMove && lossCp <= 0) return 'best';
  if (lossCp >= 300) return 'blunder';
  if (lossCp >= 130) return 'mistake';
  if (lossCp >= 50) return 'inaccuracy';
  if (lossCp <= -150) return 'brilliant'; // dramatic improvement, e.g. a sacrifice that works
  if (lossCp <= -60) return 'great';
  if (lossCp <= 10) return 'excellent';
  return 'good';
}

// ---------- Full game analysis ----------
function sanToUci(fenBefore, sanMove) {
  // Use chess.js to convert SAN to a UCI-like from-to string for comparison with engine bestmove
  const c = new Chess(fenBefore);
  const moveObj = c.move(sanMove, { sloppy: true });
  if (!moveObj) return null;
  return moveObj.from + moveObj.to + (moveObj.promotion || '');
}

async function analyzeFullGame(fens, moves) {
  analysisResults = [{ evalCp: 0, mate: null, bestMove: null, classification: null }];
  els.statusText.textContent = 'Analyzing move 1 of ' + moves.length + '...';

  let prevEval = 0;
  for (let i = 0; i < moves.length; i++) {
    els.statusText.textContent = `Analyzing move ${i + 1} of ${moves.length}...`;
    const fenBeforeMove = fens[i];
    const result = await evaluatePosition(fenBeforeMove, 14);
    const evalForRecord = result.mate !== null ? (result.mate > 0 ? 1000 : -1000) : result.evalCp;
    const isWhiteMove = i % 2 === 0;

    const playedUci = sanToUci(fenBeforeMove, moves[i]);
    const wasBestMove = !!(result.bestMove && playedUci && result.bestMove.startsWith(playedUci));

    const cls = classifyMove(prevEval, evalForRecord, isWhiteMove, i, wasBestMove);

    analysisResults.push({
      evalCp: evalForRecord,
      mate: result.mate,
      bestMove: result.bestMove,
      classification: cls
    });
    prevEval = evalForRecord;
  }

  els.statusText.textContent = 'Analysis complete.';
}

// ---------- Board rendering ----------
function fenToBoardArray(fen) {
  const rows = fen.split(' ')[0].split('/');
  const board = [];
  for (const row of rows) {
    const r = [];
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < parseInt(ch, 10); i++) r.push(null);
      } else {
        r.push(ch);
      }
    }
    board.push(r);
  }
  return board;
}

function renderBoard(fen, highlightSquares) {
  highlightSquares = highlightSquares || {};
  const arr = fenToBoardArray(fen);
  els.board.innerHTML = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement('div');
      sq.className = 'sq ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
      const piece = arr[r][c];
      if (piece) sq.textContent = PIECE_UNICODE[piece] || '';
      els.board.appendChild(sq);
    }
  }
}

function squareToRC(square) {
  const file = square.charCodeAt(0) - 97;
  const rank = 8 - parseInt(square[1], 10);
  return [rank, file];
}

// ---------- Move list ----------
function buildMoveList(moves) {
  els.moveList.innerHTML = '';
  for (let i = 0; i < moves.length; i += 2) {
    const numSpan = document.createElement('span');
    numSpan.className = 'move-num';
    numSpan.textContent = (i / 2 + 1) + '.';
    els.moveList.appendChild(numSpan);

    [0, 1].forEach((j) => {
      if (moves[i + j] === undefined) {
        els.moveList.appendChild(document.createElement('span'));
        return;
      }
      const cell = document.createElement('span');
      const ply = i + j + 1;
      const a = analysisResults[ply];
      cell.className = 'move-cell' + (a && a.classification ? ' ' + a.classification : '');
      cell.textContent = moves[i + j];
      cell.onclick = () => goToPly(ply);
      els.moveList.appendChild(cell);
    });
  }
}

// ---------- Navigation ----------
function goToPly(ply) {
  currentPly = Math.max(0, Math.min(positions.length - 1, ply));
  updateView();
}

function updateView() {
  const fen = positions[currentPly];
  const a = analysisResults[currentPly];

  let hl = {};
  if (a && a.bestMove) {
    // no special square highlight beyond board for now (kept simple/robust)
  }
  renderBoard(fen, hl);

  if (currentPly === 0) {
    els.moveCounter.textContent = 'Start';
  } else {
    const moveNum = Math.ceil(currentPly / 2);
    const side = currentPly % 2 === 1 ? 'White' : 'Black';
    els.moveCounter.textContent = `Move ${moveNum} (${side})`;
  }

  if (a) {
    const evalCp = a.mate !== null ? (a.mate > 0 ? 1000 : -1000) : a.evalCp;
    const pct = Math.max(2, Math.min(98, 50 + evalCp / 12));
    els.evalFill.style.width = pct + '%';
    const display = a.mate !== null ? `M${Math.abs(a.mate)}` : (evalCp / 100).toFixed(2);
    els.evalScore.textContent = display;

    if (a.classification) {
      els.classRow.style.display = 'block';
      els.classBadge.className = 'class-badge ' + a.classification;
      els.classBadge.textContent = a.classification.charAt(0).toUpperCase() + a.classification.slice(1);
    } else {
      els.classRow.style.display = 'none';
    }
    els.bestMoveLine.textContent = a.bestMove ? 'Engine best move: ' + a.bestMove : '';
  // classification full names handled below via CSS class -> label map
  } else {
    els.evalFill.style.width = '50%';
    els.evalScore.textContent = '0.0';
    els.classRow.style.display = 'none';
    els.bestMoveLine.textContent = '';
  }

  document.querySelectorAll('.move-cell').forEach((el, i) => {
    el.classList.toggle('current', i + 1 === currentPly);
  });
}

function togglePlay() {
  playing = !playing;
  document.getElementById('btn-play').textContent = playing ? '⏸' : '▶';
  if (playing) {
    playTimer = setInterval(() => {
      if (currentPly >= positions.length - 1) { togglePlay(); return; }
      goToPly(currentPly + 1);
    }, 900);
  } else {
    clearInterval(playTimer);
  }
}

// ---------- Stats & summary ----------
function computeStats() {
  let blunders = 0, mistakes = 0, inaccuracies = 0, best = 0, brilliant = 0, great = 0;
  let whiteLoss = 0, blackLoss = 0, whiteMoves = 0, blackMoves = 0;

  for (let i = 1; i < analysisResults.length; i++) {
    const a = analysisResults[i];
    if (!a.classification) continue;
    if (a.classification === 'blunder') blunders++;
    if (a.classification === 'mistake') mistakes++;
    if (a.classification === 'inaccuracy') inaccuracies++;
    if (a.classification === 'best') best++;
    if (a.classification === 'brilliant') brilliant++;
    if (a.classification === 'great') great++;

    const isWhite = i % 2 === 1;
    const prevEval = analysisResults[i - 1].evalCp;
    const loss = isWhite ? Math.max(0, prevEval - a.evalCp) : Math.max(0, a.evalCp - prevEval);
    if (isWhite) { whiteLoss += loss; whiteMoves++; } else { blackLoss += loss; blackMoves++; }
  }

  const whiteAcc = whiteMoves ? Math.max(0, 100 - (whiteLoss / whiteMoves) / 8) : 100;
  const blackAcc = blackMoves ? Math.max(0, 100 - (blackLoss / blackMoves) / 8) : 100;

  return {
    blunders, mistakes, inaccuracies, best, brilliant, great,
    whiteAcc: Math.round(whiteAcc), blackAcc: Math.round(blackAcc)
  };
}

function renderStats(stats) {
  els.whiteAcc.textContent = stats.whiteAcc + '%';
  els.blackAcc.textContent = stats.blackAcc + '%';
  els.statBlunders.textContent = stats.blunders;
  els.statMistakes.textContent = stats.mistakes;
  els.statInaccuracies.textContent = stats.inaccuracies;
  els.statBest.textContent = stats.best + stats.brilliant + stats.great;

  let summary = '';
  if (stats.brilliant > 0) {
    summary += `Found ${stats.brilliant} brilliant move(s) — real tactical gems. `;
  }
  if (stats.blunders > 0) {
    summary += `This game had ${stats.blunders} blunder(s) — these are the moments that most affected the result. `;
  } else {
    summary += 'No major blunders found — solid game overall. ';
  }
  if (stats.whiteAcc > stats.blackAcc) {
    summary += `White played more accurately (${stats.whiteAcc}% vs ${stats.blackAcc}%).`;
  } else if (stats.blackAcc > stats.whiteAcc) {
    summary += `Black played more accurately (${stats.blackAcc}% vs ${stats.whiteAcc}%).`;
  } else {
    summary += 'Both sides played with similar accuracy.';
  }
  els.summaryText.textContent = summary;
}

// ---------- Main flow ----------
async function handleAnalyzeClick() {
  if (!checkDailyLimit()) return;

  const pgnText = els.pgnInput.value.trim();
  if (!pgnText) { alert('Please paste a PGN first.'); return; }

  const parsed = parseGame(pgnText);
  if (!parsed) { alert('Could not parse this PGN. Please check the format.'); return; }

  history = parsed.moves;
  positions = parsed.fens;
  currentPly = 0;

  els.analyzeBtn.disabled = true;
  els.boardSection.style.display = 'grid';
  els.statusText.textContent = 'Loading engine...';

  if (!engineReady) {
    await initEngine();
  }

  await analyzeFullGame(positions, history);

  buildMoveList(history);
  goToPly(0);
  renderStats(computeStats());
  markUsedToday();
  checkDailyLimit();
}

// ---------- Event bindings ----------
document.getElementById('analyze-btn').addEventListener('click', handleAnalyzeClick);
document.getElementById('btn-first').addEventListener('click', () => goToPly(0));
document.getElementById('btn-prev').addEventListener('click', () => goToPly(currentPly - 1));
document.getElementById('btn-next').addEventListener('click', () => goToPly(currentPly + 1));
document.getElementById('btn-last').addEventListener('click', () => goToPly(positions.length - 1));
document.getElementById('btn-play').addEventListener('click', togglePlay);

checkDailyLimit();
