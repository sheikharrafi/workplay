import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyAypjMBuYZFfOCnSAsQQc0PHfDKTIvNLJU',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'tbplay-73b2a.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'tbplay-73b2a',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'tbplay-73b2a.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '617974461346',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:617974461346:web:24f0826ee77b51fccab8fb',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-P7JQCQ73DL',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || 'https://tbplay-73b2a-default-rtdb.asia-southeast1.firebasedatabase.app'
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);

export default app;
