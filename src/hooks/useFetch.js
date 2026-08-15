import React, { useState, useRef, useCallback } from 'react';
import { db } from '../firebase';
import { terabridgeAuth } from '../terabridgeFirebase';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { ref, set } from 'firebase/database';
import { useAuth } from '../contexts/AuthContext';
import { formatDuration } from '../utils/formatDuration';
import { detectResolution } from '../utils/detectResolution';
import { categorizeVideo } from '../utils/categorizeVideo';

async function getTeraBridgeToken(forceRefresh = false) {
  let user = terabridgeAuth.currentUser;
  if (!user) {
    user = await new Promise((resolve, reject) => {
      let unsubscribe;
      const timeout = setTimeout(() => { unsubscribe?.(); reject(new Error('TeraBridge authentication timed out.')); }, 10000);
      unsubscribe = onAuthStateChanged(terabridgeAuth, async currentUser => {
        if (currentUser) { clearTimeout(timeout); unsubscribe(); resolve(currentUser); return; }
        try { const credential = await signInAnonymously(terabridgeAuth); clearTimeout(timeout); unsubscribe(); resolve(credential.user); }
        catch (error) { clearTimeout(timeout); unsubscribe(); reject(error); }
      });
    });
  }
  return user.getIdToken(forceRefresh);
}

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.flv', '.wmv', '.m4v', '.3gp', '.mpg', '.mpeg', '.ts', '.m3u8'];
const FALLBACK_THUMBNAIL = 'https://i.ibb.co/wbdZsJ5/x.jpg';

