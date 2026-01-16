
"use client";
import {useRouter} from 'next/navigation';
import {useEffect, useCallback, useRef} from 'react';
import {useAuth} from '@/hooks/use-auth';
import {listenForPartner, updateUserStatus, deleteUser as deleteFirestoreUser, findPartner, getUser, addUserToQueue } from '@/lib/firebase/firestore';
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
    
    // Set status to offline before deleting to prevent being found in queue
    if (user) await updateUserStatus(user.uid, 'offline');
    await fullUserDelete();

    toast({ title: "Search Cancelled", description: "Your anonymous account has been deleted." });
    router.push('/');
  }, [fullUserDelete, router, toast, user]);

  useEffect(() => {
    const handleBeforeUnload = async (e: BeforeUnloadEvent) => {
      if (isCancelling.current || matchFound.current) return;
      if (user) {
        // This is a "best-effort" fire-and-forget attempt to clean up on browser close.
        // We set to offline, which also removes from queue.
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
        if (!auth?.currentUser && !user) {
            router.push('/');
        }
        return;
    };
    
    matchFound.current = false;
    isCancelling.current = false;
    
    const enterQueueAndSearch = async () => {
      // Ensure user status is 'searching' and they are in the queue collection
      await updateUserStatus(user.uid, 'searching');
      const { uid, createdAt, ...queueData } = appUser;
      await addUserToQueue(user.uid, { ...queueData, status: 'searching' });
      
      // Attempt to find a partner immediately
      const match = await findPartner(user.uid, appUser);
      if (match && !matchFound.current) {
          matchFound.current = true;
          router.push(`/chat?chatId=${match.chatId}&partnerUid=${match.partnerUid}&caller=true`);
      }
    };

    enterQueueAndSearch();

    const unsubscribePartnerListener = listenForPartner(user.uid, (chatId, partnerUid) => {
        if (chatId && partnerUid && !matchFound.current) {
            matchFound.current = true;
            router.push(`/chat?chatId=${chatId}&partnerUid=${partnerUid}&caller=false`);
        }
    });

    return () => {
      unsubscribePartnerListener();
      
      // If we navigate away without finding a match (e.g. cancel button), set status to online
      if (!matchFound.current && user && !isCancelling.current) {
        const checkStatusAndSetOnline = async () => {
          const latestUserDoc = await getDoc(doc(firestore, 'users', user.uid));
          if(latestUserDoc.exists()) {
            const latestUser = latestUserDoc.data() as User;
            // Only update if they are still 'searching', to avoid race conditions
            if (latestUser && latestUser.status === 'searching') {
              await updateUserStatus(user.uid, 'online');
            }
          }
        };
        checkStatusAndSetOnline();
      }
    };
  }, [user, appUser, router, auth]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <Spinner />
      <h1 className="text-2xl font-semibold text-muted-foreground animate-pulse">
        Searching for a partner...
      </h1>
      <Button onClick={handleCancel} variant="link" className="text-muted-foreground">Cancel and Exit</Button>
    </div>
  );
}
