/* ==========================================================================
   BUSINESS TYCOON TAP - TAB INVESTASI (Saham / Properti / Kripto / Forex & Detail Aset)
   ========================================================================== */

import { CONFIG } from '../../core/config.js';
import { ASSETS } from '../../data/assets.js';
import { hasDOM, root, getEl } from '../../utils/dom.js';
import {
  state,
  runtime,
  getAssetById,
  getCurrentAssetPrice,
  saveState,
  saveMarketPricesThrottled
} from '../../core/state.js';
import {
  formatRupiahCompact,
  formatRupiahFull,
  formatUsdFull,
  formatUsdCompact,
  formatSignedPercent,
  formatIntegerID,
  formatTimeHHMM
} from '../../utils/format.js';
import { triggerHaptic, playCoinBlip, showToast } from '../../components/feedback.js';
import { checkMilestones } from '../../components/milestones.js';
import { renderStats, renderUpgrades } from '../earnings/earnings.js';

// Referensi elemen DOM (null di lingkungan pengujian Node)
const investingScreen = getEl('investing-screen');
const investingCategoryScreen = getEl('investing-category-screen');
const investingOwnedScreen = getEl('investing-owned-screen');
const assetDetailScreen = getEl('asset-detail-screen');
const heroTotalValue = getEl('hero-total-value');
const heroHourlyYield = getEl('hero-hourly-yield');
const allocCenterLabel = getEl('alloc-center-label');
const allocCenterTotal = getEl('alloc-center-total');
const allocCenterSub = getEl('alloc-center-sub');
const allocDonutCenter = getEl('alloc-donut-center');
const donutSegmentsGroup = getEl('donut-segments');
const donutWrap = getEl('alloc-donut-wrap') || (hasDOM ? document.querySelector('#investing-screen .donut-wrap') : null);
const legendItems = hasDOM ? Array.from(document.querySelectorAll('[data-legend-category]')) : [];
const legendValSaham = getEl('legend-val-Saham');
const legendValKripto = getEl('legend-val-Kripto');
const legendValForex = getEl('legend-val-Forex');
const legendShareSaham = getEl('legend-share-Saham');
const legendShareKripto = getEl('legend-share-Kripto');
const legendShareForex = getEl('legend-share-Forex');
const categoryBody = getEl('category-body');
const categoryPortfolioCard = getEl('category-portfolio-card');
const catPortfolioTitle = getEl('cat-portfolio-title');
const catPortfolioLabel = getEl('cat-portfolio-label');
const catPortfolioValue = getEl('cat-portfolio-value');
const catPortfolioPnl = getEl('cat-portfolio-pnl');
const catPortfolioYield = getEl('cat-portfolio-yield');
const ownedBody = getEl('owned-body');
const ownedListTrack = getEl('owned-list-track');
const ownedEmptyState = getEl('owned-empty-state');
const ownedEmptyText = getEl('owned-empty-text');
const ownedEmptyCtaBtn = getEl('owned-empty-cta-btn');
const categoryCards = hasDOM ? Array.from(document.querySelectorAll('[data-invest-category]')) : [];
const categoryShelves = hasDOM ? Array.from(document.querySelectorAll('[data-shelf]')) : [];
const catCardSubSaham = getEl('cat-card-sub-Saham');
const catCardSubKripto = getEl('cat-card-sub-Kripto');
const catCardSubForex = getEl('cat-card-sub-Forex');
const catCardTotalSaham = getEl('cat-card-total-Saham');
const catCardTotalKripto = getEl('cat-card-total-Kripto');
const catCardTotalForex = getEl('cat-card-total-Forex');
const catCardShareSaham = getEl('cat-card-share-Saham');
const catCardShareKripto = getEl('cat-card-share-Kripto');
const catCardShareForex = getEl('cat-card-share-Forex');
const shelfTrackSaham = getEl('shelf-track-Saham');
const shelfTrackKripto = getEl('shelf-track-Kripto');
const shelfTrackForex = getEl('shelf-track-Forex');
const assetDetailBackBtn = getEl('asset-detail-back-btn');
const detailAssetName = getEl('detail-asset-name');
const detailAssetCategory = getEl('detail-asset-category');
const detailWalletBalance = getEl('detail-wallet-balance');
const detailMarketPriceHero = getEl('detail-market-price-hero');
const detailPriceChange = getEl('detail-price-change');
const assetPriceCanvas = getEl('asset-price-canvas');
const detailOwnedUnits = getEl('detail-owned-units');
const detailMarketPrice = getEl('detail-market-price');
const detailAvgEntry = getEl('detail-avg-entry');
const detailMarketValue = getEl('detail-market-value');
const detailTotalCost = getEl('detail-total-cost');
const detailUnrealizedPnl = getEl('detail-unrealized-pnl');
const detailYieldRow = getEl('detail-yield-row');
const detailHourlyYield = getEl('detail-hourly-yield');
const detailQtyChips = hasDOM ? Array.from(document.querySelectorAll('[data-trade-qty]')) : [];
const detailTradeNotice = getEl('detail-trade-notice');
const detailSellBtn = getEl('detail-sell-btn');
const detailBuyBtn = getEl('detail-buy-btn');
const roadmapModal = getEl('roadmap-modal');
const resetModal = getEl('reset-modal');
const offlineModal = getEl('offline-modal');

/**
 * Menginisialisasi harga pasar & menghasilkan 60 titik riwayat mundur dengan random walk.
 */
export function initMarketData() {
  const now = Date.now();
  ASSETS.forEach(function (asset) {
    const savedPrice = Number(state.lastPrices[asset.id]);
    const minAllowed = asset.initialPrice * CONFIG.MIN_PRICE_FACTOR;
    const basePrice =
      Number.isFinite(savedPrice) && savedPrice >= minAllowed
        ? savedPrice
        : asset.initialPrice;

    const roundedBase = Math.round(basePrice * 100) / 100;
    state.lastPrices[asset.id] = roundedBase;

    const points = new Array(CONFIG.HISTORY_MAX);
    let cursorPrice = roundedBase;
    points[CONFIG.HISTORY_MAX - 1] = { ts: now, price: cursorPrice };

    for (let k = CONFIG.HISTORY_MAX - 1; k > 0; k -= 1) {
      const step =
        (Math.random() - CONFIG.RANDOM_WALK_CENTER) *
        CONFIG.RANDOM_WALK_SPREAD *
        asset.volatility;
      const denom = 1 + step;
      const prevRaw = denom > CONFIG.MIN_PRICE_FACTOR ? cursorPrice / denom : cursorPrice;
      const clampedPrev = Math.max(prevRaw, minAllowed);
      cursorPrice =
        Math.round((Number.isFinite(clampedPrev) ? clampedPrev : roundedBase) * 100) / 100;
      points[k - 1] = {
        ts: now - (CONFIG.HISTORY_MAX - k) * CONFIG.PRICE_TICK_MS,
        price: cursorPrice
      };
    }

    state.priceHistory[asset.id] = points;
  });
}

/**
 * Menghitung total estimasi pendapatan per jam dari seluruh aset berimbal hasil (Saham & Properti).
 */
export function getTotalInvestmentHourlyYield() {
  let total = 0;
  ASSETS.forEach(function (asset) {
    if (asset.yieldRate <= 0) return;
    const holding = state.holdings[asset.id];
    const units = holding && Number.isFinite(Number(holding.units)) ? Number(holding.units) : 0;
    if (units <= 0) return;
    const val = units * getCurrentAssetPrice(asset.id) * asset.yieldRate;
    if (Number.isFinite(val) && val > 0) {
      total += val;
    }
  });
  return Number.isFinite(total) ? total : 0;
}

/**
 * Satu siklus pergerakan harga pasar (setiap 3 detik) menggunakan random walk terukur.
 */
export function runPriceTick() {
  const now = Date.now();
  ASSETS.forEach(function (asset) {
    const current = getCurrentAssetPrice(asset.id);
    const minAllowed = asset.initialPrice * CONFIG.MIN_PRICE_FACTOR;
    const change =
      (Math.random() - CONFIG.RANDOM_WALK_CENTER) *
      CONFIG.RANDOM_WALK_SPREAD *
      asset.volatility;
    const candidate = current * (1 + change);
    const safeCandidate = Number.isFinite(candidate) ? candidate : current;
    const nextPrice = Math.round(Math.max(safeCandidate, minAllowed) * 100) / 100;

    state.lastPrices[asset.id] = nextPrice;

    if (!Array.isArray(state.priceHistory[asset.id])) {
      state.priceHistory[asset.id] = [];
    }
    state.priceHistory[asset.id].push({ ts: now, price: nextPrice });
    while (state.priceHistory[asset.id].length > CONFIG.HISTORY_MAX) {
      state.priceHistory[asset.id].shift();
    }
  });

  if (hasDOM && document.visibilityState === 'visible' && state.activeTab === 'Investing') {
    if (state.selectedAssetId) {
      renderAssetDetailScreen();
    } else {
      renderInvestingScreen();
    }
  }

  saveMarketPricesThrottled();
}

/**
 * Menghitung persentase perubahan harga aset terhadap titik awal riwayat.
 */
export function getAssetChangePercent(assetId) {
  const history = state.priceHistory[assetId];
  if (!Array.isArray(history) || history.length === 0) {
    return 0;
  }
  const firstPrice = Number(history[0].price);
  const currentPrice = getCurrentAssetPrice(assetId);
  if (!Number.isFinite(firstPrice) || firstPrice <= 0 || !Number.isFinite(currentPrice)) {
    return 0;
  }
  const pct = ((currentPrice - firstPrice) / firstPrice) * 100;
  return Number.isFinite(pct) ? pct : 0;
}

/**
 * Menghitung ringkasan nilai portofolio, P&L, dan pendapatan/jam untuk satu kategori.
 */
