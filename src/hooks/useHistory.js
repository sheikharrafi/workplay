import { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../firebase';
import { ref, onValue, set } from 'firebase/database';

const normalizeHistory = data => {
  if (Array.isArray(data)) return data.filter(Boolean);
  if (data && typeof data === 'object') return Object.values(data).filter(Boolean);
  return [];
};

export function useHistory(currentUser) {
  const [history, setHistory] = useState([]);
  const historyRef = useRef([]);

  useEffect(() => { historyRef.current = history; }, [history]);

  useEffect(() => {
    if (!currentUser) { setHistory([]); return; }
    const dbHistoryRef = ref(db, `users/${currentUser.uid}/history`);
    return onValue(dbHistoryRef, snapshot => setHistory(normalizeHistory(snapshot.val())));
  }, [currentUser]);

  const setHistoryInDb = useCallback(updated => {
    const safeHistory = normalizeHistory(updated);
    setHistory(safeHistory);
    if (currentUser) return set(ref(db, `users/${currentUser.uid}/history`), safeHistory);
    try { localStorage.setItem('teraplay_history', JSON.stringify(safeHistory)); } catch {}
    return Promise.resolve();
  }, [currentUser]);

  const updateHistoryProgress = useCallback((videoId, progress) => {
    const id = String(videoId);
    const safeProgress = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
    const updated = historyRef.current.map(item => String(item.videoId) === id ? { ...item, progress: safeProgress, watchedAt: new Date().toISOString() } : item);
    if (updated.some((item, index) => item !== historyRef.current[index])) return setHistoryInDb(updated);
    return Promise.resolve();
  }, [setHistoryInDb]);

  const handleRemoveHistoryItem = useCallback(id => setHistoryInDb(historyRef.current.filter(h => String(h.id) !== String(id))), [setHistoryInDb]);
  const clearAllHistory = useCallback(() => setHistoryInDb([]), [setHistoryInDb]);

  return { history, historyRef, setHistoryInDb, updateHistoryProgress, handleRemoveHistoryItem, clearAllHistory };
}
