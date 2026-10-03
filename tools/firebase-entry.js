// Only the pieces the app uses, bundled into vendor/firebase.js so the app starts offline without CDNs.
export { initializeApp } from 'firebase/app';
export {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged,
  signInWithEmailAndPassword, sendPasswordResetEmail, signOut
} from 'firebase/auth';
export {
  initializeFirestore, memoryLocalCache, collection, doc, setDoc, getDocs, onSnapshot, query, where, writeBatch
} from 'firebase/firestore';