export function getCategorySummary(category) {
  let totalValue = 0;
  let totalCost = 0;
  let hourlyYield = 0;

  ASSETS.forEach(function (asset) {
    if (asset.category !== category) return;
    const holding = state.holdings[asset.id];
    const units = holding && Number.isFinite(Number(holding.units)) ? Number(holding.units) : 0;
    const avgEntry =
      holding && Number.isFinite(Number(holding.avgEntry)) ? Number(holding.avgEntry) : 0;
    if (units <= 0) return;

    const marketPrice = getCurrentAssetPrice(asset.id);
    const positionValue = units * marketPrice;
    const positionCost = units * avgEntry;

    if (Number.isFinite(positionValue)) {
      totalValue += positionValue;
    }
    if (Number.isFinite(positionCost)) {
      totalCost += positionCost;
    }
    if (asset.yieldRate > 0 && Number.isFinite(positionValue)) {
      hourlyYield += positionValue * asset.yieldRate;
    }
  });

  const pnlValue = totalCost > 0 ? totalValue - totalCost : 0;
  const rawPct = totalCost > 0 ? (pnlValue / totalCost) * 100 : 0;
  const pnlPct = Number.isFinite(rawPct) ? rawPct : 0;

  return {
    totalValue: Number.isFinite(totalValue) ? totalValue : 0,
    totalCost: Number.isFinite(totalCost) ? totalCost : 0,
    pnlValue: Number.isFinite(pnlValue) ? pnlValue : 0,
    pnlPct: pnlPct,
    hourlyYield: Number.isFinite(hourlyYield) ? hourlyYield : 0
  };
}

const INVEST_CATEGORIES = ['Saham', 'Kripto', 'Forex'];
const CATEGORY_META = {
  Saham: {
    subtitle: 'Ekuitas',
    color: '#2563EB',
    portfolioTitle: 'Portofolio Saham Saya',
    portfolioLabel: 'Nilai portofolio saham',
    ownedTitle: 'Saham Saya',
    emptyText: 'Belum ada saham yang dibeli.'
  },
  Kripto: {
    subtitle: 'Aset Digital',
    color: '#EA580C',
    portfolioTitle: 'Portofolio Kripto Saya',
    portfolioLabel: 'Nilai portofolio kripto',
    ownedTitle: 'Kripto Saya',
    emptyText: 'Belum ada aset kripto yang dibeli.'
  },
  Forex: {
    subtitle: 'Mata Uang',
    color: '#7C3AED',
    portfolioTitle: 'Portofolio Forex Saya',
    portfolioLabel: 'Nilai portofolio forex',
    ownedTitle: 'Forex Saya',
    emptyText: 'Belum ada pasangan forex yang dibeli.'
  }
};
const SHELF_TRACKS = {
  Saham: shelfTrackSaham,
  Kripto: shelfTrackKripto,
  Forex: shelfTrackForex
};
const CAT_CARD_SUBS = {
  Saham: catCardSubSaham,
  Kripto: catCardSubKripto,
  Forex: catCardSubForex
};
const CAT_CARD_TOTALS = {
  Saham: catCardTotalSaham,
  Kripto: catCardTotalKripto,
  Forex: catCardTotalForex
};
const CAT_CARD_SHARES = {
  Saham: catCardShareSaham,
  Kripto: catCardShareKripto,
  Forex: catCardShareForex
};
const LEGEND_VALS = {
  Saham: legendValSaham,
  Kripto: legendValKripto,
  Forex: legendValForex
};
const LEGEND_SHARES = {
  Saham: legendShareSaham,
  Kripto: legendShareKripto,
  Forex: legendShareForex
};

let activeCategoryScreen = null;
let isOwnedScreenOpen = false;
let activeLegendCategory = null;
let hoveredLegendCategory = null;

/**
 * Menghitung ringkasan portofolio lintas 4 kelas aset (nilai, P&L, alokasi,
 * kelas aktif, dan kelas terbesar) dari kepemilikan pemain yang asli.
 */
export function getPortfolioAllocation() {
  const byCategory = {};
  let total = 0;
  let pnlValue = 0;
  let totalCost = 0;

  INVEST_CATEGORIES.forEach(function (cat) {
    const summary = getCategorySummary(cat);
    byCategory[cat] = summary;
    total += summary.totalValue;
    pnlValue += summary.pnlValue;
    totalCost += summary.totalCost;
  });

  let openPositions = 0;
  ASSETS.forEach(function (asset) {
    const holding = state.holdings[asset.id];
    const units = holding && Number.isFinite(Number(holding.units)) ? Number(holding.units) : 0;
    if (units > 0) {
      openPositions += 1;
    }
  });

  let classes = 0;
  let top = null;
  let topValue = 0;
  INVEST_CATEGORIES.forEach(function (cat) {
    const value = byCategory[cat].totalValue;
    if (value > 0) {
      classes += 1;
      if (value > topValue) {
        top = cat;
        topValue = value;
      }
    }
  });

  const topShare = total > 0 && top ? (topValue / total) * 100 : 0;
  const rawPnlPct = totalCost > 0 ? (pnlValue / totalCost) * 100 : 0;

  return {
    byCategory: byCategory,
    total: Number.isFinite(total) ? total : 0,
    pnlValue: Number.isFinite(pnlValue) ? pnlValue : 0,
    pnlPct: Number.isFinite(rawPnlPct) ? rawPnlPct : 0,
    classes: classes,
    top: top,
    topShare: Number.isFinite(topShare) ? topShare : 0,
    openPositions: openPositions
  };
}

/**
 * Memformat bobot alokasi satu desimal, mis. "45.0%" (en-US).
 */
function formatSharePercent(share) {
  const safe = Number.isFinite(share) ? share : 0;
  return safe.toFixed(CONFIG.ALLOC_DECIMALS) + '%';
}

let donutBuilt = false;
const donutSegmentEls = [];
const donutAnimState = {
  rafId: null,
  pulseTimer: null,
  initialized: false,
  currentTotal: 0,
  targetTotal: 0,
  currentFractions: INVEST_CATEGORIES.map(function () {
    return 0;
  }),
  targetFractions: INVEST_CATEGORIES.map(function () {
    return 0;
  }),
  currentShares: INVEST_CATEGORIES.map(function () {
    return 0;
  }),
  targetShares: INVEST_CATEGORIES.map(function () {
    return 0;
  }),
  currentCategoryTotals: INVEST_CATEGORIES.map(function () {
    return 0;
  }),
  targetCategoryTotals: INVEST_CATEGORIES.map(function () {
    return 0;
  })
};

/**
 * Menghentikan animasi donat distribusi portofolio yang sedang berjalan.
 */
function cancelDonutAnimation() {
  if (donutAnimState.rafId !== null && typeof root.cancelAnimationFrame === 'function') {
    root.cancelAnimationFrame(donutAnimState.rafId);
  }
  donutAnimState.rafId = null;
}

/**
 * Menyelaraskan sorotan segmen donat, legenda interaktif, dan teks tengah donat.
 */
function syncDonutHighlightUI() {
  const focusedCat = hoveredLegendCategory || activeLegendCategory;
  const focusedIdx = focusedCat ? INVEST_CATEGORIES.indexOf(focusedCat) : 0;
  const hasFocus = Boolean(focusedCat && focusedIdx >= 0);

  if (donutBuilt) {
    INVEST_CATEGORIES.forEach(function (cat, idx) {
      const segment = donutSegmentEls[idx];
      if (!segment) return;
      segment.classList.toggle('is-active', Boolean(hasFocus && cat === focusedCat));
      segment.classList.toggle('is-dimmed', Boolean(hasFocus && cat !== focusedCat));
    });
  }

  legendItems.forEach(function (btn) {
    const cat = btn.getAttribute('data-legend-category');
    const isPressed = Boolean(activeLegendCategory && cat === activeLegendCategory);
    const isHighlighted = Boolean(hasFocus && cat === focusedCat);
    const isDimmed = Boolean(hasFocus && cat !== focusedCat);
    btn.classList.toggle('is-active', isHighlighted);
    btn.classList.toggle('is-dimmed', isDimmed);
    btn.setAttribute('aria-pressed', String(isPressed));
  });

  if (hasFocus) {
    const catVal = donutAnimState.currentCategoryTotals[focusedIdx] || 0;
    const catShare = donutAnimState.currentShares[focusedIdx] || 0;
    if (allocCenterLabel) {
      allocCenterLabel.textContent = focusedCat.toUpperCase();
    }
    if (allocCenterTotal) {
      allocCenterTotal.textContent = formatUsdCompact(catVal);
      allocCenterTotal.title = formatUsdFull(catVal);
    }
    if (allocCenterSub) {
      allocCenterSub.textContent = formatSharePercent(catShare) + ' PORTOFOLIO';
    }
  } else {
    const totalVal = donutAnimState.currentTotal || 0;
    if (allocCenterLabel) {
      allocCenterLabel.textContent = 'TOTAL NILAI';
    }
    if (allocCenterTotal) {
      allocCenterTotal.textContent = formatUsdCompact(totalVal);
      allocCenterTotal.title = formatUsdFull(totalVal);
    }
    if (allocCenterSub) {
      allocCenterSub.textContent = 'LANGSUNG \u00B7 3 dtk';
    }
  }
}

/**
 * Mengatur atau membalikkan pilihan kategori aktif pada legenda & segmen donat.
 */
function toggleLegendCategory(cat) {
  if (!cat || INVEST_CATEGORIES.indexOf(cat) < 0) return;
  activeLegendCategory = activeLegendCategory === cat ? null : cat;
  syncDonutHighlightUI();
}

/**
 * Membangun segmen donat satu kali (Saham, Kripto, Forex).
 */
function ensureDonutSkeleton() {
  if (donutBuilt || !donutSegmentsGroup) return;
  const circumference = Math.PI * CONFIG.FULL_CIRCLE_TURNS * CONFIG.DONUT_RADIUS;
  INVEST_CATEGORIES.forEach(function (cat) {
    const segment = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    segment.setAttribute('class', 'donut-segment');
    segment.setAttribute('data-donut-category', cat);
    segment.setAttribute('tabindex', '0');
    segment.setAttribute('role', 'button');
    segment.setAttribute('aria-label', 'Sorot kelas aset ' + cat);
    segment.setAttribute('cx', '110');
    segment.setAttribute('cy', '110');
    segment.setAttribute('r', String(CONFIG.DONUT_RADIUS));
    segment.setAttribute('stroke', CATEGORY_META[cat].color);
    segment.setAttribute('stroke-dasharray', '0 ' + String(circumference));
    segment.setAttribute('stroke-dashoffset', '0');
    donutSegmentsGroup.appendChild(segment);
    donutSegmentEls.push(segment);
  });
  donutBuilt = true;
}

/**
 * Menerapkan satu frame segmen donat, total nilai tengah, dan persentase distribusi kategori.
 */
