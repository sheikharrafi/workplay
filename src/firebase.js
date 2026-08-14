import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyAypjMBuYZFfOCnSAsQQc0PHfDKTIvNLJU',
  authDomain: 'tbplay-73b2a.firebaseapp.com',
  projectId: 'tbplay-73b2a',
  storageBucket: 'tbplay-73b2a.firebasestorage.app',
  messagingSenderId: '617974461346',
  appId: '1:617974461346:web:24f0826ee77b51fccab8fb',
  measurementId: 'G-P7JQCQ73DL',
  databaseURL: 'https://tbplay-73b2a-default-rtdb.asia-southeast1.firebasedatabase.app'
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);

export default app;
