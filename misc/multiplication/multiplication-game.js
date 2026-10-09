(function defineMultiplicationGame(root) {
  const STORAGE_KEY = 'multiplicationQuest.v3';
  const FAST_RECALL_MS = 5000;
  const MIN_TIME_LIMIT_MS = 3000;
  const MAX_TIME_LIMIT_MS = 10000;
  const TIME_LIMIT_OPTIONS_MS = [3000, 5000, 10000];
  const TABLES = [2, 3, 4, 5, 6, 7, 8, 9];
  const MULTIPLIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const ORDER_MODES = ['ordered', 'random'];
  const PLAY_MODES = ['study', 'conquer'];
  const BUCKET_LIMIT = 24;
  const REVIEW_DELAY_RULES = {
    correct: { min: 5, max: 10 },
    wrong: { min: 2, max: 5 },
    timeout: { min: 3, max: 5 },
  };

  function factId(a, b) {
    return `${a}x${b}`;
  }

  function cloneFact(fact) {
    return { ...fact };
  }

  function createFacts() {
    const facts = [];
    for (const a of TABLES) {
      for (const b of MULTIPLIERS) {
        facts.push({
          id: factId(a, b),
          a,
          b,
          product: a * b,
          attempts: 0,
          correct: 0,
          dueTurn: 0,
          lastTurn: -1,
          mastered: false,
        });
      }
    }
    return facts;
  }

  function defaultSettings() {
    return {
      selectedTables: TABLES.slice(),
      playMode: 'conquer',
      orderMode: 'ordered',
      timeLimitMs: 10000,
      keyboardEnabled: false,
    };
  }

  function createInitialState(now = Date.now()) {
    return {
      version: 2,
      startedAt: now,
      updatedAt: now,
      turn: 0,
      settings: defaultSettings(),
      facts: createFacts(),
      recent: [],
      buckets: {
        correct: [],
        wrong: [],
        timeout: [],
      },
    };
  }

  function sanitizeState(raw) {
    if (!raw || !Array.isArray(raw.facts)) return createInitialState();
    const base = createInitialState(raw.startedAt || Date.now());
    const byId = new Map(raw.facts.map((fact) => [fact.id, fact]));
    base.turn = Number.isFinite(raw.turn) ? Math.max(0, raw.turn) : 0;
    base.recent = Array.isArray(raw.recent) ? raw.recent.slice(-8) : [];
    base.updatedAt = raw.updatedAt || Date.now();
    base.settings = sanitizeSettings(raw.settings);
    base.buckets = sanitizeBuckets(raw.buckets);
    base.facts = base.facts.map((fact) => {
      const saved = byId.get(fact.id);
      if (!saved) return fact;
      return {
        ...fact,
        attempts: clampInteger(saved.attempts, 0, 9999),
        correct: clampInteger(saved.correct, 0, 9999),
        dueTurn: clampInteger(saved.dueTurn, 0, 999999),
        lastTurn: clampInteger(saved.lastTurn, -1, 999999),
        mastered: Boolean(saved.mastered),
      };
    });
    return base;
  }

  function sanitizeSettings(settings) {
    const fallback = defaultSettings();
    if (!settings || typeof settings !== 'object') return fallback;
    const selectedTables = sanitizeTables(settings.selectedTables);
    const orderMode = ORDER_MODES.includes(settings.orderMode)
      ? settings.orderMode
      : fallback.orderMode;
    const playMode = PLAY_MODES.includes(settings.playMode)
      ? settings.playMode
      : fallback.playMode;
    const timeLimitMs = sanitizeTimeLimit(settings.timeLimitMs);
    const keyboardEnabled = typeof settings.keyboardEnabled === 'boolean'
      ? settings.keyboardEnabled
      : fallback.keyboardEnabled;
    return { selectedTables, playMode, orderMode, timeLimitMs, keyboardEnabled };
  }

  function sanitizeTables(tables) {
    if (!Array.isArray(tables)) return TABLES.slice();
    const selected = [];
    for (const value of tables) {
      const n = Number(value);
      if (TABLES.includes(n) && !selected.includes(n)) selected.push(n);
    }
    return selected.sort((a, b) => a - b);
  }

  function sanitizeTimeLimit(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return defaultSettings().timeLimitMs;
    const exact = TIME_LIMIT_OPTIONS_MS.find((item) => item === n);
    if (exact) return exact;
    const clamped = clampInteger(n, MIN_TIME_LIMIT_MS, MAX_TIME_LIMIT_MS);
    return TIME_LIMIT_OPTIONS_MS
      .slice()
      .sort((left, right) => Math.abs(left - clamped) - Math.abs(right - clamped))[0];
  }

  function sanitizeBuckets(buckets) {
    const clean = { correct: [], wrong: [], timeout: [] };
    if (!buckets || typeof buckets !== 'object') return clean;
    for (const key of Object.keys(clean)) {
      clean[key] = Array.isArray(buckets[key])
        ? buckets[key].map(sanitizeBucketEntry).filter(Boolean).slice(0, BUCKET_LIMIT)
        : [];
    }
    return clean;
  }

  function sanitizeBucketEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const a = Number(entry.a);
    const b = Number(entry.b);
    if (!TABLES.includes(a) || !MULTIPLIERS.includes(b)) return null;
    return {
      id: String(entry.id || factId(a, b)),
      a,
      b,
      expected: a * b,
      answer: Number.isFinite(Number(entry.answer)) ? Number(entry.answer) : null,
      turn: clampInteger(entry.turn, 0, 999999),
      at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : Date.now(),
      label: String(entry.label || ''),
      correct: clampInteger(entry.correct, 0, 9999),
      mastered: Boolean(entry.mastered),
    };
  }

  function clampInteger(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, Math.trunc(n)));
  }

  function updateSettings(state, nextSettings) {
    state.settings = sanitizeSettings({ ...state.settings, ...nextSettings });
    state.recent = [];
    state.updatedAt = Date.now();
    return state.settings;
  }

  function isSelectedFact(state, fact) {
    return state.settings.selectedTables.includes(fact.a);
  }

  function getSelectedFacts(state) {
    return state.facts.filter((fact) => isSelectedFact(state, fact));
  }

  function getActiveFacts(state) {
    const selectedFacts = getSelectedFacts(state);
    if (state.settings.playMode === 'study') return selectedFacts;
    return selectedFacts.filter((fact) => !fact.mastered);
  }

  function selectNextFact(state) {
    const active = getActiveFacts(state);
    if (!active.length) return null;

    const dueReviews = active.filter((fact) => fact.attempts > 0 && fact.dueTurn <= state.turn);
    const dueNew = active.filter((fact) => fact.attempts === 0 && fact.dueTurn <= state.turn);
    const pool = dueReviews.length ? dueReviews : dueNew.length ? dueNew : active;
    if (state.settings.orderMode === 'random') {
      return selectRandomFact(pool, state);
    }
    return sortFactPool(pool, state)[0];
  }

  function sortFactPool(pool, state) {
    const recentSet = new Set(state.recent.slice(-3));
    return pool
      .slice()
      .sort((left, right) => {
        const leftRecent = recentSet.has(left.id) ? 1 : 0;
        const rightRecent = recentSet.has(right.id) ? 1 : 0;
        return (leftRecent - rightRecent)
          || (left.dueTurn - right.dueTurn)
          || (left.correct - right.correct)
          || (left.attempts - right.attempts)
          || (left.a - right.a)
          || (left.b - right.b);
      });
  }

  function selectRandomFact(pool, state) {
    const recentSet = new Set(state.recent.slice(-3));
    let candidates = pool.filter((fact) => !recentSet.has(fact.id));
    if (!candidates.length) candidates = pool.slice();
    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index];
  }

  function remainingRounds(state) {
    return getSelectedFacts(state).filter((fact) => !fact.mastered).length;
  }

  function randomIntegerInclusive(min, max, rng = Math.random) {
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    const value = Number(rng());
    const safeValue = Number.isFinite(value) ? Math.min(0.999999, Math.max(0, value)) : Math.random();
    return low + Math.floor(safeValue * (high - low + 1));
  }

  function reviewDelayRange(state, bucket) {
    const rule = REVIEW_DELAY_RULES[bucket] || REVIEW_DELAY_RULES.wrong;
    const remaining = Math.max(1, remainingRounds(state));
    const minDelay = Math.max(2, Math.min(rule.min, remaining));
    const maxDelay = Math.max(rule.max, remaining, minDelay);
    return { min: minDelay, max: maxDelay, remaining };
  }

  function scheduleReview(state, fact, bucket, rng = Math.random) {
    const range = reviewDelayRange(state, bucket);
    const delay = randomIntegerInclusive(range.min, range.max, rng);
    fact.dueTurn = state.turn + delay;
    return { ...range, delay, dueTurn: fact.dueTurn };
  }

  function parseAnswer(input) {
    const text = String(input ?? '').trim();
    if (!/^-?\d+$/.test(text)) return null;
    return Number(text);
  }

  function submitAnswer(state, factIdValue, input, elapsedMs = 0, options = {}) {
    const fact = state.facts.find((item) => item.id === factIdValue);
    if (!fact) throw new Error(`Unknown fact: ${factIdValue}`);
    const allowMastered = Boolean(options.allowMastered);
    const rng = typeof options.rng === 'function' ? options.rng : Math.random;
    if (fact.mastered && state.settings.playMode !== 'study' && !allowMastered) {
      return {
        status: 'mastered',
        correct: true,
        timedOut: false,
        answer: fact.product,
        expected: fact.product,
        fact: cloneFact(fact),
        hint: hintForFact(fact),
        bucket: 'correct',
      };
    }

    const answer = parseAnswer(input);
    const correct = answer === fact.product;
    const timedOut = elapsedMs > state.settings.timeLimitMs;
    state.turn += 1;
    state.updatedAt = Date.now();
    fact.attempts += 1;
    fact.lastTurn = state.turn;

    let status = 'miss';
    let bucket = 'wrong';
    let schedule = null;
    if (timedOut && correct) {
      status = 'timeout-correct';
      bucket = 'timeout';
      if (!fact.mastered) fact.correct = 0;
      schedule = scheduleReview(state, fact, 'timeout', rng);
    } else if (correct) {
      fact.correct += 1;
      bucket = 'correct';
      if (fact.correct >= 2) {
        fact.mastered = true;
        status = 'mastered';
        fact.dueTurn = state.settings.playMode === 'study'
          ? state.turn + 4
          : Number.POSITIVE_INFINITY;
      } else {
        fact.mastered = false;
        status = 'correct-once';
        schedule = scheduleReview(state, fact, 'correct', rng);
      }
    } else {
      status = timedOut ? 'timeout-miss' : 'miss';
      bucket = timedOut ? 'wrong' : 'wrong';
      if (!fact.mastered) fact.correct = 0;
      schedule = scheduleReview(state, fact, 'wrong', rng);
    }

    state.recent.push(fact.id);
    state.recent = state.recent.slice(-8);
    recordBucket(state, bucket, fact, answer, status);

    return {
      status,
      correct,
      timedOut,
      answer,
      expected: fact.product,
      fact: cloneFact(fact),
      hint: hintForFact(fact),
      bucket,
      schedule,
    };
  }

  function recordTimeout(state, factIdValue, options = {}) {
    const fact = state.facts.find((item) => item.id === factIdValue);
    if (!fact) throw new Error(`Unknown fact: ${factIdValue}`);
    const allowMastered = Boolean(options.allowMastered);
    const rng = typeof options.rng === 'function' ? options.rng : Math.random;
    if (fact.mastered && state.settings.playMode !== 'study' && !allowMastered) {
      return {
        status: 'mastered',
        correct: true,
        timedOut: false,
        answer: fact.product,
        expected: fact.product,
        fact: cloneFact(fact),
        hint: hintForFact(fact),
        bucket: 'correct',
      };
    }

    state.turn += 1;
    state.updatedAt = Date.now();
    fact.attempts += 1;
    fact.lastTurn = state.turn;
    if (!fact.mastered) fact.correct = 0;
    const schedule = scheduleReview(state, fact, 'timeout', rng);
    state.recent.push(fact.id);
    state.recent = state.recent.slice(-8);
    recordBucket(state, 'timeout', fact, null, 'timeout-skip');

    return {
      status: 'timeout-skip',
      correct: false,
      timedOut: true,
      answer: null,
      expected: fact.product,
      fact: cloneFact(fact),
      hint: hintForFact(fact),
      bucket: 'timeout',
      schedule,
    };
  }

  function recordBucket(state, bucket, fact, answer, status) {
    const entry = {
      id: fact.id,
      a: fact.a,
      b: fact.b,
      expected: fact.product,
      answer,
      turn: state.turn,
      at: Date.now(),
      label: status,
      correct: fact.correct,
      mastered: fact.mastered,
    };
    removeFactFromBuckets(state, fact.id);
    state.buckets[bucket].unshift(entry);
    state.buckets[bucket] = state.buckets[bucket].slice(0, BUCKET_LIMIT);
  }

  function removeFactFromBuckets(state, factIdValue) {
    for (const key of Object.keys(state.buckets)) {
      state.buckets[key] = state.buckets[key].filter((item) => item.id !== factIdValue);
    }
  }

  function hintForFact(fact) {
    const { a, b, product } = fact;
    if (b === 1) return `${a} groups of 1 is ${a}.`;
    if (a === 2) return `Double ${b}: ${b} + ${b} = ${product}.`;
    if (a === 5) return `Count by fives to ${product}.`;
    if (a === 3) return `Use 2 x ${b}, then add one more ${b}.`;
    if (a === 4) return `Double ${b}, then double again.`;
    if (a === 9) return `Use 10 x ${b}, then take away ${b}.`;
    if (a === 6) return `Use 5 x ${b}, then add one more ${b}.`;
    if (a === 7 && b === 8) return 'The 7 x 8 fact is 56.';
    if (a === 8) return `Double ${b}, double again, then double once more.`;
    if (a === 7) return `Use 5 x ${b}, then add 2 x ${b}.`;
    return `${a} groups of ${b} makes ${product}.`;
  }

  function modeLabel(settings) {
    const selected = settings.selectedTables;
    if (selected.length === 0) return 'No Tables';
    if (selected.length === TABLES.length) return 'All Tables';
    if (selected.length === 1) return `${selected[0]} Table`;
    return `${selected.join(', ')} Tables`;
  }

  function playModeLabel(settings) {
    return settings.playMode === 'study' ? 'Repeat' : 'Conquer';
  }

  function progressForState(state) {
    const selectedFacts = getSelectedFacts(state);
    const total = selectedFacts.length;
    const mastered = selectedFacts.filter((fact) => fact.mastered).length;
    const active = getActiveFacts(state).length;
    return {
      total,
      mastered,
      active,
      percent: total ? Math.round((mastered / total) * 100) : 0,
      modeLabel: modeLabel(state.settings),
      playMode: state.settings.playMode,
      playModeLabel: playModeLabel(state.settings),
      orderMode: state.settings.orderMode,
      timeLimitMs: state.settings.timeLimitMs,
      complete: state.settings.playMode === 'conquer' && total > 0 && mastered === total,
      buckets: {
        correct: state.buckets.correct.length,
        wrong: state.buckets.wrong.length,
        timeout: state.buckets.timeout.length,
      },
    };
  }

  function loadState(storage = root.localStorage) {
    if (!storage) return createInitialState();
    try {
      const raw = JSON.parse(storage.getItem(STORAGE_KEY));
      return sanitizeState(raw);
    } catch (_err) {
      return createInitialState();
    }
  }

  function saveState(state, storage = root.localStorage) {
    if (!storage) return;
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function resetState(storage = root.localStorage) {
    if (storage) storage.removeItem(STORAGE_KEY);
    return createInitialState();
  }

  const api = {
    BUCKET_LIMIT,
    FAST_RECALL_MS,
    MAX_TIME_LIMIT_MS,
    MIN_TIME_LIMIT_MS,
    MULTIPLIERS,
    ORDER_MODES,
    PLAY_MODES,
    REVIEW_DELAY_RULES,
    STORAGE_KEY,
    TABLES,
    TIME_LIMIT_OPTIONS_MS,
    createFacts,
    createInitialState,
    factId,
    getActiveFacts,
    getSelectedFacts,
    hintForFact,
    loadState,
    modeLabel,
    progressForState,
    resetState,
    sanitizeState,
    saveState,
    selectNextFact,
    recordTimeout,
    reviewDelayRange,
    submitAnswer,
    updateSettings,
  };

  root.MULTIPLICATION_GAME = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
