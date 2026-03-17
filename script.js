// Simple full-rules chess engine + pass-and-play 2D UI.

const FILES = "abcdefgh";
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

const PIECE_UNICODE = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

const boardEl = document.getElementById("board");
const turnLabelEl = document.getElementById("turnLabel");
const gameStatusEl = document.getElementById("gameStatus");
const moveCounterEl = document.getElementById("moveCounter");
const moveHistoryEl = document.getElementById("moveHistory");
const promotionModal = document.getElementById("promotionModal");
const promotionChoicesEl = document.getElementById("promotionChoices");

const game = {
  board: [],
  turn: "w",
  castling: { w: { k: true, q: true }, b: { k: true, q: true } },
  enPassant: null,
  halfMove: 0,
  fullMove: 1,
  history: [],
  selected: null,
  legalForSelected: [],
  lastMove: null,
  pendingPromotion: null,
};

function createInitialBoard() {
  const rows = START_FEN.split("/");
  const board = [];
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) {
        file += Number(ch);
      } else {
        board[r * 8 + file] = {
          type: ch.toLowerCase(),
          color: ch === ch.toUpperCase() ? "w" : "b",
        };
        file += 1;
      }
    }
  }
  for (let i = 0; i < 64; i++) board[i] ||= null;
  return board;
}

function sqToCoords(index) {
  return { r: Math.floor(index / 8), c: index % 8 };
}

function coordsToSq(r, c) {
  return r * 8 + c;
}

function inside(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function algebraic(index) {
  const { r, c } = sqToCoords(index);
  return `${FILES[c]}${8 - r}`;
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function findKing(board, color) {
  return board.findIndex((p) => p && p.type === "k" && p.color === color);
}

function isSquareAttacked(board, square, byColor) {
  const { r, c } = sqToCoords(square);

  const pawnDir = byColor === "w" ? -1 : 1;
  for (const dc of [-1, 1]) {
    const pr = r - pawnDir;
    const pc = c + dc;
    if (inside(pr, pc)) {
      const p = board[coordsToSq(pr, pc)];
      if (p && p.color === byColor && p.type === "p") return true;
    }
  }

  const knightJumps = [
    [2, 1],
    [2, -1],
    [-2, 1],
    [-2, -1],
    [1, 2],
    [1, -2],
    [-1, 2],
    [-1, -2],
  ];
  for (const [dr, dc] of knightJumps) {
    const nr = r + dr;
    const nc = c + dc;
    if (!inside(nr, nc)) continue;
    const p = board[coordsToSq(nr, nc)];
    if (p && p.color === byColor && p.type === "n") return true;
  }

  const sliders = [
    [1, 0, ["r", "q"]],
    [-1, 0, ["r", "q"]],
    [0, 1, ["r", "q"]],
    [0, -1, ["r", "q"]],
    [1, 1, ["b", "q"]],
    [1, -1, ["b", "q"]],
    [-1, 1, ["b", "q"]],
    [-1, -1, ["b", "q"]],
  ];

  for (const [dr, dc, types] of sliders) {
    let nr = r + dr;
    let nc = c + dc;
    while (inside(nr, nc)) {
      const p = board[coordsToSq(nr, nc)];
      if (p) {
        if (p.color === byColor && types.includes(p.type)) return true;
        break;
      }
      nr += dr;
      nc += dc;
    }
  }

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (!inside(nr, nc)) continue;
      const p = board[coordsToSq(nr, nc)];
      if (p && p.color === byColor && p.type === "k") return true;
    }
  }

  return false;
}

function inCheck(state, color) {
  const kingSq = findKing(state.board, color);
  if (kingSq === -1) return false;
  return isSquareAttacked(state.board, kingSq, color === "w" ? "b" : "w");
}

