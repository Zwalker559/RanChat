
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
  const matchFound = useRef(false);

  const handleCancel = useCallback(async () => {
    if (isCancelling.current) return;
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
    router.push('/');
  }, [user, auth, router, toast]);

  useEffect(() => {
    if (!user || !appUser) {
        if (!auth?.currentUser && !user) {
            router.push('/');
        }
        return;
    };
    
    matchFound.current = false;
    isCancelling.current = false;
    
    // Attempt to find a partner immediately on entering the queue
    findPartner(user.uid, appUser).then(match => {
        if (match && !matchFound.current) {
            matchFound.current = true;
            router.push(`/chat?chatId=${match.chatId}&partnerUid=${match.partnerUid}&caller=true`);
        }
    });

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
          const latestUser = await getUser(user.uid);
          // Only update if they are still 'searching', to avoid race conditions
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
      <Button onClick={handleCancel} variant="link" className="text-muted-foreground">Cancel and Exit</Button>
    </div>
  );
}
