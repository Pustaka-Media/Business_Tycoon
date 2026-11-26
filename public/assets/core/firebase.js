/* ==========================================================================
   BUSINESS TYCOON TAP - INTEGRASI FIREBASE AUTH & FIRESTORE
   Mengelola autentikasi Google (Popup), validasi koneksi Firestore,
   error handler terstruktur, serta sinkronisasi profil & cloud save.
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

  return {
    userId: uid,
    version: CONFIG.SAVE_SCHEMA_VERSION,
    balance: Number.isFinite(balance) && balance >= 0 ? Math.round(balance * 100) / 100 : 0,
    perClick: Number.isFinite(perClick) && perClick >= 0 ? Math.round(perClick * 100) / 100 : CONFIG.BASE_PER_CLICK,
    perSecond: Number.isFinite(perSecond) && perSecond >= 0 ? Math.round(perSecond * 100) / 100 : 0,
    totalTaps: Number.isFinite(totalTaps) && totalTaps >= 0 ? Math.floor(totalTaps) : 0,
    totalEarned: Number.isFinite(totalEarned) && totalEarned >= 0 ? Math.round(totalEarned * 100) / 100 : 0,
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

/**
 * Menginisialisasi Firebase App, Auth, dan Firestore (hanya di peramban).
 */
export async function initFirebase(onCloudDataLoaded) {
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
        notifyAuthListeners();
        if (user && user.emailVerified) {
          try {
            await ensureUserPrivateProfile(user);
            const cloudSave = await loadPlayerSaveFromCloud();
            if (typeof onCloudDataLoaded === 'function') {
              onCloudDataLoaded(cloudSave, user);
            }
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
  if (!firebaseSdk || !authInstance) return;
  const { signOut } = firebaseSdk.auth;
  await signOut(authInstance);
}

/**
 * Membaca data cadangan pemain dari koleksi /playerSaves/{userId}.
 */
export async function loadPlayerSaveFromCloud() {
  if (!firebaseSdk || !dbInstance || !currentAuthUser || !currentAuthUser.emailVerified) {
    return null;
  }
  const uid = currentAuthUser.uid;
  if (!isValidFirebaseUserId(uid)) return null;

  const { doc, getDoc } = firebaseSdk.firestore;
  const path = 'playerSaves/' + uid;
  const saveRef = doc(dbInstance, 'playerSaves', uid);
  try {
    const snap = await getDoc(saveRef);
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
    return null;
  }
}

/**
 * Menulis data cadangan pemain ke /playerSaves/{userId}.
 */
export async function syncPlayerSaveToCloud(snapshot) {
  if (!firebaseSdk || !dbInstance || !currentAuthUser || !currentAuthUser.emailVerified) {
    return false;
  }
  const uid = currentAuthUser.uid;
  const { doc, setDoc, serverTimestamp } = firebaseSdk.firestore;
  const payload = buildPlayerSavePayload(uid, snapshot, serverTimestamp());
  if (!payload) return false;

  const path = 'playerSaves/' + uid;
  const saveRef = doc(dbInstance, 'playerSaves', uid);
  try {
    await setDoc(saveRef, payload);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
    return false;
  }
}

/**
 * Menjadwalkan sinkronisasi cloud save dengan throttle hemat kuota baca/tulis.
 */
export function scheduleCloudSaveSync(getSnapshot) {
  if (!hasDOM || !currentAuthUser || !currentAuthUser.emailVerified) return;
  if (cloudSyncTimer) return;
  cloudSyncTimer = root.setTimeout(function () {
    cloudSyncTimer = null;
    if (typeof getSnapshot === 'function') {
      syncPlayerSaveToCloud(getSnapshot()).catch(function () {
        // Kegagalan sinkronisasi tidak boleh mengganggu permainan offline-first
      });
    }
  }, CONFIG.CLOUD_SYNC_THROTTLE_MS);
}
