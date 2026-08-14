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
      const timeout = setTimeout(() => {
        unsubscribe?.();
        reject(new Error('TeraBridge authentication timed out.'));
      }, 10000);
      unsubscribe = onAuthStateChanged(terabridgeAuth, async (currentUser) => {
        if (currentUser) {
          clearTimeout(timeout);
          unsubscribe();
          resolve(currentUser);
          return;
        }
        try {
          const credential = await signInAnonymously(terabridgeAuth);
          clearTimeout(timeout);
          unsubscribe();
          resolve(credential.user);
        } catch (error) {
          clearTimeout(timeout);
          unsubscribe();
          reject(error);
        }
      });
    });
  }
  return user.getIdToken(forceRefresh);
}

export function useFetch(currentUser, navigate, { videosRef, historyRef, userProfile, setVideosInDb, setHistoryInDb, shareToDiscover }) {
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [fetchStep, setFetchStep] = useState('');
  const resolveAbortRef = useRef(null);
  const { apiBase } = useAuth();

  const handleFetch = useCallback(async (url) => {
    if (resolveAbortRef.current) resolveAbortRef.current.abort();
    const controller = new AbortController();
    resolveAbortRef.current = controller;
    setIsFetching(true);
    setFetchError(null);
    setFetchStep('Connecting to TeraBridge...');

    const doResolve = async (forceRefresh) => {
      const idToken = await getTeraBridgeToken(forceRefresh);
      const activeApiBase = apiBase || 'https://api.tera-peek.in';
      return fetch(`${activeApiBase}/api/resolve?url=${encodeURIComponent(url)}&mode=stream`, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${idToken}` }
      });
    };

    try {
      let response = await doResolve(false);
      if (response.status === 401) response = await doResolve(true);
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const wait = retryAfter ? ` Try again in ${retryAfter}s.` : ' Please try again shortly.';
        throw new Error(`Too many requests — rate limit reached.${wait}`);
      }
      if (!response.ok) throw new Error(`Server responded with status ${response.status}`);

      setFetchStep('Parsing file details...');
      const data = await response.json();
      const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.flv', '.wmv', '.m4v', '.3gp', '.mpg', '.mpeg', '.ts', '.m3u8'];
      const videoFiles = (data.files || []).filter(file => {
        if (file.is_directory) return false;
        const name = (file.filename || '').toLowerCase();
        return VIDEO_EXTENSIONS.some(ext => name.endsWith(ext));
      });

      if (videoFiles.length === 0) {
        const otherFiles = (data.files || []).filter(file => !file.is_directory);
        if (otherFiles.length > 0) {
          navigate(`/files?url=${encodeURIComponent(url)}`, { state: { resolvedData: data } });
          return;
        }
        throw new Error('No files found in this share link.');
      }

      const newVideos = videoFiles.map((file, idx) => {
        const fileId = file.fs_id || `${Date.now()}_${idx}`;
        let sizeStr = 'Unknown Size';
        if (file.size_mb) sizeStr = `${file.size_mb.toFixed(1)} MB`;
        else if (file.size_bytes) sizeStr = `${(file.size_bytes / (1024 * 1024)).toFixed(1)} MB`;

        const fallbackThumb = 'https://i.ibb.co/wbdZsJ5/x.jpg';
        const thumbUrl = file.thumbnails?.url2 || file.thumbnails?.url1 || file.thumbnails?.icon || fallbackThumb;
        const resolvedStreamUrl = file.stream_url || null;

        return {
          id: fileId,
          title: file.filename || `TeraBox Video #${String(fileId).substring(0, 6)}`,
          description: `Imported from TeraBox URL. High-speed HLS stream proxied via TeraBridge. Original Path: ${file.path || '/'}`,
          size: sizeStr,
          duration: typeof file.duration === 'number' ? formatDuration(file.duration) : (typeof file.duration === 'string' && file.duration.trim() ? file.duration : '02:00'),
          progress: 0,
          favorite: false,
          videoUrl: resolvedStreamUrl,
          downloadUrl: file.dlink,
          thumbnail: thumbUrl,
          thumbnailUrl: thumbUrl,
          relativeTime: 'Just now',
          addedDate: new Date().toISOString(),
          resolution: detectResolution(file.filename, file.streams),
          streamReady: true,
          originalUrl: url,
          fileIndex: idx,
          category: categorizeVideo(file.filename),
          views: 0,
          plays: 0
        };
      });

      const currentVideos = videosRef.current;
      const currentHistory = historyRef.current;
      const existingIds = new Set(currentVideos.map(v => String(v.id)));
      const filteredNew = newVideos.filter(nv => !existingIds.has(String(nv.id)));
      const updatedVideos = [...filteredNew, ...currentVideos];
      const now = new Date().toISOString();
      const historyRecords = newVideos.map(nv => ({
        id: `h_${Date.now()}_${nv.id}`,
        videoId: nv.id,
        title: nv.title,
        size: nv.size,
        duration: nv.duration,
        thumbnail: nv.thumbnail,
        thumbnailUrl: nv.thumbnailUrl,
        videoUrl: nv.videoUrl,
        downloadUrl: nv.downloadUrl,
        originalUrl: nv.originalUrl,
        resolution: nv.resolution,
        progress: 0,
        watchedAt: now
      }));
      const updatedHistory = [
        ...historyRecords,
        ...currentHistory.filter(h => !newVideos.some(v => String(v.id) === String(h.videoId)))
      ].slice(0, 50);

      setVideosInDb(updatedVideos);
      setHistoryInDb(updatedHistory);

      if (currentUser && shareToDiscover) {
        newVideos.forEach(nv => {
          const uploaderObj = {
            uid: currentUser.uid,
            username: userProfile?.username || currentUser.displayName || `User_${currentUser.uid.substring(0, 5)}`,
            avatar: userProfile?.avatar || currentUser.photoURL || fallbackThumb
          };
          const publicVideo = { ...nv, uploader: uploaderObj };
          delete publicVideo.progress;
          delete publicVideo.favorite;
          set(ref(db, `discoverVideos/${nv.id}`), publicVideo).catch(() => {});
        });
      }

      navigate(`/player/${newVideos[0].id}`, { state: { resolvedVideo: newVideos[0] } });
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('API Resolve Error:', err);
      setFetchError(err.message || 'An unexpected error occurred while resolving your link. Please try again.');
    } finally {
      setIsFetching(false);
    }
  }, [currentUser, navigate, shareToDiscover, apiBase]);

  return { isFetching, fetchError, fetchStep, handleFetch, setFetchError };
}