function applyDonutFrame(fractions, totalVal, shares, categoryTotals) {
  ensureDonutSkeleton();
  const circumference = Math.PI * CONFIG.FULL_CIRCLE_TURNS * CONFIG.DONUT_RADIUS;
  let offset = 0;

  if (donutBuilt) {
    INVEST_CATEGORIES.forEach(function (_cat, idx) {
      const segment = donutSegmentEls[idx];
      if (!segment) return;
      const frac = Math.max(0, Math.min(1, fractions[idx] || 0));
      const length = circumference * frac;
      const remainder = Math.max(0, circumference - length);
      segment.setAttribute('stroke-dasharray', String(length) + ' ' + String(remainder));
      segment.setAttribute('stroke-dashoffset', String(-offset));
      offset += length;
    });
  }

  INVEST_CATEGORIES.forEach(function (cat, idx) {
    const shareText = formatSharePercent(shares[idx]);
    const catVal = categoryTotals ? categoryTotals[idx] || 0 : 0;
    if (CAT_CARD_SHARES[cat]) {
      CAT_CARD_SHARES[cat].textContent = shareText + ' portofolio';
    }
    if (LEGEND_SHARES[cat]) {
      LEGEND_SHARES[cat].textContent = shareText;
    }
    if (LEGEND_VALS[cat]) {
      LEGEND_VALS[cat].textContent = formatUsdCompact(catVal);
      LEGEND_VALS[cat].title = formatUsdFull(catVal);
    }
  });

  syncDonutHighlightUI();
}

function triggerDonutPulse(direction) {
  if (donutWrap) {
    donutWrap.classList.remove('is-updating');
    void donutWrap.offsetWidth;
    donutWrap.classList.add('is-updating');
  }
  if (allocCenterTotal) {
    allocCenterTotal.classList.remove('is-up', 'is-down');
    if (direction !== 'flat') {
      void allocCenterTotal.offsetWidth;
      allocCenterTotal.classList.add(direction === 'up' ? 'is-up' : 'is-down');
    }
  }
  if (donutAnimState.pulseTimer !== null) {
    clearTimeout(donutAnimState.pulseTimer);
  }
  donutAnimState.pulseTimer = setTimeout(function () {
    donutAnimState.pulseTimer = null;
    if (donutWrap) donutWrap.classList.remove('is-updating');
    if (allocCenterTotal) allocCenterTotal.classList.remove('is-up', 'is-down');
  }, CONFIG.DONUT_PULSE_MS);
}

/**
 * Memperbarui segmen donat dan persentase distribusi dengan transisi halus saat nilai berubah.
 */
function updateDonut(allocation) {
  ensureDonutSkeleton();

  const targetTotal = Number.isFinite(allocation.total) ? allocation.total : 0;
  const targetCategoryTotals = INVEST_CATEGORIES.map(function (cat) {
    const val = allocation.byCategory[cat].totalValue;
    return Number.isFinite(val) ? val : 0;
  });
  const targetFractions = targetCategoryTotals.map(function (val) {
    return targetTotal > 0 ? val / targetTotal : 0;
  });
  const targetShares = targetFractions.map(function (frac) {
    return frac * 100;
  });

  const prevTargetTotal = donutAnimState.targetTotal;
  const totalChanged = Math.abs(targetTotal - prevTargetTotal) > CONFIG.DONUT_EPSILON;
  const fractionsChanged = targetFractions.some(function (frac, idx) {
    return Math.abs(frac - donutAnimState.targetFractions[idx]) > CONFIG.DONUT_EPSILON;
  });
  const hasChanged = totalChanged || fractionsChanged;

  const prefersReduced =
    hasDOM &&
    typeof root.matchMedia === 'function' &&
    root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canAnimate =
    hasDOM && typeof root.requestAnimationFrame === 'function' && !prefersReduced;

  const fromTotal = donutAnimState.initialized ? donutAnimState.currentTotal : 0;
  const fromFractions = donutAnimState.initialized
    ? donutAnimState.currentFractions.slice()
    : targetFractions.map(function () {
        return 0;
      });
  const fromShares = donutAnimState.initialized
    ? donutAnimState.currentShares.slice()
    : targetShares.map(function () {
        return 0;
      });
  const fromCategoryTotals = donutAnimState.initialized
    ? donutAnimState.currentCategoryTotals.slice()
    : targetCategoryTotals.map(function () {
        return 0;
      });

  donutAnimState.targetTotal = targetTotal;
  donutAnimState.targetFractions = targetFractions.slice();
  donutAnimState.targetShares = targetShares.slice();
  donutAnimState.targetCategoryTotals = targetCategoryTotals.slice();

  const shouldAnimate =
    canAnimate &&
    (donutAnimState.initialized ? hasChanged : targetTotal > 0);

  if (!shouldAnimate) {
    cancelDonutAnimation();
    donutAnimState.initialized = true;
    donutAnimState.currentTotal = targetTotal;
    donutAnimState.currentFractions = targetFractions.slice();
    donutAnimState.currentShares = targetShares.slice();
    donutAnimState.currentCategoryTotals = targetCategoryTotals.slice();
    applyDonutFrame(targetFractions, targetTotal, targetShares, targetCategoryTotals);
    return;
  }

  if (donutAnimState.initialized && hasChanged) {
    const direction =
      targetTotal > prevTargetTotal
        ? 'up'
        : targetTotal < prevTargetTotal
          ? 'down'
          : 'flat';
    triggerDonutPulse(direction);
  }

  donutAnimState.initialized = true;
  cancelDonutAnimation();

  const startTs =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  function stepDonut(nowTs) {
    const rawProgress = (nowTs - startTs) / CONFIG.DONUT_ANIM_DURATION_MS;
    const clamped = Math.max(0, Math.min(1, rawProgress));
    const eased = 1 - Math.pow(1 - clamped, CONFIG.CHART_EASE_POWER);

    const frameTotal = fromTotal + (targetTotal - fromTotal) * eased;
    const frameFractions = targetFractions.map(function (targetFrac, idx) {
      return fromFractions[idx] + (targetFrac - fromFractions[idx]) * eased;
    });
    const frameShares = targetShares.map(function (targetShare, idx) {
      return fromShares[idx] + (targetShare - fromShares[idx]) * eased;
    });
    const frameCategoryTotals = targetCategoryTotals.map(function (targetCatVal, idx) {
      return fromCategoryTotals[idx] + (targetCatVal - fromCategoryTotals[idx]) * eased;
    });

    donutAnimState.currentTotal = frameTotal;
    donutAnimState.currentFractions = frameFractions;
    donutAnimState.currentShares = frameShares;
    donutAnimState.currentCategoryTotals = frameCategoryTotals;
    applyDonutFrame(frameFractions, frameTotal, frameShares, frameCategoryTotals);

    if (clamped < 1) {
      donutAnimState.rafId = root.requestAnimationFrame(stepDonut);
    } else {
      donutAnimState.rafId = null;
      donutAnimState.currentTotal = targetTotal;
      donutAnimState.currentFractions = targetFractions.slice();
      donutAnimState.currentShares = targetShares.slice();
      donutAnimState.currentCategoryTotals = targetCategoryTotals.slice();
      applyDonutFrame(targetFractions, targetTotal, targetShares, targetCategoryTotals);
    }
  }

  donutAnimState.rafId = root.requestAnimationFrame(stepDonut);
}

let shelvesBuilt = false;
const shelfTiles = [];

/**
 * Membangun strip kartu aset (tile) untuk keempat rak satu kali.
 */
function ensureShelvesBuilt() {
  if (shelvesBuilt) return;
  if (!hasDOM) return;

  INVEST_CATEGORIES.forEach(function (cat) {
    const track = SHELF_TRACKS[cat];
    if (!track) return;

    const categoryAssets = ASSETS.filter(function (asset) {
      return asset.category === cat;
    });

    categoryAssets.forEach(function (asset) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile';
      tile.setAttribute('data-asset-id', asset.id);
      tile.setAttribute('role', 'listitem');
      tile.setAttribute('aria-label', 'Beli atau jual ' + asset.name);

      const avatar = document.createElement('span');
      avatar.className = 'tile__avatar';
      if (asset.iconId) {
        avatar.classList.add('tile__avatar--logo');
        avatar.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#' +
          asset.iconId +
          '"></use></svg>';
      } else {
        avatar.style.backgroundColor = asset.color;
        avatar.textContent = asset.symbol;
      }

      const infoEl = document.createElement('span');
      infoEl.className = 'tile__info';

      const nameRow = document.createElement('span');
      nameRow.className = 'tile__name-row';

      const nameEl = document.createElement('span');
      nameEl.className = 'tile__name';
      nameEl.textContent = asset.name;

      nameRow.appendChild(nameEl);

      const symbolEl = document.createElement('span');
      symbolEl.className = 'tile__symbol';
      symbolEl.textContent = 'Tersedia';

      infoEl.appendChild(nameRow);
      infoEl.appendChild(symbolEl);

      const rightEl = document.createElement('span');
      rightEl.className = 'tile__right';

      const priceEl = document.createElement('span');
      priceEl.className = 'tile__price';

      const changeEl = document.createElement('span');
      changeEl.className = 'tile__change tile__change--up';

      rightEl.appendChild(priceEl);
      rightEl.appendChild(changeEl);

      tile.appendChild(avatar);
      tile.appendChild(infoEl);
      tile.appendChild(rightEl);
      track.appendChild(tile);

      shelfTiles.push({
        asset: asset,
        tile: tile,
        symbolEl: symbolEl,
        priceEl: priceEl,
        changeEl: changeEl
      });
    });
  });
  shelvesBuilt = true;
}

/**
 * Memformat harga per unit untuk tile: penuh di bawah threshold, ringkas di atasnya.
 */
function formatTilePrice(price) {
  const safe = Number.isFinite(price) ? price : 0;
  if (Math.abs(safe) >= CONFIG.TILE_PRICE_COMPACT_THRESHOLD) {
    return formatUsdCompact(safe);
  }
  return formatUsdFull(safe);
}

/**
 * Memperbarui baris produk pasar pada daftar seluruh produk investasi.
 */
