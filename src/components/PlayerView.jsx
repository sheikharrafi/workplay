import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Hls from 'hls.js';
import { ChevronLeft, Play, Pause, RotateCcw, Volume2, VolumeX, Maximize2, Minimize2, Download, Heart, Share2, Copy, SkipForward, HelpCircle, Check, AlertCircle, Trash2, ChevronDown } from 'lucide-react';
import { db } from '../firebase';
import { ref, set, get } from 'firebase/database';
import { useAuth } from '../contexts/AuthContext';

class CustomLoader extends Hls.DefaultConfig.loader {
  constructor(config) { super(config); this.apiBase = config.apiBase || ''; }
  load(context, config, callbacks) {
    if (context.url) {
      try {
        let urlObj;
        try { urlObj = new URL(context.url); } catch { urlObj = new URL(context.url, this.apiBase); }
        const apiBaseUrl = new URL(this.apiBase);
        urlObj.protocol = apiBaseUrl.protocol;
        urlObj.host = apiBaseUrl.host;
        context.url = urlObj.toString();
      } catch (error) { console.error('Error customizing HLS request URL:', error); }
    }
    super.load(context, config, callbacks);
  }
}

const FALLBACK_THUMBNAIL = 'https://i.ibb.co/wbdZsJ5/x.jpg';
const RESOLUTION_HEIGHTS = { '4k': 2160, '1080p': 1080, '720p': 720, '480p': 480 };

