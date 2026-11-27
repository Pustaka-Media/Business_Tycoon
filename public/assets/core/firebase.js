/* ==========================================================================
   BUSINESS TYCOON TAP - INTEGRASI FIREBASE AUTH & FIRESTORE
   Mengelola autentikasi Google (Popup), validasi koneksi Firestore,
   error handler terstruktur, serta sinkronisasi profil, progres, & portofolio.
   ========================================================================== */

import { CONFIG } from './config.js';
import { hasDOM, root } from '../utils/dom.js';

export const OperationType = Object.freeze({
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write'
});

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

let firebaseSdk = null;
let firebaseApp = null;
let authInstance = null;
let dbInstance = null;
let googleProvider = null;
let initPromise = null;
let currentAuthUser = null;
let cloudSyncTimer = null;
let cloudPortfolioSyncTimer = null;
let unsubSaveSnapshot = null;
let unsubHoldingsSnapshot = null;
let lastSyncedClientAt = 0;
let lastAppliedCloudClientAt = 0;
let knownCloudHoldingIds = null;
let latestRealtimeSaveData = null;
let latestRealtimeHoldingsMap = null;

const authListeners = new Set();

/**
 * Memastikan string UID memenuhi pola keamanan blueprint & rules.
 */
export function isValidFirebaseUserId(uid) {
  return (
    typeof uid === 'string' &&
    uid.length > 0 &&
    uid.length <= CONFIG.USER_ID_MAX_LEN &&
    VALID_ID_REGEX.test(uid)
  );
}

/**
 * Memastikan string ID aset memenuhi pola keamanan blueprint & rules.
 */
export function isValidAssetId(assetId) {
  return (
    typeof assetId === 'string' &&
    assetId.length > 0 &&
    assetId.length <= CONFIG.ASSET_ID_MAX_LEN &&
    VALID_ID_REGEX.test(assetId)
  );
}

/**
 * Menyusun payload profil privat sesuai firebase-blueprint.json & firestore.rules.
 */
export function buildUserPrivatePayload(user, timestampValue) {
  const uid = user && typeof user.uid === 'string' ? user.uid.trim() : '';
  const rawEmail = user && typeof user.email === 'string' ? user.email.trim() : '';
  const email = rawEmail.slice(0, CONFIG.EMAIL_MAX_LEN);
  const rawName = user && typeof user.displayName === 'string' ? user.displayName.trim() : '';
  const displayName = rawName.slice(0, CONFIG.DISPLAY_NAME_MAX_LEN);

  if (!isValidFirebaseUserId(uid) || email.length < CONFIG.MIN_EMAIL_LEN) {
    return null;
  }

  const payload = {
    uid: uid,
    email: email,
    updatedAt: timestampValue
  };
  if (displayName) {
    payload.displayName = displayName;
  }
  return payload;
}

/**
 * Menyusun payload cloud save sesuai entitas PlayerSave (Save Schema v2).
 */
export function buildPlayerSavePayload(uid, snapshot, timestampValue) {
  if (!isValidFirebaseUserId(uid) || !snapshot || typeof snapshot !== 'object') {
    return null;
  }

  const balance = Number(snapshot.balance);
  const perClick = Number(snapshot.perClick);
  const perSecond = Number(snapshot.perSecond);
  const totalTaps = Number(snapshot.totalTaps);
  const totalEarned = Number(snapshot.totalEarned);
  const startDate = Number(snapshot.startDate);
  const clientSavedAt = Number(snapshot.clientSavedAt);

  const rawUpgrades = snapshot.upgrades && typeof snapshot.upgrades === 'object' ? snapshot.upgrades : {};
  const upgrades = {};
  CONFIG.UPGRADE_TIERS.forEach(function (tier) {
    const lvl = Number(rawUpgrades[tier.id]);
    upgrades[tier.id] = Number.isFinite(lvl) && lvl >= 0 ? Math.floor(lvl) : 0;
  });

  const milestones = [];
  if (Array.isArray(snapshot.milestones)) {
    snapshot.milestones.forEach(function (item) {
      if (
        typeof item === 'string' &&
        item.length > 0 &&
        item.length <= CONFIG.MILESTONE_ID_MAX_LEN &&
        milestones.length < CONFIG.MILESTONES_MAX_COUNT &&
        milestones.indexOf(item) < 0
      ) {
        milestones.push(item);
      }
    });
  }

  const rawSettings = snapshot.settings && typeof snapshot.settings === 'object' ? snapshot.settings : {};
  const settings = {
    sound: rawSettings.sound !== false,
    haptic: rawSettings.haptic !== false
  };

  return {
    userId: uid,
    version: CONFIG.SAVE_SCHEMA_VERSION,
    balance: Number.isFinite(balance) && balance >= 0 ? Math.round(balance * 100) / 100 : 0,
    perClick: Number.isFinite(perClick) && perClick >= 0 ? Math.round(perClick * 100) / 100 : CONFIG.BASE_PER_CLICK,
    perSecond: Number.isFinite(perSecond) && perSecond >= 0 ? Math.round(perSecond * 100) / 100 : 0,
    totalTaps: Number.isFinite(totalTaps) && totalTaps >= 0 ? Math.floor(totalTaps) : 0,
    totalEarned: Number.isFinite(totalEarned) && totalEarned >= 0 ? Math.round(totalEarned * 100) / 100 : 0,
    upgrades: upgrades,
    milestones: milestones,
    settings: settings,
    startDate: Number.isFinite(startDate) && startDate >= 0 ? Math.floor(startDate) : 0,
    clientSavedAt: Number.isFinite(clientSavedAt) && clientSavedAt >= 0 ? Math.floor(clientSavedAt) : 0,
    updatedAt: timestampValue
  };
}

