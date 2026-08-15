import React, { useEffect, useState, Suspense, lazy } from 'react';
import { createHashRouter, RouterProvider, Routes, Route, useNavigate, Link, useLocation } from 'react-router-dom';
import { Play, History, User, Settings, Loader2, LogOut } from 'lucide-react';
import Sidebar from './components/Sidebar';
import ConfirmDialog from './components/ConfirmDialog';
import ShareModal from './components/ShareModal';
import { db, auth } from './firebase';
import { ref, set } from 'firebase/database';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useDocumentMeta } from './hooks/useDocumentMeta';
import { useProfile } from './hooks/useProfile';
import { useSettings } from './hooks/useSettings';
import { useDiscover } from './hooks/useDiscover';
import { useHistory } from './hooks/useHistory';
import { useVideos } from './hooks/useVideos';
import { useFetch } from './hooks/useFetch';

const HomeView = lazy(() => import('./components/HomeView'));
const DiscoverView = lazy(() => import('./components/DiscoverView'));
const LibraryView = lazy(() => import('./components/LibraryView'));
const ProfileView = lazy(() => import('./components/ProfileView'));
const SettingsView = lazy(() => import('./components/SettingsView'));
const HistoryView = lazy(() => import('./components/HistoryView'));
const LandingPage = lazy(() => import('./components/LandingPage'));
const AuthScreen = lazy(() => import('./components/AuthScreen'));
const NotFoundView = lazy(() => import('./components/NotFoundView'));
const PlayerRouteWrapper = lazy(() => import('./components/PlayerRouteWrapper'));
const FilesView = lazy(() => import('./components/FilesView'));

const SuspenseFallback = () => <div className="fixed inset-0 bg-bg z-[9999] flex items-center justify-center font-body"><Loader2 size={40} className="text-accent animate-spin" /></div>;

