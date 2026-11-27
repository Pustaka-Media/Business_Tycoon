/* ==========================================================================
   BUSINESS TYCOON TAP - STATE PERMAINAN & MESIN SIMPAN (Save Schema v2)

   Berisi objek state tunggal, `runtime` (skalar lintas-modul), akses
   localStorage, kalkulasi penghasilan luring, dan penulisan saldo/harga
   dengan dual throttle (500ms / 5 dtk).
   ========================================================================== */

import { CONFIG } from './config.js';
import { ASSETS } from '../data/assets.js';
import { root } from '../utils/dom.js';
import { scheduleCloudSaveSync } from './firebase.js';

export const state = {
  version: CONFIG.SAVE_SCHEMA_VERSION,
  balance: 0.0,
  perClick: CONFIG.BASE_PER_CLICK,
  perSecond: 0.0,
  totalTaps: 0,
  totalEarned: 0.0,
  upgrades: {
    gloves: 0,
    tap_machine: 0,
    auto_team: 0
  },
  holdings: {},
  lastPrices: {},
  priceHistory: {},
  settings: {
    sound: true,
    haptic: true
  },
  milestones: {},
  startDate: Date.now(),
  lastSeen: Date.now(),
  activeTab: 'Earnings',
  activeInvestCategory: 'Saham',
  selectedAssetId: null,
  ownedBusinesses: [],
  selectedQtyMode: '1'
};

// Timer & flag throttle internal modul simpan (tidak diekspor)
let saveThrottleTimer = null;
let priceSaveThrottleTimer = null;
let hasPendingSave = false;
let hasPendingPriceSave = false;

// Skalar lintas-modul yang dibagikan antar tab (counter badge, carry
// pendapatan investasi, kategori daftar ter-render, hook render Profil)
export const runtime = {
  investmentYieldCarry: 0,
  renderedListCategory: null,
  acknowledgedAffordableCount: 0,
  unseenMilestonesCount: 0,
  refreshProfileStats: null
};
export function getStorage() {
  try {
    return root.localStorage || null;
  } catch (error) {
    return null;
  }
}

/**
 * Mencari definisi aset berdasarkan id.
 */
export function getAssetById(assetId) {
  return (
    ASSETS.find(function (item) {
      return item.id === assetId;
    }) || null
  );
}

/**
 * Mengambil harga pasar terkini suatu aset (dijamin finite dan > 0).
 */
export function getCurrentAssetPrice(assetId) {
  const asset = getAssetById(assetId);
  if (!asset) return 0;
  const p = Number(state.lastPrices[assetId]);
  if (Number.isFinite(p) && p > 0) {
    return p;
  }
  return asset.initialPrice;
}

/**
 * Menghitung bonus luring berdasarkan batas waktu maksimum dan efisiensi.
 */
export function calculateOfflineBonus(ratePerSecond, elapsedMs) {
  if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) {
    return { bonus: 0, seconds: 0 };
  }
  const rawSeconds = Math.floor((Number(elapsedMs) || 0) / CONFIG.MS_PER_SECOND);
  if (rawSeconds <= 0) {
    return { bonus: 0, seconds: 0 };
  }
  const cappedSeconds = Math.min(rawSeconds, CONFIG.MAX_OFFLINE_SECONDS);
  const bonus =
    Math.round(ratePerSecond * cappedSeconds * CONFIG.OFFLINE_EFFICIENCY * 100) / 100;
  return { bonus: bonus, seconds: cappedSeconds };
}

function buildSanitizedHoldings() {
  const cleanHoldings = {};
  ASSETS.forEach(function (asset) {
    const h = state.holdings[asset.id];
    if (!h) return;
    const units = Number(h.units);
    const avgEntry = Number(h.avgEntry);
    if (Number.isFinite(units) && units >= 1 && Number.isFinite(avgEntry) && avgEntry >= 0) {
      cleanHoldings[asset.id] = {
        units: Math.floor(units),
        avgEntry: Math.round(avgEntry * 100) / 100
      };
    }
  });
  return cleanHoldings;
}

/**
 * Menulis payload Save Schema v2 secara sinkron ke localStorage.
 */