/**
 * Menyusun payload satu posisi portofolio sesuai entitas PortfolioHolding.
 */
export function buildPortfolioHoldingPayload(uid, assetId, holding, timestampValue) {
  if (
    !isValidFirebaseUserId(uid) ||
    !isValidAssetId(assetId) ||
    !holding ||
    typeof holding !== 'object'
  ) {
    return null;
  }

  const units = Number(holding.units);
  const avgEntry = Number(holding.avgEntry);
  if (!Number.isFinite(units) || Math.floor(units) < 1 || !Number.isFinite(avgEntry) || avgEntry < 0) {
    return null;
  }

  return {
    userId: uid,
    assetId: assetId,
    units: Math.floor(units),
    avgEntry: Math.round(avgEntry * 100) / 100,
    updatedAt: timestampValue
  };
}

/**
 * Penangan error terstruktur Firestore (FirestoreErrorInfo).
 */
export function handleFirestoreError(error, operationType, path) {
  const user = authInstance ? authInstance.currentUser : currentAuthUser;
  const providerData =
    user && Array.isArray(user.providerData)
      ? user.providerData.map(function (provider) {
          return {
            providerId: provider && provider.providerId ? provider.providerId : null,
            email: provider && provider.email ? provider.email : null
          };
        })
      : [];

  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: user ? user.uid : null,
      email: user ? user.email : null,
      emailVerified: user ? user.emailVerified : null,
      isAnonymous: user ? user.isAnonymous : null,
      tenantId: user ? user.tenantId : null,
      providerInfo: providerData
    },
    operationType: operationType,
    path: path
  };

  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function notifyAuthListeners() {
  authListeners.forEach(function (listener) {
    try {
      listener(currentAuthUser);
    } catch (error) {
      // Abaikan error listener UI agar tidak memutus alur autentikasi
    }
  });
}

export function getCurrentAuthUser() {
  return currentAuthUser;
}

export function subscribeAuthState(listener) {
  if (typeof listener !== 'function') return function () {};
  authListeners.add(listener);
  listener(currentAuthUser);
  return function () {
    authListeners.delete(listener);
  };
}

function detachRealtimeListeners() {
  if (typeof unsubSaveSnapshot === 'function') {
    unsubSaveSnapshot();
    unsubSaveSnapshot = null;
  }
  if (typeof unsubHoldingsSnapshot === 'function') {
    unsubHoldingsSnapshot();
    unsubHoldingsSnapshot = null;
  }
  latestRealtimeSaveData = null;
  latestRealtimeHoldingsMap = null;
}

