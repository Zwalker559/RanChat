
"use client";
import {useRouter} from 'next/navigation';
import {useEffect, useCallback, useRef} from 'react';
import {useAuth} from '@/hooks/use-auth';
import {listenForPartner, updateUserStatus, deleteUser as deleteFirestoreUser, findPartner, addUserToQueue } from '@/lib/firebase/firestore';
import { deleteUser as deleteAuthUser } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '@/lib/firebase/config';
import type { User } from '@/lib/types';


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
  const {user, appUser, auth} = useAuth();
  const { toast } = useToast();
  const isCancelling = useRef(false);
  const matchFound = useRef(false);

  const fullUserDelete = useCallback(async () => {
    if (user && auth?.currentUser) {
        try {
            await deleteFirestoreUser(user.uid);
            await deleteAuthUser(auth.currentUser);
            console.log("Anonymous user account and data deleted successfully.");
        } catch (error) {
            console.error("Error deleting anonymous user:", error);
        }
    }
  }, [user, auth]);

  const handleCancel = useCallback(async () => {
    if (isCancelling.current) return;
    isCancelling.current = true;
    
    if (user) await updateUserStatus(user.uid, 'offline');
    toast({ title: "Search Cancelled", description: "You have left the queue." });
    router.push('/');
  }, [router, toast, user]);

  useEffect(() => {
    const handleBeforeUnload = async (e: BeforeUnloadEvent) => {
      if (isCancelling.current || matchFound.current) return;
      if (user) {
        updateUserStatus(user.uid, 'offline');
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user]);

  useEffect(() => {
    if (!user || !appUser) {
        if (!auth?.currentUser && !user && !auth.loading) {
            router.push('/');
        }
        return;
    };
    
    matchFound.current = false;
    isCancelling.current = false;
    
    const enterQueueAndSearch = async () => {
      await updateUserStatus(user.uid, 'searching');
      const { uid, createdAt, ...queueData } = appUser;
      await addUserToQueue(user.uid, { ...queueData, status: 'searching' });
      
      if (matchFound.current) return;

      const match = await findPartner(user.uid, appUser);
      if (match && !matchFound.current) {
          matchFound.current = true;
          router.push(`/chat?chatId=${match.chatId}&partnerUid=${match.partnerUid}&caller=true`);
      }
    };

    const unsubscribePartnerListener = listenForPartner(user.uid, (chatId, partnerUid) => {
        if (chatId && partnerUid && !matchFound.current) {
            matchFound.current = true;
            router.push(`/chat?chatId=${chatId}&partnerUid=${partnerUid}&caller=false`);
        }
    });

    enterQueueAndSearch();

    return () => {
      unsubscribePartnerListener();
    };
  }, [user, appUser, router, auth]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <Spinner />
      <h1 className="text-2xl font-semibold text-muted-foreground animate-pulse">
        Searching for a partner...
      </h1>
      <Button onClick={handleCancel} variant="link" className="text-muted-foreground">Cancel and go home</Button>
    </div>
  );
}
