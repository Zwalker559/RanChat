"use client";
import {useRouter} from 'next/navigation';
import {useEffect} from 'react';
import {useAuth} from '@/hooks/use-auth';
import {listenForPartner, updateUserStatus} from '@/lib/firebase/firestore';

const Spinner = () => (
  <div className="relative h-20 w-20">
    <div className="absolute h-full w-full rounded-full border-4 border-transparent border-t-accent animate-spin" />
    <div
      className="absolute h-full w-full rounded-full border-4 border-transparent border-t-primary animate-spin"
      style={{animationDelay: '-0.2s'}}
    />
    <div className="absolute h-full w-full rounded-full border-4 border-transparent border-b-accent/50" />
  </div>
);

export default function QueuePage() {
  const router = useRouter();
  const {user, appUser} = useAuth();

  useEffect(() => {
    if (!user || !appUser) return;
    
    updateUserStatus(user.uid, 'searching');

    // Listen for a partner
    const unsubscribe = listenForPartner(user.uid, (chatId, partnerUid) => {
      if (chatId && partnerUid) {
        unsubscribe();
        router.push(`/chat?chatId=${chatId}`);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [user, appUser, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <Spinner />
      <h1 className="text-2xl font-semibold text-muted-foreground animate-pulse">
        Searching for a partner...
      </h1>
      <button onClick={() => router.push('/chat')} className="text-muted-foreground underline">Cancel</button>
    </div>
  );
}