function pseudoMovesForPiece(state, from) {
  const piece = state.board[from];
  if (!piece) return [];
  const moves = [];
  const { r, c } = sqToCoords(from);
  const fwd = piece.color === "w" ? -1 : 1;
  const startRank = piece.color === "w" ? 6 : 1;

  if (piece.type === "p") {
    const oneR = r + fwd;
    if (inside(oneR, c) && !state.board[coordsToSq(oneR, c)]) {
      moves.push({ from, to: coordsToSq(oneR, c), promo: oneR === 0 || oneR === 7 });
      const twoR = r + 2 * fwd;
      if (r === startRank && !state.board[coordsToSq(twoR, c)]) {
        moves.push({ from, to: coordsToSq(twoR, c), doublePawn: true });
      }
    }
    for (const dc of [-1, 1]) {
      const nr = r + fwd;
      const nc = c + dc;
      if (!inside(nr, nc)) continue;
      const to = coordsToSq(nr, nc);
      const target = state.board[to];
      if (target && target.color !== piece.color) {
        moves.push({ from, to, capture: true, promo: nr === 0 || nr === 7 });
      }
      if (state.enPassant === to) {
        moves.push({ from, to, enPassant: true, capture: true });
      }
    }
  }

  if (piece.type === "n") {
    const jumps = [
      [2, 1],
      [2, -1],
      [-2, 1],
      [-2, -1],
      [1, 2],
      [1, -2],
      [-1, 2],
      [-1, -2],
    ];
    for (const [dr, dc] of jumps) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inside(nr, nc)) continue;
      const to = coordsToSq(nr, nc);
      const target = state.board[to];
      if (!target || target.color !== piece.color) moves.push({ from, to, capture: !!target });
    }
  }

  if (["b", "r", "q"].includes(piece.type)) {
    const dirs = [];
    if (["b", "q"].includes(piece.type)) dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    if (["r", "q"].includes(piece.type)) dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);

    for (const [dr, dc] of dirs) {
      let nr = r + dr;
      let nc = c + dc;
      while (inside(nr, nc)) {
        const to = coordsToSq(nr, nc);
        const target = state.board[to];
        if (!target) {
          moves.push({ from, to });
        } else {
          if (target.color !== piece.color) moves.push({ from, to, capture: true });
          break;
        }
        nr += dr;
        nc += dc;
      }
    }
  }

  if (piece.type === "k") {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (!inside(nr, nc)) continue;
        const to = coordsToSq(nr, nc);
        const target = state.board[to];
        if (!target || target.color !== piece.color) moves.push({ from, to, capture: !!target });
      }
    }

    if (!inCheck(state, piece.color)) {
      const rank = piece.color === "w" ? 7 : 0;
      if (r === rank && c === 4) {
        if (
          state.castling[piece.color].k &&
          !state.board[coordsToSq(rank, 5)] &&
          !state.board[coordsToSq(rank, 6)] &&
          !isSquareAttacked(state.board, coordsToSq(rank, 5), piece.color === "w" ? "b" : "w") &&
          !isSquareAttacked(state.board, coordsToSq(rank, 6), piece.color === "w" ? "b" : "w")
        ) {
          moves.push({ from, to: coordsToSq(rank, 6), castle: "k" });
        }
        if (
          state.castling[piece.color].q &&
          !state.board[coordsToSq(rank, 1)] &&
          !state.board[coordsToSq(rank, 2)] &&
          !state.board[coordsToSq(rank, 3)] &&
          !isSquareAttacked(state.board, coordsToSq(rank, 3), piece.color === "w" ? "b" : "w") &&
          !isSquareAttacked(state.board, coordsToSq(rank, 2), piece.color === "w" ? "b" : "w")
        ) {
          moves.push({ from, to: coordsToSq(rank, 2), castle: "q" });
        }
      }
    }
  }

  return moves;
}

