"use client";
import {useRouter} from 'next/navigation';
import {useEffect, useCallback, useRef} from 'react';
import {useAuth} from '@/hooks/use-auth';
import {listenForPartner, updateUserStatus, deleteUser as deleteFirestoreUser, findPartner, getUser } from '@/lib/firebase/firestore';
import { deleteUser as deleteAuthUser } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

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

  const handleCancel = useCallback(async () => {
    isCancelling.current = true;
    if (user && auth?.currentUser) {
        try {
            await deleteFirestoreUser(user.uid);
            await deleteAuthUser(auth.currentUser);
            toast({ title: "Account Deleted", description: "Your anonymous account has been successfully deleted." });
        } catch (error) {
            console.error("Error deleting user during cancel:", error);
            toast({ variant: "destructive", title: "Error", description: "Could not delete your account." });
        }
    }
    // Regardless of user state, always redirect to home on cancel.
    router.push('/');
  }, [user, auth, router, toast]);

  useEffect(() => {
    if (!user || !appUser) {
        // If auth is still loading, wait. If it's done and there's no user, go home.
        if (!auth?.currentUser && !user) {
            router.push('/');
        }
        return;
    };
    
    // Set status to searching right away
    updateUserStatus(user.uid, 'searching');
    
    const searchForPartner = async () => {
      const match = await findPartner(user.uid, appUser.preferences);
      if (match) {
        // If a match is found by this client, they are the "caller"
        router.push(`/chat?chatId=${match.chatId}&partnerUid=${match.partnerUid}&caller=true`);
      }
    }

    // Attempt to find a partner immediately
    searchForPartner();

    // Also listen in case another user finds us
    const unsubscribePartnerListener = listenForPartner(user.uid, (chatId, partnerUid) => {
        if (chatId && partnerUid) {
            // If we are found by another client, we are the "callee"
            router.push(`/chat?chatId=${chatId}&partnerUid=${partnerUid}&caller=false`);
        }
    });

    return () => {
      unsubscribePartnerListener();
      
      // This cleanup logic runs when the component unmounts.
      // We check `isCancelling` to see if unmount is due to cancellation.
      // If not cancelling, it means the user might be navigating away (e.g. back button)
      // while still in the queue.
      if (!isCancelling.current && user) {
        const checkStatusAndSetOnline = async () => {
          const latestUser = await getUser(user.uid);
          // Only set back to online if they are still 'searching'. 
          // If they found a match, their status will be 'in-chat' and we shouldn't touch it.
          if (latestUser && latestUser.status === 'searching') {
            await updateUserStatus(user.uid, 'online');
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
      <Button onClick={handleCancel} variant="link" className="text-muted-foreground">Cancel</Button>
    </div>
  );
}
