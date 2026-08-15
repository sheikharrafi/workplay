import { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { ref, onValue } from 'firebase/database';
import { calculateTopCreators } from '../utils/calculateTopCreators';

const DEFAULT_CATEGORIES = ['Cinema', 'Lo-Fi', 'Animation', 'Nature', 'Tech', 'Tutorials'];

export function useDiscover(currentUser) {
  const [discoverVideos, setDiscoverVideos] = useState([]);
  const discoverVideosRef = useRef([]);
  const [dbCategories, setDbCategories] = useState(DEFAULT_CATEGORIES);
  const [topCreators, setTopCreators] = useState([]);
  const userVideosRef = useRef([]);

  useEffect(() => { discoverVideosRef.current = discoverVideos; }, [discoverVideos]);

  useEffect(() => {
    if (!currentUser) { setDbCategories(DEFAULT_CATEGORIES); return; }
    const categoriesRef = ref(db, 'categories');
    return onValue(categoriesRef, snapshot => {
      const data = snapshot.val();
      setDbCategories(Array.isArray(data) && data.length ? data : DEFAULT_CATEGORIES);
    }, error => {
      console.error('Firebase categories fetch failed:', error);
      setDbCategories(DEFAULT_CATEGORIES);
    });
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) { setTopCreators([]); return; }
    const topCreatorsRef = ref(db, 'topCreators');
    return onValue(topCreatorsRef, snapshot => {
      const data = snapshot.val();
      setTopCreators(data ? (Array.isArray(data) ? data : Object.values(data)) : []);
    }, error => {
      console.error('Firebase top creators fetch failed:', error);
      setTopCreators([]);
    });
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) { userVideosRef.current = []; return; }
    const userVideosDbRef = ref(db, `users/${currentUser.uid}/videos`);
    return onValue(userVideosDbRef, snapshot => {
      const data = snapshot.val();
      userVideosRef.current = Array.isArray(data) ? data.filter(Boolean) : (data ? Object.values(data).filter(Boolean) : []);
      setDiscoverVideos(prev => prev.map(v => {
        const mine = userVideosRef.current.find(x => String(x.id) === String(v.id));
        return mine ? { ...v, favorite: mine.favorite === true } : { ...v, favorite: false };
      }));
    });
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) { setDiscoverVideos([]); setTopCreators([]); return; }
    const discoverRef = ref(db, 'discoverVideos');
    return onValue(discoverRef, snapshot => {
      const data = snapshot.val();
      if (!data) { setDiscoverVideos([]); setTopCreators([]); return; }
      const videoList = Array.isArray(data) ? data : Object.values(data);
      const uniqueVids = videoList.filter(vid => vid && vid.id).map(vid => {
        const mine = userVideosRef.current.find(v => String(v.id) === String(vid.id));
        return { ...vid, favorite: mine?.favorite === true };
      });
      setDiscoverVideos(uniqueVids);
      setTopCreators(calculateTopCreators(uniqueVids));
    }, error => {
      console.error('Firebase Discover fetch failed:', error);
      setDiscoverVideos([]);
      setTopCreators([]);
    });
  }, [currentUser]);

  return { discoverVideos, discoverVideosRef, dbCategories, topCreators };
}