(() => {
  const savedTheme = localStorage.getItem('teraplay_theme_mode') || 'dark';
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (savedTheme === 'light') { root.classList.add('light'); root.classList.remove('dark'); if (meta) meta.setAttribute('content', '#f7f8fa'); }
  else if (savedTheme === 'dark') { root.classList.add('dark'); root.classList.remove('light'); if (meta) meta.setAttribute('content', '#0a0a0f'); }
  else { const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches; root.classList.toggle('dark', isDark); root.classList.toggle('light', !isDark); if (meta) meta.setAttribute('content', isDark ? '#0a0a0f' : '#f7f8fa'); }
  const saved = localStorage.getItem('teraplay_accent');
  if (saved) { try { const color = JSON.parse(saved); document.documentElement.style.setProperty('--color-accent', color.value); document.documentElement.style.setProperty('--color-accent-muted', color.muted); document.documentElement.style.setProperty('--accent', color.value); document.documentElement.style.setProperty('--accent-muted', color.muted); } catch {} }
  if (!localStorage.getItem('teraplay_mock_cleaned_v2')) { localStorage.removeItem('teraplay_videos'); localStorage.removeItem('teraplay_downloads'); localStorage.removeItem('teraplay_history'); localStorage.setItem('teraplay_mock_cleaned_v2', 'true'); }
  const params = new URLSearchParams(window.location.search);
  const sharedVideoId = params.get('id');
  if (sharedVideoId) { window.history.replaceState(null, '', window.location.pathname); window.location.hash = `/player/${sharedVideoId}`; }
})();

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser, authLoading } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('teraplay_sidebar_collapsed') === 'true');
  const handleToggleSidebar = () => setSidebarCollapsed(prev => { const next = !prev; localStorage.setItem('teraplay_sidebar_collapsed', next.toString()); return next; });

  useEffect(() => { if (currentUser && location.pathname === '/auth') navigate('/', { replace: true }); }, [currentUser, location.pathname, navigate]);

  const { userProfile } = useProfile(currentUser);
  const { settings, handleUpdateSettings, handleResetData } = useSettings(currentUser);
  const { discoverVideos, discoverVideosRef, dbCategories, topCreators } = useDiscover(currentUser);
  const { history, historyRef, setHistoryInDb, handleRemoveHistoryItem, clearAllHistory } = useHistory(currentUser);
  const { videos, videosRef, deletingVideoIdRef, setVideosInDb, handleImportVideo, handleToggleFavorite, handleUpdateVideo, handleIncrementVideoViewsAndPlays } = useVideos(currentUser);
  const { isFetching, fetchError, fetchStep, handleFetch, setFetchError } = useFetch(currentUser, navigate, { videosRef, historyRef, userProfile, setVideosInDb, setHistoryInDb, shareToDiscover: settings.shareToDiscover !== false });

  useDocumentMeta(location, videos, discoverVideos);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: null });
  const [previewImage, setPreviewImage] = useState(null);
  const [shareVideo, setShareVideo] = useState(null);

  useEffect(() => {
    if (!currentUser || !videos?.length || !discoverVideos?.length) return;
    const discoverById = new Map(discoverVideos.map(pv => [String(pv.id), pv]));
    let mutated = false;
    const synced = videos.map(v => {
      const publicVid = discoverById.get(String(v.id));
      if (!publicVid) return v;
      const updates = {};
      if (publicVid.duration && publicVid.duration !== '02:00' && publicVid.duration !== v.duration) updates.duration = publicVid.duration;
      if (publicVid.resolution && publicVid.resolution !== 'Auto' && publicVid.resolution !== v.resolution) updates.resolution = publicVid.resolution;
      if (publicVid.category && publicVid.category !== v.category) updates.category = publicVid.category;
      if (typeof publicVid.views === 'number' && publicVid.views !== v.views) updates.views = publicVid.views;
      if (typeof publicVid.plays === 'number' && publicVid.plays !== v.plays) updates.plays = publicVid.plays;
      if (!Object.keys(updates).length) return v;
      mutated = true;
      return { ...v, ...updates };
    });
    if (mutated) setVideosInDb(synced);
  }, [currentUser, videos, discoverVideos, setVideosInDb]);

  const handleVideoSelect = (video) => {
    const currentVideos = videosRef.current;
    const currentHistory = historyRef.current;
    const vidIdStr = String(video.id);
    const updatedVideos = currentVideos.map(v => {
      const isSelected = String(v.id) === vidIdStr;
      const currentProgress = typeof v.progress === 'number' && !isNaN(v.progress) ? v.progress : 0;
      return { ...v, progress: isSelected ? (currentProgress === 0 ? 1 : currentProgress) : currentProgress, relativeTime: isSelected ? 'Just now' : (v.relativeTime || 'Just now'), addedDate: isSelected ? new Date().toISOString() : (v.addedDate || new Date().toISOString()) };
    });
    const filteredHistory = currentHistory.filter(h => String(h.videoId) !== vidIdStr);
    const videoProgress = typeof video.progress === 'number' && !isNaN(video.progress) ? video.progress : 0;
    const newRecord = { id: `h_${Date.now()}`, videoId: video.id, title: video.title, size: video.size, duration: video.duration, thumbnail: video.thumbnail, thumbnailUrl: video.thumbnailUrl || video.thumbnail, videoUrl: video.videoUrl || null, downloadUrl: video.downloadUrl || null, originalUrl: video.originalUrl || null, resolution: video.resolution || 'Auto', progress: videoProgress === 0 ? 1 : videoProgress, watchedAt: new Date().toISOString() };
    if (currentVideos.some(v => String(v.id) === vidIdStr)) setVideosInDb(updatedVideos);
    setHistoryInDb([newRecord, ...filteredHistory].slice(0, 50));
  };

  const handleDeleteVideo = (videoId) => {
    const vidIdStr = String(videoId); deletingVideoIdRef.current = vidIdStr;
    const matched = videosRef.current.find(v => String(v.id) === vidIdStr); const title = matched ? matched.title : 'this video';
    setConfirmDialog({ isOpen: true, title: 'Delete Video', message: `Are you sure you want to delete "${title}" from your library?`, onConfirm: () => {
      setConfirmDialog(d => ({ ...d, isOpen: false }));
      const currentVideos = videosRef.current; const currentHistory = historyRef.current;
      const updatedVideos = currentVideos.filter(v => String(v.id) !== vidIdStr); const updatedHistory = currentHistory.filter(h => String(h.videoId) !== vidIdStr);
      if (window.location.hash.includes(vidIdStr)) navigate('/', { replace: true });
      if (currentUser) { set(ref(db, `users/${currentUser.uid}/videos`), updatedVideos.length ? updatedVideos : null).catch(() => {}); set(ref(db, `users/${currentUser.uid}/history`), updatedHistory.length ? updatedHistory : null).catch(() => {}); set(ref(db, `users/${currentUser.uid}/progress/${videoId}`), null).catch(() => {}); }
      else { setVideosInDb(updatedVideos); setHistoryInDb(updatedHistory); }
      setTimeout(() => { if (deletingVideoIdRef.current === vidIdStr) deletingVideoIdRef.current = null; }, 100);
    }, onCancel: () => { setConfirmDialog(d => ({ ...d, isOpen: false })); deletingVideoIdRef.current = null; } });
  };

  const handleClearAllHistory = () => setConfirmDialog({ isOpen: true, title: 'Clear Watch History', message: 'Are you sure you want to clear your complete watch history? This cannot be undone.', onConfirm: () => { clearAllHistory(); setConfirmDialog(d => ({ ...d, isOpen: false })); } });

  const handlePlayFromHistory = (videoId, historyItem) => {
    const matched = videosRef.current.find(v => String(v.id) === String(videoId));
    const playableVideo = matched || (historyItem?.videoUrl ? { id: historyItem.videoId, title: historyItem.title, size: historyItem.size, duration: historyItem.duration, thumbnail: historyItem.thumbnailUrl || historyItem.thumbnail, thumbnailUrl: historyItem.thumbnailUrl || historyItem.thumbnail, videoUrl: historyItem.videoUrl, downloadUrl: historyItem.downloadUrl, originalUrl: historyItem.originalUrl, resolution: historyItem.resolution || 'Auto', progress: historyItem.progress || 0, favorite: false, streamReady: true, category: 'History', views: 0, plays: 0 } : null);
    if (!playableVideo) return;
    handleVideoSelect(playableVideo);
    navigate(`/player/${videoId}`, { state: { resolvedVideo: playableVideo } });
  };

  const onToggleFavorite = (videoId) => handleToggleFavorite(videoId, discoverVideosRef);
  const onResetData = () => handleResetData(() => { if (currentUser) { set(ref(db, `users/${currentUser.uid}/videos`), null); set(ref(db, `users/${currentUser.uid}/history`), null); } else { localStorage.removeItem('teraplay_videos'); localStorage.removeItem('teraplay_history'); setVideosInDb([]); setHistoryInDb([]); } });

  if (authLoading) return <div className="fixed inset-0 bg-bg z-[9999] flex items-center justify-center"><Loader2 size={40} className="text-accent animate-spin" /></div>;
  if (!currentUser) {
    if (location.pathname === '/auth') return <Suspense fallback={<SuspenseFallback />}><AuthScreen onClose={() => navigate('/')} initialIsSignUp={location.state?.isSignUp || false} /></Suspense>;
    return <Suspense fallback={<SuspenseFallback />}><LandingPage onNavigateToAuth={(isSignUp) => navigate('/auth', { state: { isSignUp } })} /></Suspense>;
  }

  return (
    <div className="flex min-h-screen bg-bg relative text-fg overflow-x-hidden">
      {settings.showBackground !== false && <div className="absolute top-0 left-0 right-0 h-[750px] pointer-events-none z-0 overflow-hidden opacity-65"><div className="premium-wave-bg"></div><div className="premium-wave-tint"></div><div className="premium-wave-fade"></div></div>}
      <Sidebar isCollapsed={sidebarCollapsed} onToggleCollapse={handleToggleSidebar} settings={settings} onUpdateSettings={handleUpdateSettings} />
      <header className="fixed top-0 left-0 right-0 h-16 bg-glass backdrop-blur-3xl border-b border-custom-border z-[90] flex items-center justify-between px-4 md:hidden select-none">
        <Link to="/" className="flex items-center gap-2 font-bold text-base text-fg"><div className="w-7 h-7 bg-accent rounded-lg grid place-items-center text-bg"><Play fill="currentColor" size={12} className="ml-0.5" /></div><span>TeraBox Player</span></Link>
        <div className="flex items-center gap-1"><Link to="/history" className="p-2 text-muted hover:text-accent hover:bg-surface-elevated rounded-xl"><History size={20} /></Link><Link to="/profile" className="p-2 text-muted hover:text-accent hover:bg-surface-elevated rounded-xl"><User size={20} /></Link><Link to="/settings" className="p-2 text-muted hover:text-accent hover:bg-surface-elevated rounded-xl"><Settings size={20} /></Link><button type="button" onClick={() => auth.signOut()} aria-label="Sign Out" className="p-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl"><LogOut size={20} /></button></div>
      </header>
      <main className={`flex-1 ${sidebarCollapsed ? 'md:ml-20' : 'md:ml-64'} transition-all duration-300 p-4 pt-24 md:p-10 w-full min-h-screen pb-28 md:pb-10 box-border flex flex-col`}>
        <Suspense fallback={<SuspenseFallback />}>
          <Routes>
            <Route path="/" element={<HomeView onFetch={handleFetch} isFetching={isFetching} fetchError={fetchError} fetchStep={fetchStep} onClearError={() => setFetchError(null)} videos={videos} onVideoSelect={handleVideoSelect} onToggleFavorite={onToggleFavorite} onDeleteVideo={handleDeleteVideo} onPreviewImage={setPreviewImage} />} />
            <Route path="/discover" element={<DiscoverView videos={videos} discoverVideos={discoverVideos} onVideoSelect={handleVideoSelect} onPreviewImage={setPreviewImage} onShareVideo={setShareVideo} onImportVideo={handleImportVideo} currentUser={currentUser} dbCategories={dbCategories} topCreators={topCreators} />} />
            <Route path="/library" element={<LibraryView videos={videos} onVideoSelect={handleVideoSelect} onToggleFavorite={onToggleFavorite} onDeleteVideo={handleDeleteVideo} onPreviewImage={setPreviewImage} />} />
            <Route path="/history" element={<HistoryView history={history} onClearHistory={handleClearAllHistory} onRemoveItem={handleRemoveHistoryItem} onPlayVideo={handlePlayFromHistory} />} />
            <Route path="/player/:id" element={<PlayerRouteWrapper videos={videos} discoverVideos={discoverVideos} handleToggleFavorite={onToggleFavorite} handleVideoSelect={handleVideoSelect} handleUpdateVideo={handleUpdateVideo} handleIncrementVideoViewsAndPlays={handleIncrementVideoViewsAndPlays} currentUser={currentUser} onDeleteVideo={handleDeleteVideo} onShareVideo={setShareVideo} settings={settings} />} />
            <Route path="/profile" element={<ProfileView userProfile={userProfile} />} />
            <Route path="/settings" element={<SettingsView settings={settings} onUpdateSettings={handleUpdateSettings} onResetData={onResetData} />} />
            <Route path="/files" element={<FilesView />} />
            <Route path="*" element={<NotFoundView />} />
          </Routes>
        </Suspense>
      </main>
      {confirmDialog.isOpen && <ConfirmDialog {...confirmDialog} />}
      {previewImage && <div className="fixed inset-0 z-[9999] bg-black/80 grid place-items-center p-6" onClick={() => setPreviewImage(null)}><img src={previewImage} className="max-w-full max-h-full rounded-xl" alt="Preview" /></div>}
      {shareVideo && <ShareModal video={shareVideo} onClose={() => setShareVideo(null)} />}
      {fetchError && <div className="sr-only" aria-live="polite">{fetchError}</div>}
    </div>
  );
}

const router = createHashRouter([{ path: '*', element: <AuthProvider><AppShell /></AuthProvider> }]);
export default function App() { return <RouterProvider router={router} />; }
