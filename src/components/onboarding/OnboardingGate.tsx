'use client';

// ─── First-run gate ──────────────────────────────────────────────────
// Reads the profile doc once per sign-in and opens <OnboardingWizard /> only
// for a user who has never been through it.
//
// "Never been through it" = no `onboardedAt` AND no `goal`. The `goal` half is
// what keeps existing users out: their profile predates the wizard, so they
// have no stamp, but they do have a goal they set by hand. Note the profile
// doc alone proves nothing — exercise seeding (`seedVersion`) and a language
// switch both create it before any question is answered.
//
// A read failure resolves to "already onboarded": a transient Firestore error
// must never wall a returning user behind a setup dialog.

import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';

import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebaseConfig';
import { OnboardingWizard } from './OnboardingWizard';

export function OnboardingGate() {
  const { user } = useAuth();
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  const userId = user?.id;

  useEffect(() => {
    if (!userId) {
      setNeedsOnboarding(false);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, 'users', userId, 'profile', 'profile'))
      .then((snap) => {
        if (cancelled) return;
        const data = snap.data();
        setNeedsOnboarding(!data?.onboardedAt && !data?.goal);
      })
      .catch((error) => {
        console.error('[OnboardingGate] onboarding check failed:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!needsOnboarding) return null;

  return <OnboardingWizard open onFinished={() => setNeedsOnboarding(false)} />;
}