async function testConnection() {
  if (!firebaseSdk || !dbInstance) return;
  const { doc, getDocFromServer } = firebaseSdk.firestore;
  try {
    await getDocFromServer(doc(dbInstance, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Silakan periksa konfigurasi Firebase Anda.');
    }
  }
}

async function ensureUserPrivateProfile(user) {
  if (!firebaseSdk || !dbInstance || !user || !user.emailVerified) return;
  if (!isValidFirebaseUserId(user.uid)) return;

  const { doc, getDoc, setDoc, updateDoc, serverTimestamp } = firebaseSdk.firestore;
  const path = 'users/' + user.uid + '/private/profile';
  const profileRef = doc(dbInstance, 'users', user.uid, 'private', 'profile');

  try {
    const existingSnap = await getDoc(profileRef);
    const payload = buildUserPrivatePayload(user, serverTimestamp());
    if (!payload) return;

    if (!existingSnap.exists()) {
      payload.createdAt = serverTimestamp();
      await setDoc(profileRef, payload);
    } else {
      const updatePayload = {
        email: payload.email,
        updatedAt: serverTimestamp()
      };
      if (payload.displayName) {
        updatePayload.displayName = payload.displayName;
      }
      await updateDoc(profileRef, updatePayload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

function extractHoldingsMapFromSnapshot(holdingsSnap) {
  const holdings = {};
  if (!holdingsSnap || !Array.isArray(holdingsSnap.docs)) return holdings;
  holdingsSnap.docs.forEach(function (docSnap) {
    const data = docSnap.data();
    const assetId = data && typeof data.assetId === 'string' ? data.assetId : docSnap.id;
    const units = Number(data && data.units);
    const avgEntry = Number(data && data.avgEntry);
    if (
      isValidAssetId(assetId) &&
      Number.isFinite(units) &&
      Math.floor(units) >= 1 &&
      Number.isFinite(avgEntry) &&
      avgEntry >= 0
    ) {
      holdings[assetId] = {
        units: Math.floor(units),
        avgEntry: Math.round(avgEntry * 100) / 100
      };
    }
  });
  return holdings;
}

function attachRealtimeListeners(user, onRealtimeUpdate) {
  detachRealtimeListeners();
  if (!firebaseSdk || !dbInstance || !user || !user.emailVerified || typeof onRealtimeUpdate !== 'function') {
    return;
  }
  const uid = user.uid;
  if (!isValidFirebaseUserId(uid)) return;

  const { doc, collection, query, where, onSnapshot } = firebaseSdk.firestore;
  const savePath = 'playerSaves/' + uid;
  const holdingsPath = 'playerSaves/' + uid + '/holdings';
  const saveRef = doc(dbInstance, 'playerSaves', uid);
  const holdingsQuery = query(
    collection(dbInstance, 'playerSaves', uid, 'holdings'),
    where('userId', '==', uid)
  );

  function maybeEmitUpdate() {
    if (!latestRealtimeSaveData || !latestRealtimeHoldingsMap) return;
    const cloudClientAt = Number(latestRealtimeSaveData.clientSavedAt) || 0;
    if (cloudClientAt > 0 && (cloudClientAt <= lastSyncedClientAt || cloudClientAt <= lastAppliedCloudClientAt)) {
      return;
    }
    if (cloudClientAt > 0) {
      lastAppliedCloudClientAt = cloudClientAt;
    }
    onRealtimeUpdate(
      Object.assign({}, latestRealtimeSaveData, {
        holdings: Object.assign({}, latestRealtimeHoldingsMap)
      })
    );
  }

  unsubSaveSnapshot = onSnapshot(
    saveRef,
    function (docSnap) {
      if (!docSnap.exists() || (docSnap.metadata && docSnap.metadata.hasPendingWrites)) {
        return;
      }
      latestRealtimeSaveData = docSnap.data();
      maybeEmitUpdate();
    },
    function (error) {
      handleFirestoreError(error, OperationType.GET, savePath);
    }
  );

  unsubHoldingsSnapshot = onSnapshot(
    holdingsQuery,
    function (querySnap) {
      if (querySnap.metadata && querySnap.metadata.hasPendingWrites) {
        return;
      }
      latestRealtimeHoldingsMap = extractHoldingsMapFromSnapshot(querySnap);
      knownCloudHoldingIds = new Set(Object.keys(latestRealtimeHoldingsMap));
      maybeEmitUpdate();
    },
    function (error) {
      handleFirestoreError(error, OperationType.LIST, holdingsPath);
    }
  );
}

/**
 * Menginisialisasi Firebase App, Auth, dan Firestore (hanya di peramban).
 */
export async function initFirebase(onCloudDataLoaded, onRealtimeUpdate) {
  if (!hasDOM || typeof root.fetch !== 'function') return null;
  if (initPromise) return initPromise;

  initPromise = (async function () {
    try {
      const configResp = await root.fetch(CONFIG.FIREBASE_CONFIG_PATH, { cache: 'no-cache' });
      if (!configResp.ok) return null;
      const firebaseConfig = await configResp.json();
      if (!firebaseConfig || !firebaseConfig.projectId || !firebaseConfig.apiKey) {
        return null;
      }

      const [appMod, authMod, firestoreMod] = await Promise.all([
        import(CONFIG.FIREBASE_APP_URL),
        import(CONFIG.FIREBASE_AUTH_URL),
        import(CONFIG.FIREBASE_FIRESTORE_URL)
      ]);

      firebaseSdk = {
        app: appMod,
        auth: authMod,
        firestore: firestoreMod
      };

      const existingApps = appMod.getApps();
      firebaseApp = existingApps.length > 0 ? existingApps[0] : appMod.initializeApp(firebaseConfig);
      authInstance = authMod.getAuth(firebaseApp);
      dbInstance = firestoreMod.getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
      googleProvider = new authMod.GoogleAuthProvider();

      await testConnection();

      authMod.onAuthStateChanged(authInstance, async function (user) {
        currentAuthUser = user || null;
        knownCloudHoldingIds = null;
        lastSyncedClientAt = 0;
        lastAppliedCloudClientAt = 0;
        detachRealtimeListeners();
        notifyAuthListeners();

        if (user && user.emailVerified) {
          try {
            await ensureUserPrivateProfile(user);
            const cloudSave = await loadPlayerSaveFromCloud();
            if (cloudSave && Number(cloudSave.clientSavedAt) > 0) {
              lastAppliedCloudClientAt = Number(cloudSave.clientSavedAt);
            }
            if (typeof onCloudDataLoaded === 'function') {
              onCloudDataLoaded(cloudSave, user);
            }
            attachRealtimeListeners(user, onRealtimeUpdate);
          } catch (error) {
            // Biarkan permainan lokal tetap berjalan jika sinkronisasi awan gagal sementara
          }
        }
      });

      return { app: firebaseApp, auth: authInstance, db: dbInstance };
    } catch (error) {
      return null;
    }
  })();

  return initPromise;
}

/**
 * Masuk dengan akun Google via popup sesuai ketentuan environment preview.
 */
export async function signInWithGoogle() {
  const ready = await initFirebase();
  if (!ready || !firebaseSdk || !authInstance || !googleProvider) {
    throw new Error('Layanan akun sedang tidak tersedia saat luring.');
  }
  const { signInWithPopup } = firebaseSdk.auth;
  const credential = await signInWithPopup(authInstance, googleProvider);
  return credential ? credential.user : null;
}

/**
 * Keluar dari akun Google saat ini.
 */
export async function signOutGoogle() {
  detachRealtimeListeners();
  knownCloudHoldingIds = null;
  if (!firebaseSdk || !authInstance) return;
  const { signOut } = firebaseSdk.auth;
  await signOut(authInstance);
}

/**
 * Membaca data cadangan pemain & subkoleksi portofolio dari /playerSaves/{userId}.
 */
export async function loadPlayerSaveFromCloud() {
  if (!firebaseSdk || !dbInstance || !currentAuthUser || !currentAuthUser.emailVerified) {
    return null;
  }
  const uid = currentAuthUser.uid;
  if (!isValidFirebaseUserId(uid)) return null;

  const { doc, collection, query, where, getDoc, getDocs } = firebaseSdk.firestore;
  const savePath = 'playerSaves/' + uid;
  const holdingsPath = 'playerSaves/' + uid + '/holdings';
  const saveRef = doc(dbInstance, 'playerSaves', uid);
  const holdingsQuery = query(
    collection(dbInstance, 'playerSaves', uid, 'holdings'),
    where('userId', '==', uid)
  );

  let saveData = null;
  try {
    const snap = await getDoc(saveRef);
    if (!snap.exists()) {
      knownCloudHoldingIds = new Set();
      return null;
    }
    saveData = snap.data();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, savePath);
    return null;
  }

  let holdingsMap = {};
  try {
    const holdingsSnap = await getDocs(holdingsQuery);
    holdingsMap = extractHoldingsMapFromSnapshot(holdingsSnap);
    knownCloudHoldingIds = new Set(Object.keys(holdingsMap));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, holdingsPath);
    return null;
  }

  return Object.assign({}, saveData, { holdings: holdingsMap });
}

async function fetchExistingCloudHoldingIds(uid) {
  if (knownCloudHoldingIds instanceof Set) {
    return knownCloudHoldingIds;
  }
  const { collection, query, where, getDocs } = firebaseSdk.firestore;
  const holdingsPath = 'playerSaves/' + uid + '/holdings';
  const holdingsQuery = query(
    collection(dbInstance, 'playerSaves', uid, 'holdings'),
    where('userId', '==', uid)
  );
  try {
    const snap = await getDocs(holdingsQuery);
    const ids = new Set();
    snap.docs.forEach(function (docSnap) {
      ids.add(docSnap.id);
    });
    knownCloudHoldingIds = ids;
    return ids;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, holdingsPath);
    return new Set();
  }
}

/**
 * Menulis data cadangan pemain dan seluruh posisi portofolio secara atomik ke Firestore.
 */
export async function syncPlayerSaveToCloud(snapshot) {
  if (!firebaseSdk || !dbInstance || !currentAuthUser || !currentAuthUser.emailVerified) {
    return false;
  }
  const uid = currentAuthUser.uid;
  const { doc, writeBatch, serverTimestamp } = firebaseSdk.firestore;
  const payload = buildPlayerSavePayload(uid, snapshot, serverTimestamp());
  if (!payload) return false;

  const existingIds = await fetchExistingCloudHoldingIds(uid);
  const desiredHoldings =
    snapshot && snapshot.holdings && typeof snapshot.holdings === 'object' ? snapshot.holdings : {};

  const ops = [];
  Object.keys(desiredHoldings).forEach(function (assetId) {
    const holdingPayload = buildPortfolioHoldingPayload(
      uid,
      assetId,
      desiredHoldings[assetId],
      serverTimestamp()
    );
    if (holdingPayload) {
      ops.push({ type: 'set', assetId: assetId, data: holdingPayload });
    }
  });

  existingIds.forEach(function (existingId) {
    if (!Object.prototype.hasOwnProperty.call(desiredHoldings, existingId)) {
      ops.push({ type: 'delete', assetId: existingId });
    }
  });

  const savePath = 'playerSaves/' + uid;
  const saveRef = doc(dbInstance, 'playerSaves', uid);
  lastSyncedClientAt = payload.clientSavedAt;

  try {
    let firstBatch = writeBatch(dbInstance);
    firstBatch.set(saveRef, payload);
    let opCount = 1;

    for (let i = 0; i < ops.length; i += 1) {
      if (opCount >= CONFIG.FIRESTORE_BATCH_LIMIT) {
        await firstBatch.commit();
        firstBatch = writeBatch(dbInstance);
        opCount = 0;
      }
      const op = ops[i];
      const hRef = doc(dbInstance, 'playerSaves', uid, 'holdings', op.assetId);
      if (op.type === 'set') {
        firstBatch.set(hRef, op.data);
      } else {
        firstBatch.delete(hRef);
      }
      opCount += 1;
    }

    if (opCount > 0) {
      await firstBatch.commit();
    }

    const nextIds = new Set();
    ops.forEach(function (op) {
      if (op.type === 'set') nextIds.add(op.assetId);
    });
    knownCloudHoldingIds = nextIds;
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, savePath);
    return false;
  }
}

/**
 * Menghapus portofolio awan dan mengatur ulang progres pemain saat Reset Semua Data.
 */
export async function resetCloudPlayerSave(snapshot) {
  if (cloudSyncTimer) {
    root.clearTimeout(cloudSyncTimer);
    cloudSyncTimer = null;
  }
  if (cloudPortfolioSyncTimer) {
    root.clearTimeout(cloudPortfolioSyncTimer);
    cloudPortfolioSyncTimer = null;
  }
  const cleanSnapshot = Object.assign({}, snapshot || {}, { holdings: {} });
  return syncPlayerSaveToCloud(cleanSnapshot);
}

/**
 * Menjadwalkan sinkronisasi cloud save (cepat untuk transaksi portofolio, throttle 10s untuk ketukan).
 */
export function scheduleCloudSaveSync(getSnapshot, immediate) {
  if (!hasDOM || !currentAuthUser || !currentAuthUser.emailVerified) return;

  if (immediate) {
    if (cloudSyncTimer) {
      root.clearTimeout(cloudSyncTimer);
      cloudSyncTimer = null;
    }
    if (cloudPortfolioSyncTimer) {
      root.clearTimeout(cloudPortfolioSyncTimer);
    }
    cloudPortfolioSyncTimer = root.setTimeout(function () {
      cloudPortfolioSyncTimer = null;
      if (typeof getSnapshot === 'function') {
        syncPlayerSaveToCloud(getSnapshot()).catch(function () {
          // Kegagalan sinkronisasi tidak boleh mengganggu permainan luring
        });
      }
    }, CONFIG.PORTFOLIO_SYNC_DEBOUNCE_MS);
    return;
  }

  if (cloudSyncTimer || cloudPortfolioSyncTimer) return;
  cloudSyncTimer = root.setTimeout(function () {
    cloudSyncTimer = null;
    if (typeof getSnapshot === 'function') {
      syncPlayerSaveToCloud(getSnapshot()).catch(function () {
        // Kegagalan sinkronisasi tidak boleh mengganggu permainan luring
      });
    }
  }, CONFIG.CLOUD_SYNC_THROTTLE_MS);
}