function updateShelves() {
  shelfTiles.forEach(function (entry) {
    const asset = entry.asset;
    const holding = state.holdings[asset.id];
    const units = holding && Number.isFinite(Number(holding.units)) ? Number(holding.units) : 0;
    const currentPrice = getCurrentAssetPrice(asset.id);
    const changePct = getAssetChangePercent(asset.id);
    const isUp = changePct >= 0;
    const hasUnits = units > 0;

    entry.tile.classList.toggle('tile--owned', hasUnits);

    if (entry.symbolEl) {
      entry.symbolEl.textContent = hasUnits
        ? 'Dimiliki \u00B7 ' + formatIntegerID(units) + ' ' + asset.unitLabel
        : 'Tersedia';
    }

    if (entry.priceEl) {
      const previousRaw = entry.tile.dataset.prevPrice;
      const previousPrice = previousRaw ? Number(previousRaw) : Number.NaN;
      if (Number.isFinite(previousPrice) && previousPrice > 0 && previousPrice !== currentPrice) {
        entry.tile.classList.remove('tile--flash-up', 'tile--flash-down');
        void entry.tile.offsetWidth;
        entry.tile.classList.add(
          currentPrice > previousPrice ? 'tile--flash-up' : 'tile--flash-down'
        );
      }
      entry.tile.dataset.prevPrice = String(currentPrice);
      entry.priceEl.textContent = formatTilePrice(currentPrice);
      entry.priceEl.title = formatUsdFull(currentPrice);
    }

    if (entry.changeEl) {
      const absStr = Math.abs(changePct).toFixed(CONFIG.CURRENCY_DECIMALS).replace('.', ',');
      entry.changeEl.className =
        'tile__change ' + (isUp ? 'tile__change--up' : 'tile__change--down');
      entry.changeEl.textContent = (isUp ? '\u25B2 ' : '\u25BC ') + absStr + '%';
    }
  });
}

/**
 * Memperbarui kartu portofolio biru di bagian atas layar daftar produk kategori.
 */
function updateCategoryPortfolioCard(allocation) {
  if (!activeCategoryScreen || !allocation) return;
  const meta = CATEGORY_META[activeCategoryScreen];
  const summary = allocation.byCategory[activeCategoryScreen];
  if (!meta || !summary) return;

  if (catPortfolioTitle) catPortfolioTitle.textContent = meta.portfolioTitle;
  if (catPortfolioLabel) catPortfolioLabel.textContent = meta.portfolioLabel;
  if (catPortfolioValue) {
    catPortfolioValue.textContent = formatUsdFull(summary.totalValue);
  }
  if (catPortfolioPnl) {
    const isPositive = summary.pnlValue >= 0;
    const signPrefix = isPositive ? '+ ' : '- ';
    const absPctStr = Math.abs(summary.pnlPct).toFixed(CONFIG.CURRENCY_DECIMALS).replace('.', ',');
    catPortfolioPnl.textContent =
      signPrefix + formatUsdFull(Math.abs(summary.pnlValue)) + ' (' + absPctStr + '%)';
    catPortfolioPnl.classList.toggle('pnl--positive', isPositive);
    catPortfolioPnl.classList.toggle('pnl--negative', !isPositive);
  }
  if (catPortfolioYield) {
    catPortfolioYield.textContent = formatUsdFull(summary.hourlyYield);
  }
}

/**
 * Merender daftar produk yang dimiliki pemain di layar Portofolio Saya (dalam kartu biru).
 */
function updateOwnedListScreen() {
  if (!hasDOM || !activeCategoryScreen || !ownedListTrack) return;
  const meta = CATEGORY_META[activeCategoryScreen];

  const ownedRows = ASSETS.filter(function (asset) {
    if (asset.category !== activeCategoryScreen) return false;
    const holding = state.holdings[asset.id];
    const units = holding && Number.isFinite(Number(holding.units)) ? Number(holding.units) : 0;
    return units > 0;
  }).map(function (asset) {
    const holding = state.holdings[asset.id];
    const units = Number(holding.units);
    const avgEntry = Number.isFinite(Number(holding.avgEntry)) ? Number(holding.avgEntry) : 0;
    const currentPrice = getCurrentAssetPrice(asset.id);
    const positionValue = units * currentPrice;
    const totalCost = units * avgEntry;
    const rawPct = totalCost > 0 ? ((positionValue - totalCost) / totalCost) * 100 : 0;
    return {
      asset: asset,
      units: units,
      positionValue: positionValue,
      unrealizedPct: Number.isFinite(rawPct) ? rawPct : 0
    };
  });

  ownedRows.sort(function (a, b) {
    return b.positionValue - a.positionValue;
  });

  ownedListTrack.innerHTML = '';
  if (ownedRows.length === 0) {
    if (ownedEmptyText && meta) {
      ownedEmptyText.textContent = meta.emptyText;
    }
    if (ownedEmptyState) ownedEmptyState.hidden = false;
    return;
  }

  if (ownedEmptyState) ownedEmptyState.hidden = true;

  ownedRows.forEach(function (item) {
    const asset = item.asset;
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    tile.setAttribute('data-asset-id', asset.id);
    tile.setAttribute('role', 'listitem');
    tile.setAttribute('aria-label', 'Buka detail ' + asset.name);

    const avatar = document.createElement('span');
    avatar.className = 'tile__avatar';
    if (asset.iconId) {
      avatar.classList.add('tile__avatar--logo');
      avatar.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#' +
        asset.iconId +
        '"></use></svg>';
    } else {
      avatar.style.backgroundColor = asset.color;
      avatar.textContent = asset.symbol;
    }

    const infoEl = document.createElement('span');
    infoEl.className = 'tile__info';

    const nameRow = document.createElement('span');
    nameRow.className = 'tile__name-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'tile__name';
    nameEl.textContent = asset.name;
    nameRow.appendChild(nameEl);

    const unitsEl = document.createElement('span');
    unitsEl.className = 'tile__symbol';
    unitsEl.textContent = formatIntegerID(item.units) + ' ' + asset.unitLabel;

    infoEl.appendChild(nameRow);
    infoEl.appendChild(unitsEl);

    const rightEl = document.createElement('span');
    rightEl.className = 'tile__right';

    const valueEl = document.createElement('span');
    valueEl.className = 'tile__price';
    valueEl.textContent = formatTilePrice(item.positionValue);
    valueEl.title = formatUsdFull(item.positionValue);

    const pnlUp = item.unrealizedPct >= 0;
    const pnlEl = document.createElement('span');
    pnlEl.className = 'tile__change ' + (pnlUp ? 'tile__change--up' : 'tile__change--down');
    pnlEl.textContent = formatSignedPercent(item.unrealizedPct);

    rightEl.appendChild(valueEl);
    rightEl.appendChild(pnlEl);

    tile.appendChild(avatar);
    tile.appendChild(infoEl);
    tile.appendChild(rightEl);
    ownedListTrack.appendChild(tile);
  });
}

/**
 * Merender layar utama Investasi: hero portofolio, alokasi aset, dan daftar kategori.
 */
export function renderInvestingScreen() {
  if (!investingScreen) return;

  const allocation = getPortfolioAllocation();
  const total = allocation.total;
  const hourlyYield = getTotalInvestmentHourlyYield();

  if (heroTotalValue) {
    const useCompactHero = Math.abs(total) >= CONFIG.HERO_COMPACT_THRESHOLD;
    heroTotalValue.textContent = useCompactHero ? formatUsdCompact(total) : formatUsdFull(total);
    heroTotalValue.title = formatUsdFull(total);
  }
  if (heroHourlyYield) {
    heroHourlyYield.textContent = formatUsdCompact(hourlyYield);
    heroHourlyYield.title = formatUsdFull(hourlyYield) + ' per jam';
  }

  updateDonut(allocation);

  INVEST_CATEGORIES.forEach(function (cat) {
    const value = allocation.byCategory[cat].totalValue;
    const assetCount = ASSETS.filter(function (asset) {
      return asset.category === cat;
    }).length;
    if (CAT_CARD_SUBS[cat]) {
      CAT_CARD_SUBS[cat].textContent =
        CATEGORY_META[cat].subtitle + ' \u00B7 ' + formatIntegerID(assetCount) + ' aset';
    }
    if (CAT_CARD_TOTALS[cat]) {
      CAT_CARD_TOTALS[cat].textContent = formatUsdCompact(value);
      CAT_CARD_TOTALS[cat].title = formatUsdFull(value);
    }
  });

  updateCategoryPortfolioCard(allocation);
  ensureShelvesBuilt();
  updateShelves();
  if (isOwnedScreenOpen) {
    updateOwnedListScreen();
  }
}

export function resolveTradeQuantities(currentPrice, ownedUnits) {
  const safePrice = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : 0;
  const safeOwned = Number.isFinite(ownedUnits) && ownedUnits > 0 ? Math.floor(ownedUnits) : 0;
  const maxAffordable =
    safePrice > 0 && Number.isFinite(state.balance) && state.balance >= safePrice
      ? Math.floor(state.balance / safePrice)
      : 0;

  if (state.selectedQtyMode === 'max') {
    return {
      buyQty: maxAffordable,
      sellQty: safeOwned,
      maxAffordable: maxAffordable
    };
  }

  const parsed = Number(state.selectedQtyMode);
  const fixedQty = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
  return {
    buyQty: fixedQty,
    sellQty: fixedQty,
    maxAffordable: maxAffordable
  };
}

let chartAnimRafId = null;
const chartAnimState = {
  assetId: null,
  lastTs: null,
  firstTs: null,
  lastPrice: null,
  lastWidth: 0,
  renderedPrices: null,
  renderedMinPrice: null,
  renderedMaxPrice: null,
  targetPrices: null,
  targetMinPrice: null,
  targetMaxPrice: null,
  direction: 'flat'
};

/**
 * Menghentikan animasi grafik yang sedang berjalan (saat menutup layar atau mengganti aset).
 */
export function cancelChartAnimation() {
  if (chartAnimRafId !== null && typeof root.cancelAnimationFrame === 'function') {
    root.cancelAnimationFrame(chartAnimRafId);
  }
  chartAnimRafId = null;
}

function easeOutCubic(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, CONFIG.CHART_EASE_POWER);
}

function computePriceBounds(priceValues) {
  let minPrice = priceValues[0];
  let maxPrice = priceValues[0];
  priceValues.forEach(function (val) {
    if (val < minPrice) minPrice = val;
    if (val > maxPrice) maxPrice = val;
  });

  const displayMin = minPrice;
  const displayMax = maxPrice;

  if (maxPrice <= minPrice) {
    const flatSpread = Math.max(minPrice * CONFIG.CHART_FLAT_SPREAD_RATIO, 1);
    minPrice = Math.max(0, minPrice - flatSpread);
    maxPrice = maxPrice + flatSpread;
  } else {
    const range = maxPrice - minPrice;
    minPrice = Math.max(0, minPrice - range * CONFIG.CHART_RANGE_PAD_RATIO);
    maxPrice = maxPrice + range * CONFIG.CHART_RANGE_PAD_RATIO;
  }

  return {
    displayMin: displayMin,
    displayMax: displayMax,
    scaleMin: minPrice,
    scaleMax: maxPrice
  };
}

