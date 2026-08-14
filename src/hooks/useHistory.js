import { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../firebase';
import { ref, onValue, set } from 'firebase/database';

export function useHistory(currentUser) {
  const [history, setHistory] = useState([]);
  const historyRef = useRef([]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    if (!currentUser) {
      setHistory([]);
      return;
    }

    const dbHistoryRef = ref(db, `users/${currentUser.uid}/history`);
    const unsubscribe = onValue(dbHistoryRef, (snapshot) => {
      const data = snapshot.val();
      if (Array.isArray(data)) {
        setHistory(data);
      } else if (data && typeof data === 'object') {
        setHistory(Object.values(data));
      } else {
        setHistory([]);
      }
    });

    return () => unsubscribe();
  }, [currentUser]);

  const setHistoryInDb = useCallback((updated) => {
    const safeHistory = Array.isArray(updated) ? updated : [];
    setHistory(safeHistory);

    if (currentUser) {
      return set(ref(db, `users/${currentUser.uid}/history`), safeHistory);
    }

    try {
      localStorage.setItem('teraplay_history', JSON.stringify(safeHistory));
    } catch {}
    return Promise.resolve();
  }, [currentUser]);

  const handleRemoveHistoryItem = useCallback((id) => {
    const updated = historyRef.current.filter(h => String(h.id) !== String(id));
    return setHistoryInDb(updated);
  }, [setHistoryInDb]);

  const clearAllHistory = useCallback(() => {
    return setHistoryInDb([]);
  }, [setHistoryInDb]);

  return { history, historyRef, setHistoryInDb, handleRemoveHistoryItem, clearAllHistory };
}
