"use client";
import {useRouter} from 'next/navigation';
import {useEffect} from 'react';
import {useAuth} from '@/hooks/use-auth';
import {listenForPartner, updateUserStatus, deleteUser as deleteFirestoreUser, findPartner } from '@/lib/firebase/firestore';
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
  const {user, appUser, auth} = useAuth();

  useEffect(() => {
    if (!user || !appUser) {
        if (!user) router.push('/');
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

    return () => {
      unsubscribe();
    };
  }, [user, appUser, router]);

  const handleCancel = async () => {
    if (user && auth?.currentUser) {
        try {
            await deleteFirestoreUser(user.uid);
            await deleteAuthUser(auth.currentUser);
            console.log("Anonymous user and data deleted successfully.");
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