function drawChartFrame(ctx, cssWidth, cssHeight, dpr, frame) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const plotLeft = CONFIG.CHART_PAD_LEFT;
  const plotRight = cssWidth - CONFIG.CHART_PAD_RIGHT;
  const plotTop = CONFIG.CHART_PAD_TOP;
  const plotBottom = cssHeight - CONFIG.CHART_PAD_BOTTOM;
  const plotW = Math.max(1, plotRight - plotLeft);
  const plotH = Math.max(1, plotBottom - plotTop);

  // Grid horizontal tipis (atas, tengah, bawah)
  ctx.strokeStyle = CONFIG.CHART_GRID_COLOR;
  ctx.lineWidth = 1;
  const midGridY = (plotTop + plotBottom) / CONFIG.CHART_MID_DIVISOR;
  [plotTop, midGridY, plotBottom].forEach(function (gy) {
    ctx.beginPath();
    ctx.moveTo(plotLeft, gy);
    ctx.lineTo(plotRight, gy);
    ctx.stroke();
  });

  const coords = frame.coords;
  const dotCoord = frame.dotCoord || coords[coords.length - 1];
  const clipRight =
    typeof frame.clipRight === 'number' ? frame.clipRight : plotRight;

  function traceSmoothCurve() {
    ctx.moveTo(coords[0].x, coords[0].y);
    for (let i = 0; i < coords.length - 1; i += 1) {
      const midX = (coords[i].x + coords[i + 1].x) / CONFIG.CHART_MID_DIVISOR;
      const midY = (coords[i].y + coords[i + 1].y) / CONFIG.CHART_MID_DIVISOR;
      if (i === 0) {
        ctx.lineTo(midX, midY);
      } else {
        ctx.quadraticCurveTo(coords[i].x, coords[i].y, midX, midY);
      }
    }
    const last = coords[coords.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  // Klip area plot agar titik yang bergeser ke kiri terpotong rapi di batas grafik
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    plotLeft,
    plotTop - CONFIG.CHART_CLIP_PAD_PX,
    Math.max(1, clipRight - plotLeft),
    plotH + CONFIG.CHART_CLIP_PAD_PX + CONFIG.CHART_CLIP_PAD_PX
  );
  ctx.clip();

  // Area gradient di bawah kurva (mendukung fade-in halus saat grafik pertama kali dimuat)
  const fillAlpha = typeof frame.fillAlpha === 'number' ? frame.fillAlpha : 1;
  const lastCoord = coords[coords.length - 1];
  ctx.save();
  ctx.globalAlpha = fillAlpha;
  ctx.beginPath();
  traceSmoothCurve();
  ctx.lineTo(lastCoord.x, plotBottom);
  ctx.lineTo(coords[0].x, plotBottom);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
  grad.addColorStop(0, CONFIG.CHART_FILL_TOP);
  grad.addColorStop(1, CONFIG.CHART_FILL_BOTTOM);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  // Garis kurva utama
  ctx.beginPath();
  traceSmoothCurve();
  ctx.strokeStyle = CONFIG.CHART_STROKE_COLOR;
  ctx.lineWidth = CONFIG.CHART_LINE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();

  // Halo denyut langsung saat terjadi pembaruan harga
  if (typeof frame.pulseProgress === 'number' && frame.pulseProgress > 0 && frame.pulseProgress < 1) {
    const pulseEase = easeOutCubic(frame.pulseProgress);
    const pulseRadius =
      CONFIG.CHART_DOT_OUTER_RADIUS +
      (CONFIG.CHART_PULSE_MAX_RADIUS - CONFIG.CHART_DOT_OUTER_RADIUS) * pulseEase;
    const pulseAlpha = CONFIG.CHART_PULSE_START_ALPHA * (1 - frame.pulseProgress);
    let pulseRgb = CONFIG.CHART_PULSE_COLOR_FLAT;
    if (frame.direction === 'up') {
      pulseRgb = CONFIG.CHART_PULSE_COLOR_UP;
    } else if (frame.direction === 'down') {
      pulseRgb = CONFIG.CHART_PULSE_COLOR_DOWN;
    }
    ctx.beginPath();
    ctx.arc(dotCoord.x, dotCoord.y, pulseRadius, 0, Math.PI * CONFIG.CHART_MID_DIVISOR);
    ctx.strokeStyle = 'rgba(' + pulseRgb + ', ' + pulseAlpha.toFixed(CONFIG.CHART_EASE_POWER) + ')';
    ctx.lineWidth = CONFIG.CHART_PULSE_STROKE_WIDTH;
    ctx.stroke();
  }

  // Titik harga terakhir di ujung kanan (diwarnai sesuai arah tick selama denyut aktif)
  let dotColor = CONFIG.CHART_STROKE_COLOR;
  if (typeof frame.pulseProgress === 'number' && frame.pulseProgress < 1) {
    if (frame.direction === 'up') {
      dotColor = CONFIG.CHART_DOT_UP_COLOR;
    } else if (frame.direction === 'down') {
      dotColor = CONFIG.CHART_DOT_DOWN_COLOR;
    }
  }
  ctx.beginPath();
  ctx.arc(dotCoord.x, dotCoord.y, CONFIG.CHART_DOT_OUTER_RADIUS, 0, Math.PI * CONFIG.CHART_MID_DIVISOR);
  ctx.fillStyle = CONFIG.CHART_DOT_BG_COLOR;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(dotCoord.x, dotCoord.y, CONFIG.CHART_DOT_INNER_RADIUS, 0, Math.PI * CONFIG.CHART_MID_DIVISOR);
  ctx.fillStyle = dotColor;
  ctx.fill();

  // Label Y-axis (Maks & Min) + X-axis (HH:MM)
  ctx.font = CONFIG.CHART_FONT;
  ctx.fillStyle = CONFIG.CHART_LABEL_COLOR;

  ctx.textAlign = 'left';
  ctx.fillText('Maks ' + formatRupiahCompact(frame.displayMax), plotLeft, CONFIG.CHART_LABEL_OFFSET_TOP_Y);
  ctx.textAlign = 'right';
  ctx.fillText('Min ' + formatRupiahCompact(frame.displayMin), plotRight, CONFIG.CHART_LABEL_OFFSET_TOP_Y);

  const xLabelY = plotBottom + CONFIG.CHART_X_LABEL_OFFSET_Y;
  ctx.textAlign = 'left';
  ctx.fillText(formatTimeHHMM(frame.firstTs), plotLeft, xLabelY);
  ctx.textAlign = 'center';
  ctx.fillText(formatTimeHHMM(frame.midTs), plotLeft + plotW / CONFIG.CHART_MID_DIVISOR, xLabelY);
  ctx.textAlign = 'right';
  ctx.fillText(formatTimeHHMM(frame.lastTs), plotRight, xLabelY);
}

/**
 * Menggambar grafik riwayat harga aset di Canvas 2D dengan transisi halus saat data diperbarui real-time.
 */
