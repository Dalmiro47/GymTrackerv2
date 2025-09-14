'use client';
import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import type { UserProfile } from '@/lib/types.gym';
import { Loader2, Settings } from 'lucide-react';
import { CoachProfileForm } from '@/components/coach/CoachProfileForm';

export default function SettingsProfilePage() {
  const { user, isLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoadingProfile(true);
      const snap = await getDoc(doc(db, 'users', user.id, 'profile', 'profile'));
      setProfile((snap.data() as UserProfile) ?? { goal: 'General Fitness' });
      setLoadingProfile(false);
    })();
  }, [user]);

  if (isLoading || loadingProfile || !profile) {
    return (
      <div className="container mx-auto py-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading profile…
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 py-6">
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Settings className="h-5 w-5" /> Profile Settings
      </h1>
      <CoachProfileForm initial={profile} />
    </div>
  );
}
