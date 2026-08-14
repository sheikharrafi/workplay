import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyBo6KSvm_YjKLJxGfJoako9ODOJzignH9c',
  authDomain: 'teraplay-project.firebaseapp.com',
  projectId: 'teraplay-project',
  storageBucket: 'teraplay-project.firebasestorage.app',
  messagingSenderId: '22091622747',
  appId: '1:22091622747:web:46162860008e45682dd27e',
  measurementId: 'G-7N992LNXYD',
  databaseURL: 'https://teraplay-project-default-rtdb.asia-southeast1.firebasedatabase.app'
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);

export default app;