function applyMove(state, move, promotionChoice = "q") {
  const next = cloneState(state);
  next.history = state.history.slice();
  const piece = next.board[move.from];
  next.board[move.from] = null;

  if (move.enPassant) {
    const { r: tr, c: tc } = sqToCoords(move.to);
    const capSq = coordsToSq(tr + (piece.color === "w" ? 1 : -1), tc);
    next.board[capSq] = null;
  }

  if (move.castle) {
    const rank = piece.color === "w" ? 7 : 0;
    if (move.castle === "k") {
      next.board[coordsToSq(rank, 5)] = next.board[coordsToSq(rank, 7)];
      next.board[coordsToSq(rank, 7)] = null;
    } else {
      next.board[coordsToSq(rank, 3)] = next.board[coordsToSq(rank, 0)];
      next.board[coordsToSq(rank, 0)] = null;
    }
  }

  next.board[move.to] = { ...piece };
  if (move.promo) next.board[move.to].type = promotionChoice;

  next.enPassant = null;
  if (piece.type === "p" && move.doublePawn) {
    const { r, c } = sqToCoords(move.to);
    next.enPassant = coordsToSq(r + (piece.color === "w" ? 1 : -1), c);
  }

  if (piece.type === "k") next.castling[piece.color] = { k: false, q: false };
  if (piece.type === "r") {
    const { r, c } = sqToCoords(move.from);
    if (c === 0 && (r === 7 || r === 0)) next.castling[piece.color].q = false;
    if (c === 7 && (r === 7 || r === 0)) next.castling[piece.color].k = false;
  }

  const captured = state.board[move.to];
  if (captured && captured.type === "r") {
    const { r, c } = sqToCoords(move.to);
    if (c === 0 && (r === 7 || r === 0)) next.castling[captured.color].q = false;
    if (c === 7 && (r === 7 || r === 0)) next.castling[captured.color].k = false;
  }

  next.turn = state.turn === "w" ? "b" : "w";
  if (next.turn === "w") next.fullMove += 1;
  next.halfMove = piece.type === "p" || move.capture ? 0 : state.halfMove + 1;

  next.lastMove = move;
  next.selected = null;
  next.legalForSelected = [];

  return next;
}

function legalMovesForColor(state, color) {
  const all = [];
  for (let i = 0; i < 64; i++) {
    const p = state.board[i];
    if (!p || p.color !== color) continue;
    for (const move of pseudoMovesForPiece(state, i)) {
      const next = applyMove(state, move, move.promo ? "q" : undefined);
      if (!inCheck(next, color)) all.push(move);
    }
  }
  return all;
}

function legalMovesFrom(state, from) {
  const piece = state.board[from];
  if (!piece || piece.color !== state.turn) return [];
  return pseudoMovesForPiece(state, from).filter((move) => {
    const next = applyMove(state, move, move.promo ? "q" : undefined);
    return !inCheck(next, piece.color);
  });
}

function moveNotation(move, resultingState, promotionChoice) {
  const piece = game.board[move.from];
  if (!piece) return "";
  if (move.castle === "k") return "O-O";
  if (move.castle === "q") return "O-O-O";

  const letter = piece.type === "p" ? "" : piece.type.toUpperCase();
  const capture = move.capture ? "x" : "";
  const dest = algebraic(move.to);
  const promo = move.promo ? `=${promotionChoice.toUpperCase()}` : "";
  const nextMoves = legalMovesForColor(resultingState, resultingState.turn);
  const check = inCheck(resultingState, resultingState.turn);
  const suffix = check ? (nextMoves.length ? "+" : "#") : "";

  if (piece.type === "p" && move.capture) {
    return `${FILES[sqToCoords(move.from).c]}x${dest}${promo}${suffix}`;
  }
  return `${letter}${capture}${dest}${promo}${suffix}`;
}

function statusText() {
  const legal = legalMovesForColor(game, game.turn);
  const check = inCheck(game, game.turn);
  if (!legal.length && check) return "Checkmate";
  if (!legal.length && !check) return "Stalemate";
  if (check) return "Check";
  return "In progress";
}

function renderBoard() {
  boardEl.innerHTML = "";
  const status = statusText();
  boardEl.classList.toggle("flipped", game.turn === "b");

  const kingSq = findKing(game.board, game.turn);
  const checkNow = inCheck(game, game.turn);

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const index = coordsToSq(r, c);
      const square = document.createElement("button");
      square.className = `square ${(r + c) % 2 ? "dark" : "light"}`;
      square.dataset.index = index;

      if (game.selected === index) square.classList.add("selected");
      const legal = game.legalForSelected.find((m) => m.to === index);
      if (legal) square.classList.add(legal.capture ? "capture" : "legal");

      if (game.lastMove && (game.lastMove.from === index || game.lastMove.to === index)) {
        square.classList.add("last-move");
      }

      if (checkNow && kingSq === index) square.classList.add("in-check");

      const piece = game.board[index];
      if (piece) {
        const span = document.createElement("span");
        span.className = "piece";
        span.textContent = PIECE_UNICODE[piece.color][piece.type];
        square.appendChild(span);
      }

      square.addEventListener("click", () => onSquareTap(index));
      boardEl.appendChild(square);
    }
  }

  turnLabelEl.textContent = game.turn === "w" ? "White" : "Black";
  gameStatusEl.textContent = status;
  moveCounterEl.textContent = String(game.history.length);
}

