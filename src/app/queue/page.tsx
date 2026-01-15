"use client";
import {useRouter} from 'next/navigation';
import {useEffect, useCallback} from 'react';
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

  const handleCancel = useCallback(async () => {
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
    
    updateUserStatus(user.uid, 'searching');
    
    // Attempt to find a partner immediately
    findPartner(user.uid, appUser.preferences).then(match => {
        if (match) {
            router.push(`/chat?chatId=${match.chatId}&partnerUid=${match.partnerUid}&caller=true`);
        }
    });

    const unsubscribe = listenForPartner(user.uid, (chatId, partnerUid) => {
        unsubscribe(); 
        if (chatId && partnerUid) {
            router.push(`/chat?chatId=${chatId}&partnerUid=${partnerUid}&caller=false`);
        }
    });

    // Cleanup when the user navigates away from this page
    return () => {
      unsubscribe();
      // If user is still in searching state and navigates away (but doesn't cancel),
      // update their status so they are not stuck in the queue.
      // We check for user existence because this can run during unmount after cancellation.
      if (user) {
        // Use getDoc to check current status before overriding
        // This avoids race conditions where a user gets a match then navigates away
        const checkStatusAndSetOnline = async () => {
          const latestUser = await getUser(user.uid);
          if (latestUser && latestUser.status === 'searching') {
            updateUserStatus(user.uid, 'online');
          }
        }
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
