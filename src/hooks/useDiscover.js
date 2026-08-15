import { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { ref, onValue, set } from 'firebase/database';
import { calculateTopCreators } from '../utils/calculateTopCreators';

export function useDiscover(currentUser) {
  const [discoverVideos, setDiscoverVideos] = useState([]);
  const discoverVideosRef = useRef([]);
  const [dbCategories, setDbCategories] = useState([]);
  const [topCreators, setTopCreators] = useState([]);
  const userVideosRef = useRef([]);

  useEffect(() => { discoverVideosRef.current = discoverVideos; }, [discoverVideos]);

  useEffect(() => {
    if (!currentUser) { setDbCategories([]); return; }
    const categoriesRef = ref(db, 'categories');
    const unsubscribe = onValue(categoriesRef, snapshot => {
      const data = snapshot.val();
      if (data && Array.isArray(data)) setDbCategories(data);
      else {
        const defaults = ['Cinema', 'Lo-Fi', 'Animation', 'Nature', 'Tech', 'Tutorials'];
        set(categoriesRef, defaults);
        setDbCategories(defaults);
      }
    });
    return unsubscribe;
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) { setTopCreators([]); return; }
    const topCreatorsRef = ref(db, 'topCreators');
    const unsubscribe = onValue(topCreatorsRef, snapshot => {
      const data = snapshot.val();
      setTopCreators(data ? (Array.isArray(data) ? data : Object.values(data)) : []);
    });
    return unsubscribe;
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
    if (!currentUser) { setDiscoverVideos([]); return; }
    const discoverRef = ref(db, 'discoverVideos');
    return onValue(discoverRef, snapshot => {
      const data = snapshot.val();
      if (!data) { setDiscoverVideos([]); return; }
      const videoList = Array.isArray(data) ? data : Object.values(data);
      const uniqueVids = videoList.filter(vid => vid && vid.id).map(vid => {
        const mine = userVideosRef.current.find(v => String(v.id) === String(vid.id));
        return { ...vid, favorite: mine?.favorite === true };
      });
      setDiscoverVideos(uniqueVids);
      set(ref(db, 'topCreators'), calculateTopCreators(uniqueVids));
    }, error => {
      console.error('Firebase Discover fetch failed:', error);
      setDiscoverVideos([]);
    });
  }, [currentUser]);

  return { discoverVideos, discoverVideosRef, dbCategories, topCreators };
}