function renderHistory() {
  moveHistoryEl.innerHTML = "";
  for (let i = 0; i < game.history.length; i += 2) {
    const li = document.createElement("li");
    li.textContent = `${game.history[i]}${game.history[i + 1] ? "  " + game.history[i + 1] : ""}`;
    moveHistoryEl.appendChild(li);
  }
}

function onSquareTap(index) {
  if (game.pendingPromotion) return;
  const piece = game.board[index];

  if (game.selected !== null) {
    const move = game.legalForSelected.find((m) => m.to === index);
    if (move) {
      if (move.promo) {
        openPromotion(move);
        return;
      }
      makeMove(move);
      return;
    }
  }

  if (piece && piece.color === game.turn) {
    game.selected = index;
    game.legalForSelected = legalMovesFrom(game, index);
  } else {
    game.selected = null;
    game.legalForSelected = [];
  }

  renderBoard();
}

function openPromotion(move) {
  game.pendingPromotion = move;
  promotionChoicesEl.innerHTML = "";
  const options = ["q", "r", "b", "n"];
  for (const option of options) {
    const btn = document.createElement("button");
    btn.className = "promotion-choice";
    btn.textContent = PIECE_UNICODE[game.turn][option];
    btn.addEventListener("click", () => {
      promotionModal.classList.add("hidden");
      const pending = game.pendingPromotion;
      game.pendingPromotion = null;
      makeMove(pending, option);
    });
    promotionChoicesEl.appendChild(btn);
  }
  promotionModal.classList.remove("hidden");
}

function makeMove(move, promotionChoice = "q") {
  const next = applyMove(game, move, promotionChoice);
  const notation = moveNotation(move, next, promotionChoice);

  game.board = next.board;
  game.turn = next.turn;
  game.castling = next.castling;
  game.enPassant = next.enPassant;
  game.halfMove = next.halfMove;
  game.fullMove = next.fullMove;
  game.lastMove = next.lastMove;
  game.selected = null;
  game.legalForSelected = [];
  game.history.push(notation);

  renderBoard();
  renderHistory();
}

function initGame() {
  game.board = createInitialBoard();
  game.turn = "w";
  game.castling = { w: { k: true, q: true }, b: { k: true, q: true } };
  game.enPassant = null;
  game.halfMove = 0;
  game.fullMove = 1;
  game.history = [];
  game.selected = null;
  game.legalForSelected = [];
  game.lastMove = null;
  game.pendingPromotion = null;
  promotionModal.classList.add("hidden");
  renderBoard();
  renderHistory();
}

function undoMove() {
  if (!game.history.length) return;
  const targetHalfMoves = game.history.length - 1;
  const historyCopy = [...game.history];
  initGame();
  // Rebuild position by replaying moves from captured snapshots.
  // We keep a snapshot per move to provide robust undo.
  if (window.__snapshots && window.__snapshots[targetHalfMoves]) {
    const snap = window.__snapshots[targetHalfMoves];
    Object.assign(game, cloneState(snap));
    game.history = historyCopy.slice(0, targetHalfMoves);
  }
  window.__snapshots = window.__snapshots?.slice(0, targetHalfMoves) || [];
  renderBoard();
  renderHistory();
}

window.__snapshots = [];
const originalMakeMove = makeMove;
makeMove = function wrappedMakeMove(move, promotionChoice = "q") {
  originalMakeMove(move, promotionChoice);
  window.__snapshots.push(
    cloneState({
      board: game.board,
      turn: game.turn,
      castling: game.castling,
      enPassant: game.enPassant,
      halfMove: game.halfMove,
      fullMove: game.fullMove,
      selected: null,
      legalForSelected: [],
      lastMove: game.lastMove,
      pendingPromotion: null,
    })
  );
};

document.getElementById("newGameBtn").addEventListener("click", () => {
  initGame();
  window.__snapshots = [];
});

document.getElementById("restartBtn").addEventListener("click", () => {
  initGame();
  window.__snapshots = [];
});

document.getElementById("undoBtn").addEventListener("click", undoMove);

initGame();