export function writeSaveImmediate(options) {
  if (saveThrottleTimer) {
    root.clearTimeout(saveThrottleTimer);
    saveThrottleTimer = null;
  }
  if (priceSaveThrottleTimer) {
    root.clearTimeout(priceSaveThrottleTimer);
    priceSaveThrottleTimer = null;
  }
  hasPendingSave = false;
  hasPendingPriceSave = false;
  const preserveSeen = Boolean(options && options.preserveLastSeen);
  if (!preserveSeen) {
    state.lastSeen = Date.now();
  }
  const storage = getStorage();
  if (!storage) return;

  const cleanHoldings = buildSanitizedHoldings();

  const cleanLastPrices = {};
  ASSETS.forEach(function (asset) {
    const p = getCurrentAssetPrice(asset.id);
    if (Number.isFinite(p) && p > 0) {
      cleanLastPrices[asset.id] = Math.round(p * 100) / 100;
    }
  });

  try {
    const payload = JSON.stringify({
      version: CONFIG.SAVE_SCHEMA_VERSION,
      balance: state.balance,
      perClick: state.perClick,
      totalTaps: state.totalTaps,
      totalEarned: state.totalEarned,
      upgrades: Object.assign({}, state.upgrades),
      holdings: cleanHoldings,
      ownedBusinesses: Array.isArray(state.ownedBusinesses) ? state.ownedBusinesses : [],
      lastPrices: cleanLastPrices,
      settings: Object.assign({}, state.settings),
      milestones: Object.assign({}, state.milestones),
      startDate: state.startDate,
      lastSeen: state.lastSeen
    });
    storage.setItem(CONFIG.STORAGE_KEY, payload);
  } catch (error) {
    // Abaikan jika kuota penyimpanan penuh atau mode privat ketat
  }
  if (!options || !options.skipCloudSync) {
    scheduleCloudSaveSync(getCloudSaveSnapshot, Boolean(options && options.syncImmediately));
  }
}

/**
 * Mengambil ringkasan progres & portofolio lengkap untuk sinkronisasi cloud save (PlayerSave + holdings).
 */
export function getCloudSaveSnapshot() {
  const unlockedMilestones = [];
  CONFIG.MILESTONES.forEach(function (m) {
    if (state.milestones && state.milestones[m.id] && unlockedMilestones.length < CONFIG.MILESTONES_MAX_COUNT) {
      unlockedMilestones.push(m.id);
    }
  });

  const upgrades = {};
  CONFIG.UPGRADE_TIERS.forEach(function (tier) {
    const lvl = state.upgrades && Number.isFinite(Number(state.upgrades[tier.id]))
      ? Math.max(0, Math.floor(Number(state.upgrades[tier.id])))
      : 0;
    upgrades[tier.id] = lvl;
  });

  return {
    balance: state.balance,
    perClick: state.perClick,
    perSecond: state.perSecond,
    totalTaps: state.totalTaps,
    totalEarned: state.totalEarned,
    upgrades: upgrades,
    milestones: unlockedMilestones,
    settings: {
      sound: state.settings ? state.settings.sound !== false : true,
      haptic: state.settings ? state.settings.haptic !== false : true
    },
    startDate: Number.isFinite(Number(state.startDate)) && Number(state.startDate) > 0
      ? Math.floor(Number(state.startDate))
      : Date.now(),
    clientSavedAt: Number.isFinite(Number(state.lastSeen)) && Number(state.lastSeen) > 0
      ? Math.floor(Number(state.lastSeen))
      : Date.now(),
    holdings: buildSanitizedHoldings()
  };
}

/**
 * Memastikan penyimpanan tertunda langsung ditulis (saat tab ditutup/sembunyi).
 */
export function flushSaveState() {
  writeSaveImmediate({ syncImmediately: true });
}

/**
 * Menyimpan payload Save Schema v2 ke localStorage dengan throttle trailing-edge 500ms.
 */
export function saveState(options) {
  state.lastSeen = Date.now();
  if (options && options.syncImmediately) {
    writeSaveImmediate({ syncImmediately: true });
    return;
  }
  hasPendingSave = true;
  if (saveThrottleTimer) {
    return;
  }
  saveThrottleTimer = root.setTimeout(function () {
    saveThrottleTimer = null;
    if (hasPendingSave) {
      writeSaveImmediate();
    }
  }, CONFIG.SAVE_THROTTLE_MS);
}

/**
 * Menyimpan lastPrices ke localStorage dengan throttle 5 detik agar hemat I/O.
 */
export function saveMarketPricesThrottled() {
  hasPendingPriceSave = true;
  if (priceSaveThrottleTimer) {
    return;
  }
  priceSaveThrottleTimer = root.setTimeout(function () {
    priceSaveThrottleTimer = null;
    if (hasPendingPriceSave) {
      writeSaveImmediate();
    }
  }, CONFIG.PRICE_SAVE_THROTTLE_MS);
}

/**
 * Menampilkan hanya kategori usaha yang benar-benar dimiliki pemain.
 * Kategori yang sekadar dibuka atau dipilih tidak dianggap sebagai pembelian.
 */
