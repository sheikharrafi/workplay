import { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../firebase';
import { ref, onValue, set, get, update, increment } from 'firebase/database';

const normalizeVideos = (data) => {
  if (Array.isArray(data)) return data.filter(Boolean);
  if (data && typeof data === 'object') return Object.values(data).filter(Boolean);
  return [];
};

export function useVideos(currentUser) {
  const [videos, setVideos] = useState([]);
  const videosRef = useRef([]);
  const deletingVideoIdRef = useRef(null);

  useEffect(() => { videosRef.current = videos; }, [videos]);

  useEffect(() => {
    if (!currentUser) { setVideos([]); return; }
    const dbVideosRef = ref(db, `users/${currentUser.uid}/videos`);
    const unsubscribe = onValue(dbVideosRef, snapshot => setVideos(normalizeVideos(snapshot.val())));
    return () => unsubscribe();
  }, [currentUser]);

  const setVideosInDb = useCallback((updated) => {
    const safeVideos = normalizeVideos(updated);
    setVideos(safeVideos);
    if (currentUser) return set(ref(db, `users/${currentUser.uid}/videos`), safeVideos);
    try { localStorage.setItem('teraplay_videos', JSON.stringify(safeVideos)); } catch {}
    return Promise.resolve();
  }, [currentUser]);

  const handleImportVideo = useCallback((video) => {
    const currentVideos = videosRef.current;
    if (currentVideos.some(v => String(v.id) === String(video.id))) return;
    setVideosInDb([{ ...video, favorite: video.favorite || false, progress: 0, addedDate: new Date().toISOString(), relativeTime: 'Just now' }, ...currentVideos]);
  }, [setVideosInDb]);

  const handleToggleFavorite = (videoId, discoverVideosRef) => {
    const currentVideos = videosRef.current;
    const id = String(videoId);
    if (!currentVideos.some(v => String(v.id) === id)) {
      const discVid = (discoverVideosRef?.current || []).find(v => String(v.id) === id);
      if (discVid) { handleImportVideo({ ...discVid, favorite: true }); return; }
    }
    setVideosInDb(currentVideos.map(v => String(v.id) === id ? { ...v, favorite: !v.favorite } : v));
  };

  const handleUpdateVideo = (updatedVideo) => {
    if (deletingVideoIdRef.current && String(updatedVideo.id) === String(deletingVideoIdRef.current)) return;
    const safe = { ...updatedVideo, progress: Number.isFinite(updatedVideo.progress) ? updatedVideo.progress : 0 };
    setVideosInDb(videosRef.current.map(v => String(v.id) === String(safe.id) ? { ...v, ...safe } : v));

    if (currentUser) {
      const publicVideoRef = ref(db, `discoverVideos/${updatedVideo.id}`);
      get(publicVideoRef).then(snap => {
        if (!snap.exists()) return;
        const dbVid = snap.val() || {};
        const updateData = {};
        if (typeof updatedVideo.views === 'number' && updatedVideo.views > (dbVid.views || 0)) updateData.views = updatedVideo.views;
        if (typeof updatedVideo.plays === 'number' && updatedVideo.plays > (dbVid.plays || 0)) updateData.plays = updatedVideo.plays;
        if (updatedVideo.duration && updatedVideo.duration !== '02:00' && updatedVideo.duration !== dbVid.duration) updateData.duration = updatedVideo.duration;
        if (updatedVideo.category && updatedVideo.category !== dbVid.category) updateData.category = updatedVideo.category;
        if (Object.keys(updateData).length) update(publicVideoRef, updateData).catch(() => {});
      }).catch(() => {});
    }
  };

  const handleIncrementVideoViewsAndPlays = (videoId) => {
    if (!currentUser) return;
    update(ref(db, `discoverVideos/${videoId}`), { views: increment(1), plays: increment(1) }).catch(() => {});
  };

  return { videos, videosRef, deletingVideoIdRef, setVideosInDb, handleImportVideo, handleToggleFavorite, handleUpdateVideo, handleIncrementVideoViewsAndPlays };
}
