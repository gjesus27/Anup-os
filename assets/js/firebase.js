import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyB1mJL2R5DiRXNrKaLCtvMxu6Oo-5zqM1o",
  authDomain: "anup-os.firebaseapp.com",
  projectId: "anup-os",
  storageBucket: "anup-os.firebasestorage.app",
  messagingSenderId: "482570259530",
  appId: "1:482570259530:web:9ea98617413ab381142ab3",
};

export const app = initializeApp(firebaseConfig);
export const secondaryApp = initializeApp(firebaseConfig, "secondary");
export const auth = getAuth(app);
export const secondaryAuth = getAuth(secondaryApp);
export const db = getFirestore(app);

export {
  addDoc,
  collection,
  createUserWithEmailAndPassword,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  onAuthStateChanged,
  orderBy,
  query,
  sendPasswordResetEmail,
  serverTimestamp,
  setDoc,
  signInWithEmailAndPassword,
  signOut,
  updateDoc,
  where,
};
