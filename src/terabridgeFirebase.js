import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const TERABRIDGE_FIREBASE_APP_NAME = 'terabridge-auth';

const terabridgeFirebaseConfig = {
  apiKey: 'AIzaSyBo6KSvm_YjKLJxGfJoako9ODOJzignH9c',
  authDomain: 'teraplay-project.firebaseapp.com',
  projectId: 'teraplay-project',
  storageBucket: 'teraplay-project.firebasestorage.app',
  messagingSenderId: '22091622747',
  appId: '1:22091622747:web:4616286008e45682dd27e',
  measurementId: 'G-7N992LNXYD',
  databaseURL: 'https://teraplay-project-default-rtdb.asia-southeast1.firebasedatabase.app'
};

const terabridgeApp = getApps().find(app => app.name === TERABRIDGE_FIREBASE_APP_NAME)
  || initializeApp(terabridgeFirebaseConfig, TERABRIDGE_FIREBASE_APP_NAME);

export const terabridgeAuth = getAuth(terabridgeApp);
export { terabridgeApp };