export function renderAssetPriceChart(asset) {
  if (!assetPriceCanvas || typeof assetPriceCanvas.getContext !== 'function') return;
  const ctx = assetPriceCanvas.getContext('2d');
  if (!ctx) return;

  const rect = assetPriceCanvas.getBoundingClientRect();
  const cssWidth = rect && rect.width > 0 ? rect.width : CONFIG.CHART_FALLBACK_WIDTH_PX;
  const cssHeight = CONFIG.CHART_CSS_HEIGHT_PX;
  const dpr =
    Number.isFinite(root.devicePixelRatio) && root.devicePixelRatio > 0
      ? root.devicePixelRatio
      : 1;

  const targetW = Math.round(cssWidth * dpr);
  const targetH = Math.round(cssHeight * dpr);
  if (assetPriceCanvas.width !== targetW || assetPriceCanvas.height !== targetH) {
    assetPriceCanvas.width = targetW;
    assetPriceCanvas.height = targetH;
  }

  const rawHistory = Array.isArray(state.priceHistory[asset.id])
    ? state.priceHistory[asset.id]
    : [];
  const fallbackNow = Date.now();
  const fallbackPrice = getCurrentAssetPrice(asset.id);
  const points = rawHistory.filter(function (pt) {
    return pt && Number.isFinite(pt.price) && pt.price > 0;
  });
  if (points.length === 0) {
    points.push(
      { ts: fallbackNow - CONFIG.PRICE_TICK_MS, price: fallbackPrice },
      { ts: fallbackNow, price: fallbackPrice }
    );
  } else if (points.length === 1) {
    points.unshift({ ts: points[0].ts - CONFIG.PRICE_TICK_MS, price: points[0].price });
  }

  const targetPrices = points.map(function (pt) {
    return pt.price;
  });
  const targetBounds = computePriceBounds(targetPrices);

  const plotLeft = CONFIG.CHART_PAD_LEFT;
  const plotRight = cssWidth - CONFIG.CHART_PAD_RIGHT;
  const plotTop = CONFIG.CHART_PAD_TOP;
  const plotBottom = cssHeight - CONFIG.CHART_PAD_BOTTOM;
  const plotW = Math.max(1, plotRight - plotLeft);
  const plotH = Math.max(1, plotBottom - plotTop);

  const firstTs = points[0].ts;
  const midTs = points[Math.floor(points.length / CONFIG.CHART_MID_DIVISOR)].ts;
  const lastTs = points[points.length - 1].ts;
  const latestPrice = targetPrices[targetPrices.length - 1];

  const isSameAsset = chartAnimState.assetId === asset.id;
  const hasNewTick =
    isSameAsset &&
    (lastTs !== chartAnimState.lastTs || latestPrice !== chartAnimState.lastPrice);
  const isResized = isSameAsset && chartAnimState.lastWidth !== cssWidth;

  // Jika tidak ada pembaruan harga (mis. user mengganti chip jumlah beli), jangan ganggu animasi aktif
  if (isSameAsset && !hasNewTick && !isResized && chartAnimRafId !== null) {
    return;
  }

  const prefersReducedMotion =
    typeof root.matchMedia === 'function' &&
    root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canAnimate =
    hasDOM &&
    typeof root.requestAnimationFrame === 'function' &&
    !prefersReducedMotion;

  function buildRestingCoords(priceValues, minScale, maxScale) {
    const safeSpan = maxScale - minScale > 0 ? maxScale - minScale : 1;
    return priceValues.map(function (val, idx) {
      const x = plotLeft + (idx / (priceValues.length - 1)) * plotW;
      const y = plotBottom - ((val - minScale) / safeSpan) * plotH;
      return { x: x, y: y };
    });
  }

  // Gambar statis jika reduced-motion aktif atau bukan DOM/animasi tidak diperlukan
  if (!canAnimate || (isSameAsset && !hasNewTick)) {
    cancelChartAnimation();
    chartAnimState.assetId = asset.id;
    chartAnimState.lastTs = lastTs;
    chartAnimState.firstTs = firstTs;
    chartAnimState.lastPrice = latestPrice;
    chartAnimState.lastWidth = cssWidth;
    chartAnimState.renderedPrices = targetPrices.slice();
    chartAnimState.renderedMinPrice = targetBounds.scaleMin;
    chartAnimState.renderedMaxPrice = targetBounds.scaleMax;
    chartAnimState.targetPrices = targetPrices.slice();
    chartAnimState.targetMinPrice = targetBounds.scaleMin;
    chartAnimState.targetMaxPrice = targetBounds.scaleMax;
    chartAnimState.direction = 'flat';

    const steadyCoords = buildRestingCoords(
      targetPrices,
      targetBounds.scaleMin,
      targetBounds.scaleMax
    );
    drawChartFrame(ctx, cssWidth, cssHeight, dpr, {
      coords: steadyCoords,
      dotCoord: steadyCoords[steadyCoords.length - 1],
      displayMin: targetBounds.displayMin,
      displayMax: targetBounds.displayMax,
      firstTs: firstTs,
      midTs: midTs,
      lastTs: lastTs,
      pulseProgress: null,
      direction: 'flat'
    });
    return;
  }

  cancelChartAnimation();

  // Mode A: Pembukaan awal aset — animasi slide-in, sapuan horizontal & kurva mengembang mulus
  if (!isSameAsset) {
    chartAnimState.assetId = asset.id;
    chartAnimState.lastTs = lastTs;
    chartAnimState.firstTs = firstTs;
    chartAnimState.lastPrice = latestPrice;
    chartAnimState.lastWidth = cssWidth;
    chartAnimState.renderedPrices = targetPrices.slice();
    chartAnimState.renderedMinPrice = targetBounds.scaleMin;
    chartAnimState.renderedMaxPrice = targetBounds.scaleMax;
    chartAnimState.targetPrices = targetPrices.slice();
    chartAnimState.targetMinPrice = targetBounds.scaleMin;
    chartAnimState.targetMaxPrice = targetBounds.scaleMax;
    chartAnimState.direction = 'flat';

    const revealCoords = buildRestingCoords(
      targetPrices,
      targetBounds.scaleMin,
      targetBounds.scaleMax
    );
    const midY = (plotTop + plotBottom) / CONFIG.CHART_MID_DIVISOR;
    const revealStart = root.performance && typeof root.performance.now === 'function'
      ? root.performance.now()
      : Date.now();
    const totalRevealMs = CONFIG.CHART_REVEAL_DURATION_MS + CONFIG.CHART_PULSE_DURATION_MS;

    const stepReveal = function (nowTs) {
      if (state.selectedAssetId !== asset.id) {
        chartAnimRafId = null;
        return;
      }
      const nowVal = typeof nowTs === 'number' ? nowTs : Date.now();
      const elapsed = Math.max(0, nowVal - revealStart);
      const progress = Math.min(1, elapsed / CONFIG.CHART_REVEAL_DURATION_MS);
      const ease = easeOutCubic(progress);
      const clipX = plotLeft + ease * plotW;
      const slideOffsetX = (1 - ease) * CONFIG.CHART_REVEAL_SLIDE_PX;

      const frameCoords = revealCoords.map(function (pt) {
        return {
          x: pt.x + slideOffsetX,
          y: midY + (pt.y - midY) * ease
        };
      });

      const normIdx = ((clipX - plotLeft) / plotW) * (frameCoords.length - 1);
      const idxLow = Math.max(0, Math.min(frameCoords.length - 1, Math.floor(normIdx)));
      const idxHigh = Math.min(frameCoords.length - 1, idxLow + 1);
      const frac = normIdx - idxLow;
      const penX =
        progress >= 1
          ? frameCoords[frameCoords.length - 1].x
          : Math.min(plotRight, clipX + slideOffsetX);
      const penY =
        frameCoords[idxLow].y + (frameCoords[idxHigh].y - frameCoords[idxLow].y) * frac;

      let pulseProgress = null;
      if (elapsed >= CONFIG.CHART_REVEAL_DURATION_MS) {
        const pulseElapsed = elapsed - CONFIG.CHART_REVEAL_DURATION_MS;
        pulseProgress = Math.min(1, pulseElapsed / CONFIG.CHART_PULSE_DURATION_MS);
      }

      drawChartFrame(ctx, cssWidth, cssHeight, dpr, {
        coords: frameCoords,
        dotCoord: { x: penX, y: penY },
        clipRight: progress >= 1 ? plotRight : clipX,
        fillAlpha: ease,
        displayMin: targetBounds.displayMin,
        displayMax: targetBounds.displayMax,
        firstTs: firstTs,
        midTs: midTs,
        lastTs: lastTs,
        pulseProgress: pulseProgress !== null && pulseProgress < 1 ? pulseProgress : null,
        direction: 'flat'
      });

      if (elapsed < totalRevealMs) {
        chartAnimRafId = root.requestAnimationFrame(stepReveal);
      } else {
        chartAnimRafId = null;
      }
    };

    chartAnimRafId = root.requestAnimationFrame(stepReveal);
    return;
  }

  // Mode B: Pembaruan tick real-time — kurva bergeser halus ke kiri + ujung kanan bertransisi & berdenyut
  const prevPrices =
    Array.isArray(chartAnimState.renderedPrices) && chartAnimState.renderedPrices.length > 1
      ? chartAnimState.renderedPrices.slice()
      : targetPrices.slice();
  const prevMin = Number.isFinite(chartAnimState.renderedMinPrice)
    ? chartAnimState.renderedMinPrice
    : targetBounds.scaleMin;
  const prevMax = Number.isFinite(chartAnimState.renderedMaxPrice)
    ? chartAnimState.renderedMaxPrice
    : targetBounds.scaleMax;
  const prevLastPrice = Number.isFinite(chartAnimState.lastPrice)
    ? chartAnimState.lastPrice
    : prevPrices[prevPrices.length - 1];

  let direction = 'flat';
  if (latestPrice > prevLastPrice) {
    direction = 'up';
  } else if (latestPrice < prevLastPrice) {
    direction = 'down';
  }

  const isWindowShifted =
    firstTs > (chartAnimState.firstTs || 0) && prevPrices.length === targetPrices.length;

  chartAnimState.lastTs = lastTs;
  chartAnimState.firstTs = firstTs;
  chartAnimState.lastPrice = latestPrice;
  chartAnimState.lastWidth = cssWidth;
  chartAnimState.targetPrices = targetPrices.slice();
  chartAnimState.targetMinPrice = targetBounds.scaleMin;
  chartAnimState.targetMaxPrice = targetBounds.scaleMax;
  chartAnimState.direction = direction;

  const animStart = root.performance && typeof root.performance.now === 'function'
    ? root.performance.now()
    : Date.now();
  const stepX = plotW / (targetPrices.length - 1);

  const stepTick = function (nowTs) {
    if (state.selectedAssetId !== asset.id) {
      chartAnimRafId = null;
      return;
    }
    const nowVal = typeof nowTs === 'number' ? nowTs : Date.now();
    const elapsed = Math.max(0, nowVal - animStart);
    const morphProgress = Math.min(1, elapsed / CONFIG.CHART_ANIM_DURATION_MS);
    const pulseProgress = Math.min(1, elapsed / CONFIG.CHART_PULSE_DURATION_MS);
    const ease = easeOutCubic(morphProgress);

    const curMin = prevMin + (targetBounds.scaleMin - prevMin) * ease;
    const curMax = prevMax + (targetBounds.scaleMax - prevMax) * ease;
    const curSpan = curMax - curMin > 0 ? curMax - curMin : 1;

    let frameCoords;
    const currentSnapshotPrices = new Array(targetPrices.length);

    if (isWindowShifted) {
      frameCoords = new Array(prevPrices.length + 1);
      for (let i = 0; i < prevPrices.length; i += 1) {
        const x = plotLeft + (i - ease) * stepX;
        const y = plotBottom - ((prevPrices[i] - curMin) / curSpan) * plotH;
        frameCoords[i] = { x: x, y: y };
      }
      const tipPrice = prevLastPrice + (latestPrice - prevLastPrice) * ease;
      const tipY = plotBottom - ((tipPrice - curMin) / curSpan) * plotH;
      frameCoords[prevPrices.length] = { x: plotRight, y: tipY };

      for (let j = 0; j < targetPrices.length - 1; j += 1) {
        currentSnapshotPrices[j] =
          prevPrices[j] + (targetPrices[j] - prevPrices[j]) * ease;
      }
      currentSnapshotPrices[targetPrices.length - 1] = tipPrice;
    } else {
      frameCoords = new Array(targetPrices.length);
      for (let i = 0; i < targetPrices.length; i += 1) {
        const fromVal = prevPrices[Math.min(i, prevPrices.length - 1)];
        const interpVal = fromVal + (targetPrices[i] - fromVal) * ease;
        currentSnapshotPrices[i] = interpVal;
        const x = plotLeft + (i / (targetPrices.length - 1)) * plotW;
        const y = plotBottom - ((interpVal - curMin) / curSpan) * plotH;
        frameCoords[i] = { x: x, y: y };
      }
    }

    chartAnimState.renderedPrices = currentSnapshotPrices;
    chartAnimState.renderedMinPrice = curMin;
    chartAnimState.renderedMaxPrice = curMax;

    const dotCoord = frameCoords[frameCoords.length - 1];
    drawChartFrame(ctx, cssWidth, cssHeight, dpr, {
      coords: frameCoords,
      dotCoord: dotCoord,
      displayMin: targetBounds.displayMin,
      displayMax: targetBounds.displayMax,
      firstTs: firstTs,
      midTs: midTs,
      lastTs: lastTs,
      pulseProgress: pulseProgress < 1 ? pulseProgress : null,
      direction: direction
    });

    if (morphProgress < 1 || pulseProgress < 1) {
      chartAnimRafId = root.requestAnimationFrame(stepTick);
    } else {
      chartAnimState.renderedPrices = targetPrices.slice();
      chartAnimState.renderedMinPrice = targetBounds.scaleMin;
      chartAnimState.renderedMaxPrice = targetBounds.scaleMax;
      chartAnimRafId = null;
    }
  };

  chartAnimRafId = root.requestAnimationFrame(stepTick);
}
/**
 * Merender informasi layar detail aset yang dipilih beserta grafik Canvas 2D.
 */