export default function PlayerView({ video, relatedVideos = [], onVideoSelect, onBack, onToggleFavorite, onUpdateVideo, onIncrementViewsAndPlays, currentUser, onDeleteVideo, onShareVideo, settings = { autoplay: true, rememberProgress: true, resolution: 'auto' } }) {
  const { apiBase } = useAuth();
  const activeApiBase = apiBase || '';
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hlsRef = useRef(null);
  const manualQualityRef = useRef(-1);
  const controlsTimeoutRef = useRef(null);
  const bufferTimeoutRef = useRef(null);
  const actionTimeoutRef = useRef(null);
  const skipTimeoutRef = useRef(null);
  const lastSavedTimeRef = useRef(0);
  const playTrackedRef = useRef(false);
  const volumeBeforeMuteRef = useRef(1);
  const currentVideoRef = useRef(video);
  currentVideoRef.current = video;

  const [streamNonce, setStreamNonce] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => { const saved = Number(localStorage.getItem('teraplay_volume')); return Number.isFinite(saved) ? Math.min(Math.max(saved, 0), 1) : 1; });
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [skipFeedback, setSkipFeedback] = useState(null);
  const [clickAction, setClickAction] = useState(null);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [bufferingResolution, setBufferingResolution] = useState('');
  const [currentResolution, setCurrentResolution] = useState(video.resolution || 'Auto');
  const [activeResolution, setActiveResolution] = useState('');
  const [qualities, setQualities] = useState([]);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [videoError, setVideoError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const isHlsActive = Boolean(video.videoUrl && (video.videoUrl.includes('.m3u8') || video.videoUrl.includes('/api/stream/manifest')));

  const showToast = useCallback((message, type = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    window.setTimeout(() => setToasts(prev => prev.filter(item => item.id !== id)), 2600);
  }, []);

  const saveProgress = useCallback((time, totalDuration) => {
    const item = currentVideoRef.current;
    if (!settings.rememberProgress || !totalDuration || !Number.isFinite(totalDuration) || totalDuration <= 0 || !Number.isFinite(time)) return;
    const pct = Math.round((time / totalDuration) * 100);
    onUpdateVideo?.({ ...item, progress: pct });
    if (currentUser) {
      const path = `users/${currentUser.uid}/progress/${item.id}`;
      if (time > 5 && time < totalDuration * 0.95) set(ref(db, path), time).catch(() => {});
      else if (time >= totalDuration * 0.95 || time <= 0) set(ref(db, path), null).catch(() => {});
    } else if (time > 5 && time < totalDuration * 0.95) localStorage.setItem(`progress_${item.id}`, String(time));
    else if (time >= totalDuration * 0.95 || time <= 0) localStorage.removeItem(`progress_${item.id}`);
  }, [currentUser, onUpdateVideo, settings.rememberProgress]);

  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (isPlaying && !isBuffering) controlsTimeoutRef.current = window.setTimeout(() => setShowControls(false), 3000);
  }, [isPlaying, isBuffering]);

  const playVideo = useCallback(async () => {
    const element = videoRef.current;
    if (!element) return false;
    try { await element.play(); setIsPlaying(true); return true; }
    catch (error) { setIsPlaying(false); if (error?.name !== 'AbortError') showToast('Playback could not start. Tap play again.', 'error'); return false; }
  }, [showToast]);

  const handlePlayPause = useCallback(async () => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) {
      const started = await playVideo();
      setClickAction(started ? 'play' : null);
    } else {
      element.pause(); setIsPlaying(false); setClickAction('pause'); saveProgress(element.currentTime, element.duration);
    }
    if (actionTimeoutRef.current) clearTimeout(actionTimeoutRef.current);
    actionTimeoutRef.current = window.setTimeout(() => setClickAction(null), 500);
    resetControlsTimer();
  }, [playVideo, resetControlsTimer, saveProgress]);

  const retryStream = useCallback(() => { setVideoError(null); setIsBuffering(false); setIsInitialLoading(true); setShowQualityMenu(false); setStreamNonce(value => value + 1); }, []);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !video.videoUrl) return undefined;
    let hls = null;
    let disposed = false;
    manualQualityRef.current = -1;
    setIsPlaying(false); setIsInitialLoading(true); setIsBuffering(false); setVideoError(null); setQualities([]); setShowQualityMenu(false); setCurrentTime(0); setDuration(0);

    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: false, capLevelToPlayerSize: true, startFragPrefetch: true, startLevel: -1, maxBufferLength: 18, maxMaxBufferLength: 36, backBufferLength: 30, maxBufferHole: 0.35, maxBufferSize: 48 * 1000 * 1000, abrEwmaDefaultEstimate: 1000000, abrBandWidthFactor: 0.82, abrBandWidthUpFactor: 0.65, manifestLoadingTimeOut: 5000, manifestLoadingMaxRetry: 3, manifestLoadingRetryDelay: 350, levelLoadingTimeOut: 5000, levelLoadingMaxRetry: 3, levelLoadingRetryDelay: 350, fragLoadingTimeOut: 5000, fragLoadingMaxRetry: 4, fragLoadingRetryDelay: 350, loader: CustomLoader, fLoader: CustomLoader, pLoader: CustomLoader, apiBase: activeApiBase });
      hlsRef.current = hls;
      hls.loadSource(video.videoUrl); hls.attachMedia(element);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (disposed) return;
        const levels = hls.levels.map((level, index) => ({ id: index, name: level.height ? `${level.height}p` : level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : `Level ${index}` }));
        const unique = []; const names = new Set();
        levels.forEach(level => { if (!names.has(level.name)) { names.add(level.name); unique.push(level); } });
        setQualities([{ id: -1, name: 'Auto' }, ...unique]); setCurrentResolution('Auto'); setActiveResolution(levels[hls.currentLevel]?.name || levels[0]?.name || '');
        const targetHeight = RESOLUTION_HEIGHTS[settings.resolution];
        if (targetHeight) {
          const match = hls.levels.findIndex(level => level.height && Math.abs(level.height - targetHeight) < targetHeight * 0.25);
          if (match >= 0) { manualQualityRef.current = match; hls.currentLevel = match; const name = levels[match]?.name || `${hls.levels[match].height}p`; setCurrentResolution(name); setActiveResolution(name); }
        }
        playVideo();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        const level = hls.levels[data.level]; if (!level) return;
        const name = level.height ? `${level.height}p` : level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : `Level ${data.level}`;
        setActiveResolution(name);
        if (manualQualityRef.current >= 0 && data.level !== manualQualityRef.current) hls.currentLevel = manualQualityRef.current;
        if (manualQualityRef.current < 0) setBufferingResolution(name);
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => { if (bufferTimeoutRef.current) clearTimeout(bufferTimeoutRef.current); bufferTimeoutRef.current = null; setIsBuffering(false); setBufferingResolution(''); });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal || disposed) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { hls.startLoad(); return; }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
        setIsPlaying(false); setIsBuffering(false); setIsInitialLoading(false); setVideoError('HLS playback failed. Retry to reconnect to the stream.');
      });
    } else if (element.canPlayType('application/vnd.apple.mpegurl')) {
      element.src = video.videoUrl; element.load(); playVideo();
    }

    return () => {
      disposed = true;
      if (element && settings.rememberProgress) saveProgress(element.currentTime, element.duration);
      if (hls) hls.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
      if (bufferTimeoutRef.current) clearTimeout(bufferTimeoutRef.current);
    };
  }, [activeApiBase, playVideo, saveProgress, settings.rememberProgress, settings.resolution, streamNonce, video.id, video.videoUrl]);

  useEffect(() => { setCurrentResolution(video.resolution || 'Auto'); setShowQualityMenu(false); setIsBuffering(false); setIsInitialLoading(true); setActiveResolution(''); setVideoError(null); playTrackedRef.current = false; }, [video.id, video.resolution]);
  useEffect(() => { if (isPlaying && !playTrackedRef.current) { playTrackedRef.current = true; onIncrementViewsAndPlays?.(video.id); } }, [isPlaying, onIncrementViewsAndPlays, video.id]);
  useEffect(() => { const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', onFs); return () => document.removeEventListener('fullscreenchange', onFs); }, []);
  useEffect(() => { resetControlsTimer(); return () => { if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current); if (actionTimeoutRef.current) clearTimeout(actionTimeoutRef.current); if (skipTimeoutRef.current) clearTimeout(skipTimeoutRef.current); }; }, [isBuffering, isPlaying, resetControlsTimer]);

  const formatTime = seconds => { if (!Number.isFinite(seconds)) return '0:00'; const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const secs = Math.floor(seconds % 60); return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${minutes}:${String(secs).padStart(2, '0')}`; };
  const handleTimeUpdate = () => { const element = videoRef.current; if (!element) return; setCurrentTime(element.currentTime); if (Math.abs(element.currentTime - lastSavedTimeRef.current) >= 5) { lastSavedTimeRef.current = element.currentTime; saveProgress(element.currentTime, element.duration); } };
  const handleLoadedMetadata = async () => { const element = videoRef.current; if (!element) return; element.volume = isMuted ? 0 : volume; element.muted = isMuted; element.playbackRate = playbackRate; if (Number.isFinite(element.duration)) setDuration(element.duration); if (settings.rememberProgress) { let savedTime = 0; if (currentUser) { try { const snapshot = await get(ref(db, `users/${currentUser.uid}/progress/${video.id}`)); if (snapshot.exists()) savedTime = Number(snapshot.val()) || 0; } catch {} } else savedTime = Number(localStorage.getItem(`progress_${video.id}`)) || 0; if (savedTime > 5 && savedTime < element.duration * 0.95) element.currentTime = savedTime; } };
  const handleDurationChange = () => { const element = videoRef.current; if (!element || !Number.isFinite(element.duration)) return; setDuration(element.duration); const formatted = formatTime(element.duration); if (video.duration !== formatted) onUpdateVideo?.({ ...video, duration: formatted }); };
  const skip = seconds => { const element = videoRef.current; if (!element || !Number.isFinite(element.duration)) return; element.currentTime = Math.min(Math.max(0, element.currentTime + seconds), element.duration); setCurrentTime(element.currentTime); setSkipFeedback(seconds > 0 ? 'fwd' : 'bwd'); if (skipTimeoutRef.current) clearTimeout(skipTimeoutRef.current); skipTimeoutRef.current = window.setTimeout(() => setSkipFeedback(null), 600); if (isPlaying) { if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current); controlsTimeoutRef.current = window.setTimeout(() => setShowControls(false), 900); } };
  const handleVolumeChange = event => { const value = Number(event.target.value); setVolume(value); setIsMuted(value === 0); if (value > 0) volumeBeforeMuteRef.current = value; localStorage.setItem('teraplay_volume', String(value)); if (videoRef.current) { videoRef.current.volume = value; videoRef.current.muted = value === 0; } };
  const toggleMute = () => { const element = videoRef.current; if (!isMuted) { volumeBeforeMuteRef.current = volume > 0 ? volume : 1; setIsMuted(true); if (element) element.muted = true; } else { const restored = volumeBeforeMuteRef.current || 1; setVolume(restored); setIsMuted(false); localStorage.setItem('teraplay_volume', String(restored)); if (element) { element.volume = restored; element.muted = false; } } };
  const toggleFullscreen = async () => { const container = containerRef.current; if (!container) return; try { if (!document.fullscreenElement) await container.requestFullscreen({ navigationUI: 'hide' }); else await document.exitFullscreen(); } catch { showToast('Fullscreen is not available in this browser.', 'error'); } };
  const handleQualityChange = quality => { if (!hlsRef.current) return; setShowQualityMenu(false); if (quality.id === -1) { manualQualityRef.current = -1; hlsRef.current.currentLevel = -1; hlsRef.current.nextLoadLevel = -1; setCurrentResolution('Auto'); return; } manualQualityRef.current = quality.id; hlsRef.current.currentLevel = quality.id; hlsRef.current.nextLoadLevel = quality.id; setCurrentResolution(quality.name); setActiveResolution(quality.name); };
  const handleWaiting = () => { if (bufferTimeoutRef.current) clearTimeout(bufferTimeoutRef.current); bufferTimeoutRef.current = window.setTimeout(() => { if (videoRef.current?.readyState < 3) setIsBuffering(true); }, 500); };
  const handlePlaying = () => { if (bufferTimeoutRef.current) clearTimeout(bufferTimeoutRef.current); setIsBuffering(false); setIsInitialLoading(false); };
  const handleVideoError = () => { if (hlsRef.current) return; setIsPlaying(false); setIsInitialLoading(false); setIsBuffering(false); setVideoError('Failed to load the video stream.'); };
  const handleCopyLink = () => { const link = video.videoUrl || video.downloadUrl || video.originalUrl || window.location.href; navigator.clipboard?.writeText(link).then(() => showToast('Streaming link copied')).catch(() => showToast('Failed to copy link', 'error')); };
  const handleRelatedClick = related => { onVideoSelect?.(related); navigate(`/player/${related.id}`); };
  const handleDoubleClick = event => { const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return; skip(event.clientX - rect.left < rect.width / 2 ? -10 : 10); };
  const progressPercent = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className={`w-full grid grid-cols-1 lg:grid-cols-[1fr_400px] rounded-3xl border border-custom-border bg-surface shadow-glass relative ${isFullscreen ? 'fixed inset-0 z-[9999] h-screen w-screen rounded-none border-0' : 'h-auto lg:h-[calc(100vh-120px)]'}`} onMouseMove={resetControlsTimer}>
      <div className="absolute top-3 left-3 md:top-6 md:left-6 z-[60]"><button onClick={onBack} className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-black/55 backdrop-blur-md grid place-items-center text-white border border-white/10 hover:bg-black/80 hover:text-accent" aria-label="Go back"><ChevronLeft size={20} /></button></div>
      <section ref={containerRef} className={`bg-black relative flex items-center justify-center overflow-hidden w-full select-none ${isFullscreen ? 'h-screen aspect-auto' : 'aspect-video lg:aspect-auto lg:h-full'}`}>
        <video ref={videoRef} src={isHlsActive ? undefined : video.videoUrl} className="w-full h-full object-contain cursor-pointer" onClick={handlePlayPause} onDoubleClick={handleDoubleClick} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleLoadedMetadata} onDurationChange={handleDurationChange} onEnded={() => { setIsPlaying(false); saveProgress(0, duration); if (settings.autoplay && relatedVideos.length) { const next = relatedVideos.find(item => item.id !== video.id); if (next) handleRelatedClick(next); } }} onError={handleVideoError} onWaiting={handleWaiting} onPlaying={handlePlaying} onCanPlay={handlePlaying} onLoadedData={() => setIsInitialLoading(false)} />
        {isInitialLoading && video.thumbnail && <div className="absolute inset-0 z-30 bg-black flex items-center justify-center"><img src={video.thumbnail || FALLBACK_THUMBNAIL} onError={event => { event.currentTarget.src = FALLBACK_THUMBNAIL; }} alt="" className="w-full h-full object-contain" /><div className="absolute inset-0 bg-black/15" /><div className="absolute w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" /></div>}
        {isBuffering && <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/65 pointer-events-none"><div className="flex flex-col items-center gap-3"><div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" /><span className="text-xs text-white/80">{bufferingResolution ? `Buffering ${bufferingResolution}...` : 'Buffering stream...'}</span></div></div>}
        {videoError && <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/90 p-6 text-center gap-4"><div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 grid place-items-center text-rose-400"><AlertCircle size={24} /></div><div><h4 className="font-bold text-white">Stream Loading Failed</h4><p className="text-xs text-white/60 mt-1 max-w-xs">{videoError}</p></div><button onClick={retryStream} className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-white text-xs font-semibold hover:bg-white/20">Retry Playback</button></div>}
        {clickAction && <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center"><div className="w-16 h-16 rounded-full bg-black/55 border border-white/10 grid place-items-center text-white">{clickAction === 'play' ? <Play fill="currentColor" size={28} /> : <Pause fill="currentColor" size={28} />}</div></div>}
        {skipFeedback && <div className={`absolute inset-y-0 z-10 w-1/2 flex items-center justify-center pointer-events-none ${skipFeedback === 'bwd' ? 'left-0' : 'right-0'}`}><div className="w-14 h-14 rounded-full bg-white/10 border border-white/20 grid place-items-center text-white">{skipFeedback === 'bwd' ? <RotateCcw size={24} /> : <SkipForward size={24} />}</div></div>}
        {showControls && <div className="absolute bottom-0 left-0 right-0 z-50 p-2.5 sm:p-4 pb-3 sm:pb-5 bg-gradient-to-t from-black/95 via-black/60 to-transparent"><input type="range" min="0" max="100" step="0.1" value={progressPercent} onChange={event => { const value = Number(event.target.value); const time = duration * value / 100; if (videoRef.current) videoRef.current.currentTime = time; setCurrentTime(time); }} className="w-full h-1 accent-accent cursor-pointer mb-2 sm:mb-3" aria-label="Playback timeline" /><div className="flex items-center justify-between gap-2 text-white min-w-0"><div className="flex items-center gap-2 sm:gap-3 shrink-0"><button onClick={() => skip(-10)} aria-label="Rewind 10 seconds"><RotateCcw size={17} /></button><button onClick={handlePlayPause} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Pause fill="currentColor" size={21} /> : <Play fill="currentColor" size={21} />}</button><button onClick={() => skip(10)} aria-label="Forward 10 seconds"><SkipForward size={17} /></button><span className="text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatTime(currentTime)} / {formatTime(duration)}</span></div><div className="flex items-center gap-1.5 sm:gap-3 shrink-0 min-w-0"><div className="hidden sm:flex items-center gap-1.5"><button onClick={toggleMute} aria-label={isMuted ? 'Unmute' : 'Mute'}>{isMuted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>{showVolumeSlider && <input type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume} onChange={handleVolumeChange} className="w-16" />}</div>{isHlsActive && <div className="relative"><button onClick={() => setShowQualityMenu(value => !value)} className="text-[10px] sm:text-[11px] font-mono font-semibold px-1.5 sm:px-2 py-1 rounded bg-white/10 whitespace-nowrap">{currentResolution === 'Auto' ? `Auto${activeResolution ? ` (${activeResolution})` : ''}` : currentResolution}<ChevronDown size={11} className="inline ml-1" /></button>{showQualityMenu && <div className="absolute bottom-8 right-0 w-32 sm:w-36 bg-zinc-950 border border-white/10 rounded-xl p-1 shadow-2xl">{qualities.map(item => <button key={`${item.id}-${item.name}`} onClick={() => handleQualityChange(item)} className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs text-left ${currentResolution === item.name ? 'text-accent bg-white/5' : 'text-white hover:bg-white/5'}`}><span>{item.name}</span>{currentResolution === item.name && <Check size={12} />}</button>)}</div>}</div>}<div className="relative"><button onClick={() => { const rates = [0.5, 1, 1.25, 1.5, 2]; const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length]; setPlaybackRate(next); if (videoRef.current) videoRef.current.playbackRate = next; }} className="text-[10px] sm:text-xs font-mono font-semibold whitespace-nowrap">{playbackRate.toFixed(1)}x</button></div><button onClick={() => setShowShortcuts(value => !value)} className="hidden md:block" aria-label="Keyboard shortcuts"><HelpCircle size={18} /></button><button onClick={toggleFullscreen} className="shrink-0 p-1" aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>{isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}</button></div></div></div>}
        {showShortcuts && <div className="absolute inset-0 z-[70] bg-black/80 flex items-center justify-center p-6"><div className="bg-surface border border-custom-border rounded-2xl p-6 max-w-sm w-full text-fg"><div className="font-bold mb-4">Keyboard Shortcuts</div><div className="text-sm text-muted space-y-2"><div>Space — Play / Pause</div><div>← / → — Skip 10s</div><div>F — Fullscreen</div><div>M — Mute</div></div><button onClick={() => setShowShortcuts(false)} className="mt-5 px-4 py-2 rounded-lg bg-surface-elevated">Close</button></div></div>}
      </section>
      <aside className="p-5 md:p-8 lg:border-l border-t lg:border-t-0 border-custom-border bg-surface lg:overflow-y-auto flex flex-col gap-6 lg:h-full"><div><h1 className="text-2xl font-bold leading-tight tracking-tight text-fg mb-4 break-words">{video.title}</h1><div className="flex gap-2 flex-wrap"><span className="text-[11px] font-bold text-muted bg-surface-elevated border border-custom-border rounded-lg px-2.5 py-1">{activeResolution || video.resolution || 'AUTO'}</span><span className="text-[11px] font-bold text-muted bg-surface-elevated border border-custom-border rounded-lg px-2.5 py-1">{video.size}</span><span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1">{isHlsActive ? '⚡ HLS Stream' : '🔗 Direct Link'}</span></div><div className="mt-5 flex flex-col gap-2 relative w-fit"><div className="text-[10px] font-bold text-muted uppercase tracking-wider">Category</div><button onClick={() => setShowCategoryDropdown(value => !value)} className="flex items-center gap-6 px-4 py-2 bg-surface-elevated border border-custom-border rounded-xl text-xs font-semibold text-fg"><span>{video.category || 'General'}</span><span className="text-accent text-[10px]">Edit</span></button>{showCategoryDropdown && <div className="absolute top-full left-0 mt-2 bg-surface-elevated border border-custom-border rounded-xl shadow-glass z-[100] p-1 flex flex-col min-w-[150px]">{['General','Cinema','Lo-Fi','Animation','Nature','Tech','Tutorials'].map(category => <button key={category} onClick={() => { onUpdateVideo?.({ ...video, category }); setShowCategoryDropdown(false); showToast(`Category updated to ${category}`); }} className="px-3 py-2 text-left rounded-lg text-xs hover:bg-white/5">{category}</button>)}</div>}</div></div><div className="grid grid-cols-2 gap-3"><a href={video.downloadUrl || video.videoUrl || ''} download target="_blank" rel="noopener noreferrer" onClick={() => showToast('Download started')} className="flex items-center justify-center gap-2 p-3 rounded-xl bg-accent text-bg font-semibold text-xs"><Download size={16} />Download</a><button onClick={() => { onToggleFavorite?.(video.id); showToast(video.favorite ? 'Removed from favorites' : 'Added to favorites'); }} className={`flex items-center justify-center gap-2 p-3 rounded-xl border border-custom-border bg-surface-elevated font-semibold text-xs ${video.favorite ? 'border-accent text-accent' : ''}`}><Heart size={16} fill={video.favorite ? 'currentColor' : 'none'} />{video.favorite ? 'Favorited' : 'Favorite'}</button><button onClick={() => onShareVideo?.(video)} className="flex items-center justify-center gap-2 p-3 rounded-xl border border-custom-border bg-surface-elevated font-semibold text-xs"><Share2 size={16} />Share</button><button onClick={handleCopyLink} className="flex items-center justify-center gap-2 p-3 rounded-xl border border-custom-border bg-surface-elevated font-semibold text-xs"><Copy size={16} />Copy Link</button><button onClick={() => onDeleteVideo?.(video.id)} className="col-span-2 flex items-center justify-center gap-2 p-3 rounded-xl border border-rose-500/20 bg-rose-500/5 font-semibold text-xs text-rose-400"><Trash2 size={16} />Delete Video</button></div><p className="text-sm text-muted leading-relaxed">{isHlsActive ? 'Imported from TeraBox URL. High-speed HLS stream proxied via TeraBridge.' : 'Imported from TeraBox URL. Direct stream link.'} Original Path: {video.path || '/'}</p><div className="border-t border-custom-border pt-6"><div className="font-bold text-base text-fg mb-4">Up Next</div><div className="flex flex-col gap-4">{relatedVideos.filter(item => item.id !== video.id).map(item => <div key={item.id} className="flex gap-4 p-2 rounded-xl hover:bg-surface-elevated cursor-pointer" onClick={() => handleRelatedClick(item)}><div className="w-24 aspect-video bg-surface-elevated rounded-lg overflow-hidden shrink-0"><img src={item.thumbnail || FALLBACK_THUMBNAIL} alt="" className="w-full h-full object-cover" /></div><div className="min-w-0"><h4 className="font-semibold text-xs text-fg leading-snug line-clamp-2">{item.title}</h4><div className="text-[10px] text-muted font-mono mt-1">{item.size} • {item.duration}</div></div></div>)}</div></div></aside>
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">{toasts.map(toast => <div key={toast.id} className="px-4 py-3 rounded-xl bg-surface border border-custom-border shadow-glass text-sm font-medium text-fg"><span className={`inline-block w-2 h-2 rounded-full mr-2 ${toast.type === 'error' ? 'bg-rose-400' : 'bg-emerald-400'}`} />{toast.message}</div>)}</div>
    </div>
  );
}