export function useFetch(currentUser, navigate, { videosRef, historyRef, userProfile, setVideosInDb, setHistoryInDb, shareToDiscover }) {
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [fetchStep, setFetchStep] = useState('');
  const resolveAbortRef = useRef(null);
  const { apiBase } = useAuth();

  const handleFetch = useCallback(async url => {
    const normalizedUrl = String(url || '').trim();
    if (!normalizedUrl) { setFetchError('Please enter a TeraBox share link.'); return; }
    try { new URL(normalizedUrl); } catch { setFetchError('Please enter a valid share URL.'); return; }

    resolveAbortRef.current?.abort();
    const controller = new AbortController();
    resolveAbortRef.current = controller;
    setIsFetching(true); setFetchError(null); setFetchStep('Connecting to TeraBridge...');

    try {
      const doResolve = async forceRefresh => {
        const idToken = await getTeraBridgeToken(forceRefresh);
        const activeApiBase = apiBase || 'https://api.tera-peek.in';
        return fetch(`${activeApiBase}/api/resolve?url=${encodeURIComponent(normalizedUrl)}&mode=stream`, {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${idToken}` }
        });
      };

      let response = await doResolve(false);
      if (response.status === 401) response = await doResolve(true);
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        throw new Error(`Too many requests — rate limit reached.${retryAfter ? ` Try again in ${retryAfter}s.` : ' Please try again shortly.'}`);
      }
      if (!response.ok) throw new Error(`Server responded with status ${response.status}`);

      setFetchStep('Parsing file details...');
      const data = await response.json();
      const files = Array.isArray(data.files) ? data.files : [];
      const videoFiles = files.filter(file => !file?.is_directory && VIDEO_EXTENSIONS.some(ext => String(file?.filename || '').toLowerCase().endsWith(ext)));

      if (!videoFiles.length) {
        const otherFiles = files.filter(file => !file?.is_directory);
        if (otherFiles.length) { navigate(`/files?url=${encodeURIComponent(normalizedUrl)}`, { state: { resolvedData: data } }); return; }
        throw new Error('No files found in this share link.');
      }

      const currentVideos = videosRef.current || [];
      const currentHistory = historyRef.current || [];
      const currentById = new Map(currentVideos.map(video => [String(video.id), video]));
      const now = new Date().toISOString();

      const resolvedVideos = videoFiles.map((file, idx) => {
        const id = file.fs_id || `${Date.now()}_${idx}`;
        const existing = currentById.get(String(id));
        const size = file.size_mb ? `${Number(file.size_mb).toFixed(1)} MB` : file.size_bytes ? `${(Number(file.size_bytes) / (1024 * 1024)).toFixed(1)} MB` : existing?.size || 'Unknown Size';
        const thumbnail = file.thumbnails?.url2 || file.thumbnails?.url1 || file.thumbnails?.icon || existing?.thumbnail || FALLBACK_THUMBNAIL;
        const duration = typeof file.duration === 'number' ? formatDuration(file.duration) : typeof file.duration === 'string' && file.duration.trim() ? file.duration : existing?.duration || '02:00';
        return {
          ...existing,
          id,
          title: file.filename || existing?.title || `TeraBox Video #${String(id).substring(0, 6)}`,
          description: `Imported from TeraBox URL. High-speed HLS stream proxied via TeraBridge. Original Path: ${file.path || existing?.path || '/'}`,
          size,
          duration,
          videoUrl: file.stream_url || existing?.videoUrl || null,
          downloadUrl: file.dlink || existing?.downloadUrl || null,
          thumbnail,
          thumbnailUrl: thumbnail,
          relativeTime: existing?.relativeTime || 'Just now',
          addedDate: existing?.addedDate || now,
          resolution: detectResolution(file.filename, file.streams) || existing?.resolution || 'Auto',
          streamReady: true,
          originalUrl: normalizedUrl,
          fileIndex: idx,
          category: existing?.category || categorizeVideo(file.filename),
          views: Number.isFinite(existing?.views) ? existing.views : 0,
          plays: Number.isFinite(existing?.plays) ? existing.plays : 0,
          favorite: existing?.favorite === true,
          progress: Number.isFinite(existing?.progress) ? existing.progress : 0
        };
      });

      const resolvedById = new Map(resolvedVideos.map(video => [String(video.id), video]));
      const updatedVideos = [...resolvedVideos, ...currentVideos.filter(video => !resolvedById.has(String(video.id)))];
      const historyRecords = resolvedVideos.map(video => ({
        id: `h_${Date.now()}_${video.id}`,
        videoId: video.id,
        title: video.title,
        size: video.size,
        duration: video.duration,
        thumbnail: video.thumbnail,
        thumbnailUrl: video.thumbnailUrl,
        videoUrl: video.videoUrl,
        downloadUrl: video.downloadUrl,
        originalUrl: video.originalUrl,
        resolution: video.resolution,
        progress: video.progress || 0,
        watchedAt: now
      }));
      const historyWithoutResolved = currentHistory.filter(h => !resolvedVideos.some(video => String(video.id) === String(h.videoId)));
      const updatedHistory = [...historyRecords, ...historyWithoutResolved].slice(0, 50);

      await Promise.all([setVideosInDb(updatedVideos), setHistoryInDb(updatedHistory)]);

      if (currentUser && shareToDiscover) {
        const uploader = { uid: currentUser.uid, username: userProfile?.username || currentUser.displayName || `User_${currentUser.uid.substring(0, 5)}`, avatar: userProfile?.avatar || currentUser.photoURL || FALLBACK_THUMBNAIL };
        await Promise.all(resolvedVideos.map(video => {
          const publicVideo = { ...video, uploader };
          delete publicVideo.progress; delete publicVideo.favorite;
          return set(ref(db, `discoverVideos/${video.id}`), publicVideo).catch(() => {});
        }));
      }

      navigate(`/player/${resolvedVideos[0].id}`, { state: { resolvedVideo: resolvedVideos[0] } });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('API Resolve Error:', err);
      setFetchError(err?.message || 'An unexpected error occurred while resolving your link. Please try again.');
    } finally {
      if (resolveAbortRef.current === controller) resolveAbortRef.current = null;
      setIsFetching(false);
    }
  }, [currentUser, navigate, shareToDiscover, apiBase, setHistoryInDb, setVideosInDb, userProfile, videosRef, historyRef]);

  return { isFetching, fetchError, fetchStep, handleFetch, setFetchError };
}