export function renderAssetDetailScreen() {
  if (!assetDetailScreen || !state.selectedAssetId) return;
  const asset = getAssetById(state.selectedAssetId);
  if (!asset) return;

  const currentPrice = getCurrentAssetPrice(asset.id);
  const changePct = getAssetChangePercent(asset.id);
  const holding = state.holdings[asset.id];
  const units = holding && Number.isFinite(Number(holding.units)) ? Number(holding.units) : 0;
  const avgEntry =
    holding && Number.isFinite(Number(holding.avgEntry)) ? Number(holding.avgEntry) : 0;
  const totalCost = units > 0 ? units * avgEntry : 0;
  const marketValue = units > 0 ? units * currentPrice : 0;
  const unrealizedValue = units > 0 ? marketValue - totalCost : 0;
  const rawPct = totalCost > 0 ? (unrealizedValue / totalCost) * 100 : 0;
  const unrealizedPct = Number.isFinite(rawPct) ? rawPct : 0;
  const assetHourlyYield =
    asset.yieldRate > 0 && units > 0 ? marketValue * asset.yieldRate : 0;

  if (detailAssetName) detailAssetName.textContent = asset.name;
  if (detailAssetCategory) detailAssetCategory.textContent = asset.category;
  if (detailWalletBalance) {
    detailWalletBalance.textContent = formatRupiahCompact(state.balance);
    detailWalletBalance.title = formatRupiahFull(state.balance);
  }
  if (detailMarketPriceHero) {
    const prevAssetId = detailMarketPriceHero.dataset.assetId;
    const prevHeroPrice = Number(detailMarketPriceHero.dataset.lastPrice);
    if (prevAssetId === asset.id && Number.isFinite(prevHeroPrice) && prevHeroPrice !== currentPrice) {
      detailMarketPriceHero.classList.remove('detail-price-flash--up', 'detail-price-flash--down');
      void detailMarketPriceHero.offsetWidth;
      detailMarketPriceHero.classList.add(
        currentPrice > prevHeroPrice ? 'detail-price-flash--up' : 'detail-price-flash--down'
      );
    } else if (prevAssetId !== asset.id) {
      detailMarketPriceHero.classList.remove('detail-price-flash--up', 'detail-price-flash--down');
    }
    detailMarketPriceHero.dataset.assetId = asset.id;
    detailMarketPriceHero.dataset.lastPrice = String(currentPrice);
    detailMarketPriceHero.textContent = formatRupiahCompact(currentPrice);
    detailMarketPriceHero.title = formatRupiahFull(currentPrice);
  }
  if (detailPriceChange) {
    const up = changePct >= 0;
    detailPriceChange.textContent = formatSignedPercent(changePct);
    detailPriceChange.classList.toggle('pnl--positive', up);
    detailPriceChange.classList.toggle('pnl--negative', !up);
  }
  if (detailOwnedUnits) {
    detailOwnedUnits.textContent = formatIntegerID(units) + ' ' + asset.unitLabel;
  }
  if (detailMarketPrice) {
    detailMarketPrice.textContent = formatRupiahFull(currentPrice);
  }
  if (detailAvgEntry) {
    detailAvgEntry.textContent = units > 0 ? formatRupiahFull(avgEntry) : '—';
  }
  if (detailMarketValue) {
    detailMarketValue.textContent = formatRupiahFull(marketValue);
  }
  if (detailTotalCost) {
    detailTotalCost.textContent = formatRupiahFull(totalCost);
  }
  if (detailUnrealizedPnl) {
    const pos = unrealizedValue >= 0;
    const prefix = unrealizedValue > 0 ? '+' : '';
    detailUnrealizedPnl.textContent =
      prefix +
      formatRupiahCompact(unrealizedValue) +
      ' (' +
      formatSignedPercent(unrealizedPct) +
      ')';
    detailUnrealizedPnl.classList.toggle('pnl--positive', pos);
    detailUnrealizedPnl.classList.toggle('pnl--negative', !pos);
  }
  if (detailYieldRow && detailHourlyYield) {
    if (asset.yieldRate > 0) {
      detailYieldRow.hidden = false;
      detailHourlyYield.textContent = formatRupiahCompact(assetHourlyYield) + '/jam';
      detailHourlyYield.title = formatRupiahFull(assetHourlyYield) + ' per jam';
    } else {
      detailYieldRow.hidden = true;
    }
  }

  // Status chip jumlah [1] [10] [100] [Maks] & tombol BELI / JUAL
  detailQtyChips.forEach(function (chip) {
    const active = chip.getAttribute('data-trade-qty') === state.selectedQtyMode;
    chip.classList.toggle('qty-chip--active', active);
    chip.setAttribute('aria-pressed', String(active));
  });

  const trade = resolveTradeQuantities(currentPrice, units);
  const estBuyCost = trade.buyQty * currentPrice;
  const canBuy =
    trade.buyQty >= 1 &&
    Number.isFinite(estBuyCost) &&
    estBuyCost > 0 &&
    state.balance >= estBuyCost;
  const canSell = units > 0 && trade.sellQty >= 1 && trade.sellQty <= units;

  if (detailBuyBtn) {
    detailBuyBtn.disabled = !canBuy;
  }
  if (detailSellBtn) {
    detailSellBtn.disabled = !canSell;
  }
  if (detailTradeNotice) {
    if (!canBuy) {
      detailTradeNotice.textContent = 'Saldo tidak cukup';
      detailTradeNotice.classList.add('detail-trade-notice--error');
    } else if (state.selectedQtyMode === 'max') {
      detailTradeNotice.textContent =
        'Maks beli: ' +
        formatIntegerID(trade.buyQty) +
        ' ' +
        asset.unitLabel +
        ' (' +
        formatRupiahCompact(estBuyCost) +
        ')';
      detailTradeNotice.classList.remove('detail-trade-notice--error');
    } else {
      detailTradeNotice.textContent =
        formatIntegerID(trade.buyQty) +
        ' ' +
        asset.unitLabel +
        ' · ' +
        formatRupiahCompact(estBuyCost);
      detailTradeNotice.classList.remove('detail-trade-notice--error');
    }
  }

  renderAssetPriceChart(asset);
}
/**
 * Membeli aset secara atomik menggunakan saldo dompet pemain.
 * Mengembalikan true jika transaksi berhasil, false jika dibatalkan.
 */
export function buyAsset(assetId, requestedQty) {
  const asset = getAssetById(assetId);
  if (!asset) return false;

  const currentPrice = getCurrentAssetPrice(asset.id);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return false;

  const existing = state.holdings[asset.id];
  const oldUnits =
    existing && Number.isFinite(Number(existing.units)) && Number(existing.units) > 0
      ? Math.floor(Number(existing.units))
      : 0;
  const oldAvg =
    existing && Number.isFinite(Number(existing.avgEntry)) && Number(existing.avgEntry) >= 0
      ? Number(existing.avgEntry)
      : 0;

  const qty =
    requestedQty !== undefined
      ? Math.floor(Number(requestedQty))
      : resolveTradeQuantities(currentPrice, oldUnits).buyQty;

  if (!Number.isFinite(qty) || qty < 1) return false;

  const cost = Math.round(qty * currentPrice * 100) / 100;
  if (!Number.isFinite(cost) || cost <= 0 || state.balance < cost) {
    return false;
  }

  const newUnits = oldUnits + qty;
  const rawNewAvg = (oldUnits * oldAvg + qty * currentPrice) / newUnits;
  const newAvg = Number.isFinite(rawNewAvg) ? Math.round(rawNewAvg * 100) / 100 : currentPrice;

  state.balance = Math.max(0, Math.round((state.balance - cost) * 100) / 100);
  state.holdings[asset.id] = {
    units: newUnits,
    avgEntry: newAvg
  };

  saveState({ syncImmediately: true });
  renderStats();
  renderUpgrades();
  renderInvestingScreen();
  if (state.selectedAssetId === asset.id) {
    renderAssetDetailScreen();
  }
  triggerHaptic();
  playCoinBlip();
  showToast('Transaksi Investasi', 'Beli ' + formatIntegerID(qty) + ' ' + asset.name + ' berhasil');
  return true;
}

/**
 * Menjual aset yang dimiliki secara atomik dan menambahkannya ke saldo dompet pemain.
 * Mengembalikan true jika transaksi berhasil, false jika dibatalkan.
 */
export function sellAsset(assetId, requestedQty) {
  const asset = getAssetById(assetId);
  if (!asset) return false;

  const existing = state.holdings[asset.id];
  const oldUnits =
    existing && Number.isFinite(Number(existing.units)) && Number(existing.units) > 0
      ? Math.floor(Number(existing.units))
      : 0;
  const oldAvg =
    existing && Number.isFinite(Number(existing.avgEntry)) && Number(existing.avgEntry) >= 0
      ? Number(existing.avgEntry)
      : 0;

  if (oldUnits < 1) return false;

  const currentPrice = getCurrentAssetPrice(asset.id);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return false;

  const qty =
    requestedQty !== undefined
      ? Math.floor(Number(requestedQty))
      : resolveTradeQuantities(currentPrice, oldUnits).sellQty;

  if (!Number.isFinite(qty) || qty < 1 || qty > oldUnits) {
    return false;
  }

  const proceeds = Math.round(qty * currentPrice * 100) / 100;
  if (!Number.isFinite(proceeds) || proceeds < 0) return false;

  const realizedProfit = qty * (currentPrice - oldAvg);
  state.balance = Math.round((state.balance + proceeds) * 100) / 100;
  if (Number.isFinite(realizedProfit) && realizedProfit > 0) {
    state.totalEarned = Math.round((state.totalEarned + realizedProfit) * 100) / 100;
  }

  const remainingUnits = oldUnits - qty;
  if (remainingUnits <= 0) {
    delete state.holdings[asset.id];
  } else {
    state.holdings[asset.id] = {
      units: remainingUnits,
      avgEntry: oldAvg
    };
  }

  saveState({ syncImmediately: true });
  renderStats();
  renderUpgrades();
  renderInvestingScreen();
  if (state.selectedAssetId === asset.id) {
    renderAssetDetailScreen();
  }
  checkMilestones();
  triggerHaptic();
  playCoinBlip();
  showToast('Transaksi Investasi', 'Jual ' + formatIntegerID(qty) + ' ' + asset.name + ' berhasil');
  return true;
}

