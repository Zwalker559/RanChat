"use client";
import {useRouter} from 'next/navigation';
import {useEffect} from 'react';
import {useAuth} from '@/hooks/use-auth';
import {listenForPartner, updateUserStatus, deleteUser as deleteFirestoreUser } from '@/lib/firebase/firestore';
import { deleteUser as deleteAuthUser } from 'firebase/auth';
import { Button } from '@/components/ui/button';

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

  const handleCancel = async () => {
    if (user) {
        try {
            // First remove user from queue so they don't get matched
            await deleteFirestoreUser(user.uid);
            await deleteAuthUser(user);
        } catch (error) {
            console.error("Error deleting user during cancel:", error);
        }
    }
    router.push('/');
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <Spinner />
      <h1 className="text-2xl font-semibold text-muted-foreground animate-pulse">
        Searching for a partner...
      </h1>
      <Button onClick={handleCancel} variant="link" className="text-muted-foreground">Cancel</Button>
    </div>
  );
}
