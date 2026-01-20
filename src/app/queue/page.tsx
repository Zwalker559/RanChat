
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
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    
    if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
    }
    
    if (user) await updateUserStatus(user.uid, 'offline');
    // No need to call fullUserDelete, user can sign back in later.
    // Let's just take them home.
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
        // If auth is still loading, or user genuinely doesn't exist, wait or redirect.
        if (!auth?.currentUser && !user && !auth.loading) {
            router.push('/');
        }
        return;
    };
    
    matchFound.current = false;
    isCancelling.current = false;
    
    const enterQueueAndSearch = async () => {
      // Ensure user document exists and status is 'searching'
      await updateUserStatus(user.uid, 'searching');
      const { uid, createdAt, ...queueData } = appUser;
      await addUserToQueue(user.uid, { ...queueData, status: 'searching' });
      
      // Wait 5 seconds before trying to find a match.
      searchTimeoutRef.current = setTimeout(async () => {
        // If we were found by someone else while waiting, don't initiate a search.
        if (matchFound.current) return;

        const match = await findPartner(user.uid, appUser);
        if (match && !matchFound.current) {
            matchFound.current = true;
            router.push(`/chat?chatId=${match.chatId}&partnerUid=${match.partnerUid}&caller=true`);
        }
      }, 5000);
    };

    // This listener handles the case where we are chosen by someone else
    const unsubscribePartnerListener = listenForPartner(user.uid, (chatId, partnerUid) => {
        if (chatId && partnerUid && !matchFound.current) {
            matchFound.current = true;
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
            router.push(`/chat?chatId=${chatId}&partnerUid=${partnerUid}&caller=false`);
        }
    });

    // Start the search process
    enterQueueAndSearch();

    return () => {
      unsubscribePartnerListener();
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      
      // If we navigate away without finding a match (e.g. back button), go offline.
      if (!matchFound.current && user && !isCancelling.current) {
        updateUserStatus(user.uid, 'offline');
      }
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