export function openCategoryScreen(category) {
  if (!INVEST_CATEGORIES.includes(category) || !investingCategoryScreen || !investingScreen) return;
  activeCategoryScreen = category;
  isOwnedScreenOpen = false;
  if (investingOwnedScreen) {
    investingOwnedScreen.hidden = true;
    investingOwnedScreen.classList.remove('screen--active');
  }
  categoryShelves.forEach(function (shelf) {
    shelf.hidden = shelf.getAttribute('data-shelf') !== category;
  });
  investingScreen.hidden = true;
  investingScreen.classList.remove('screen--active');
  investingCategoryScreen.hidden = false;
  investingCategoryScreen.classList.add('screen--active');
  if (categoryBody) {
    categoryBody.scrollTop = 0;
  }
  renderInvestingScreen();
}

export function closeCategoryScreen() {
  activeCategoryScreen = null;
  isOwnedScreenOpen = false;
  if (investingOwnedScreen) {
    investingOwnedScreen.hidden = true;
    investingOwnedScreen.classList.remove('screen--active');
  }
  if (investingCategoryScreen) {
    investingCategoryScreen.hidden = true;
    investingCategoryScreen.classList.remove('screen--active');
  }
  if (investingScreen && state.activeTab === 'Investing') {
    investingScreen.hidden = false;
    investingScreen.classList.add('screen--active');
    renderInvestingScreen();
  }
}

export function openOwnedScreen() {
  if (!activeCategoryScreen || !investingOwnedScreen || !investingCategoryScreen) return;
  isOwnedScreenOpen = true;
  investingCategoryScreen.hidden = true;
  investingCategoryScreen.classList.remove('screen--active');
  investingOwnedScreen.hidden = false;
  investingOwnedScreen.classList.add('screen--active');
  if (ownedBody) {
    ownedBody.scrollTop = 0;
  }
  updateOwnedListScreen();
}

export function closeOwnedScreen() {
  isOwnedScreenOpen = false;
  if (investingOwnedScreen) {
    investingOwnedScreen.hidden = true;
    investingOwnedScreen.classList.remove('screen--active');
  }
  if (activeCategoryScreen && investingCategoryScreen && state.activeTab === 'Investing') {
    investingCategoryScreen.hidden = false;
    investingCategoryScreen.classList.add('screen--active');
    renderInvestingScreen();
  }
}

export function resetInvestingNavigation() {
  cancelChartAnimation();
  chartAnimState.assetId = null;
  activeCategoryScreen = null;
  isOwnedScreenOpen = false;
  if (investingOwnedScreen) {
    investingOwnedScreen.hidden = true;
    investingOwnedScreen.classList.remove('screen--active');
  }
  if (investingCategoryScreen) {
    investingCategoryScreen.hidden = true;
    investingCategoryScreen.classList.remove('screen--active');
  }
}

/**
 */
export function openAssetDetail(assetId) {
  const asset = getAssetById(assetId);
  if (!asset || !assetDetailScreen || !investingScreen) return;
  cancelChartAnimation();
  chartAnimState.assetId = null;
  state.selectedAssetId = asset.id;
  state.selectedQtyMode = CONFIG.DEFAULT_TRADE_QTY;
  investingScreen.hidden = true;
  investingScreen.classList.remove('screen--active');
  if (investingCategoryScreen) {
    investingCategoryScreen.hidden = true;
    investingCategoryScreen.classList.remove('screen--active');
  }
  if (investingOwnedScreen) {
    investingOwnedScreen.hidden = true;
    investingOwnedScreen.classList.remove('screen--active');
  }
  assetDetailScreen.hidden = false;
  assetDetailScreen.classList.add('screen--active');
  assetDetailScreen.classList.remove('is-entering');
  void assetDetailScreen.offsetWidth;
  assetDetailScreen.classList.add('is-entering');
  const detailBodyEl = getEl('detail-body');
  if (detailBodyEl) {
    detailBodyEl.scrollTop = 0;
  }
  renderAssetDetailScreen();
}

/**
 * Menutup layar detail aset dan kembali ke daftar dimiliki, kategori, atau dasbor investasi.
 */
export function closeAssetDetail() {
  cancelChartAnimation();
  chartAnimState.assetId = null;
  state.selectedAssetId = null;
  if (assetDetailScreen) {
    assetDetailScreen.hidden = true;
    assetDetailScreen.classList.remove('screen--active', 'is-entering');
  }
  if (state.activeTab === 'Investing') {
    if (isOwnedScreenOpen && activeCategoryScreen && investingOwnedScreen) {
      investingOwnedScreen.hidden = false;
      investingOwnedScreen.classList.add('screen--active');
      renderInvestingScreen();
    } else if (activeCategoryScreen && investingCategoryScreen) {
      investingCategoryScreen.hidden = false;
      investingCategoryScreen.classList.add('screen--active');
      renderInvestingScreen();
    } else if (investingScreen) {
      investingScreen.hidden = false;
      investingScreen.classList.add('screen--active');
      renderInvestingScreen();
    }
  }
}

/**
 * Mendaftarkan seluruh event listener khusus tab Investasi (kartu kategori, portofolio, & detail aset).
 */
export function bindInvestingEvents() {
  if (!hasDOM) return;

  legendItems.forEach(function (btn) {
    const cat = btn.getAttribute('data-legend-category');
    if (!cat) return;

    btn.addEventListener('click', function () {
      toggleLegendCategory(cat);
    });
    btn.addEventListener('mouseenter', function () {
      hoveredLegendCategory = cat;
      syncDonutHighlightUI();
    });
    btn.addEventListener('mouseleave', function () {
      if (hoveredLegendCategory === cat) {
        hoveredLegendCategory = null;
        syncDonutHighlightUI();
      }
    });
    btn.addEventListener('focus', function () {
      hoveredLegendCategory = cat;
      syncDonutHighlightUI();
    });
    btn.addEventListener('blur', function () {
      if (hoveredLegendCategory === cat) {
        hoveredLegendCategory = null;
        syncDonutHighlightUI();
      }
    });
  });

  if (donutSegmentsGroup) {
    donutSegmentsGroup.addEventListener('click', function (event) {
      const seg = event.target.closest('[data-donut-category]');
      if (!seg) return;
      toggleLegendCategory(seg.getAttribute('data-donut-category'));
    });
    donutSegmentsGroup.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const seg = event.target.closest('[data-donut-category]');
      if (!seg) return;
      event.preventDefault();
      toggleLegendCategory(seg.getAttribute('data-donut-category'));
    });
    donutSegmentsGroup.addEventListener('mouseover', function (event) {
      const seg = event.target.closest('[data-donut-category]');
      if (!seg) return;
      const cat = seg.getAttribute('data-donut-category');
      if (cat && hoveredLegendCategory !== cat) {
        hoveredLegendCategory = cat;
        syncDonutHighlightUI();
      }
    });
    donutSegmentsGroup.addEventListener('mouseleave', function () {
      if (hoveredLegendCategory) {
        hoveredLegendCategory = null;
        syncDonutHighlightUI();
      }
    });
  }

  if (allocDonutCenter) {
    allocDonutCenter.addEventListener('click', function () {
      activeLegendCategory = null;
      hoveredLegendCategory = null;
      syncDonutHighlightUI();
    });
  }

  categoryCards.forEach(function (card) {
    card.addEventListener('click', function () {
      const cat = card.getAttribute('data-invest-category');
      if (cat) {
        openCategoryScreen(cat);
      }
    });
  });

  if (categoryPortfolioCard) {
    categoryPortfolioCard.addEventListener('click', function () {
      openOwnedScreen();
    });
  }

  if (ownedEmptyCtaBtn) {
    ownedEmptyCtaBtn.addEventListener('click', function () {
      closeOwnedScreen();
    });
  }

  // Klik tile aset pada daftar kategori maupun portofolio dimiliki -> buka layar detail
  [shelfTrackSaham, shelfTrackKripto, shelfTrackForex, ownedListTrack].forEach(function (track) {
    if (!track) return;
    track.addEventListener('click', function (event) {
      const card = event.target.closest('[data-asset-id]');
      if (!card) return;
      const assetId = card.getAttribute('data-asset-id');
      if (assetId) {
        openAssetDetail(assetId);
      }
    });
  });

  if (assetDetailBackBtn) {
    assetDetailBackBtn.addEventListener('click', function () {
      closeAssetDetail();
    });
  }

  detailQtyChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      const mode = chip.getAttribute('data-trade-qty');
      if (mode) {
        state.selectedQtyMode = mode;
        renderAssetDetailScreen();
      }
    });
  });

  if (detailBuyBtn) {
    detailBuyBtn.addEventListener('click', function () {
      if (!detailBuyBtn.disabled && state.selectedAssetId) {
        buyAsset(state.selectedAssetId);
      }
    });
  }

  if (detailSellBtn) {
    detailSellBtn.addEventListener('click', function () {
      if (!detailSellBtn.disabled && state.selectedAssetId) {
        sellAsset(state.selectedAssetId);
      }
    });
  }

  document.addEventListener('keydown', function (event) {
    if (
      event.key === 'Escape' &&
      (!roadmapModal || roadmapModal.hidden) &&
      (!resetModal || resetModal.hidden) &&
      (!offlineModal || offlineModal.hidden)
    ) {
      if (assetDetailScreen && !assetDetailScreen.hidden) {
        closeAssetDetail();
      } else if (investingOwnedScreen && !investingOwnedScreen.hidden) {
        closeOwnedScreen();
      } else if (investingCategoryScreen && !investingCategoryScreen.hidden) {
        closeCategoryScreen();
      }
    }
  });

  if (root.addEventListener) {
    root.addEventListener('resize', function () {
      if (assetDetailScreen && !assetDetailScreen.hidden && state.selectedAssetId) {
        const currentAsset = getAssetById(state.selectedAssetId);
        if (currentAsset) {
          renderAssetPriceChart(currentAsset);
        }
      }
    });
  }
}
