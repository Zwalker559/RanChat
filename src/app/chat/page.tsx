
"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { VideoPlayer } from '@/components/chat/video-player';
import { ChatWindow } from '@/components/chat/chat-window';
import { ChatControls } from '@/components/chat/chat-controls';
import { Button } from '@/components/ui/button';
import { Maximize, Minimize } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createOffer, listenForOffer, createAnswer, listenForAnswer, addIceCandidate, listenForIceCandidates, endChat, updateUserStatus, deleteUser as deleteFirestoreUser, updateUser } from '@/lib/firebase/firestore';
import { Unsubscribe, onSnapshot, doc } from 'firebase/firestore';
import { firestore } from '@/lib/firebase/config';
import { deleteUser as deleteAuthUser } from 'firebase/auth';
import type { User as AppUser } from '@/lib/types';

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

function ChatPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { user, appUser, auth } = useAuth();

  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [isConnecting, setIsConnecting] = useState(true);
  const [isLocalVideoMinimized, setIsLocalVideoMinimized] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [partner, setPartner] = useState<AppUser | null>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState(true);
  const [hasMicPermission, setHasMicPermission] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // Refs for core WebRTC and state objects
  const pc = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const isUnloading = useRef(false);

  useEffect(() => {
    if (appUser) {
        const cam = appUser.isCamOn;
        const mic = appUser.isMicOn;
        setIsCamOn(cam);
        setIsMicOn(mic);
        localStorage.setItem('ran-chat-cam-on', JSON.stringify(cam));
        localStorage.setItem('ran-chat-mic-on', JSON.stringify(mic));
    }
  }, [appUser]);

  // This is the main setup and teardown effect for the entire chat session.
  useEffect(() => {
    if (!user || !appUser) {
        if(!user && !auth?.currentUser) router.push('/');
        return;
    }

    const urlChatId = searchParams.get('chatId');
    const urlPartnerUid = searchParams.get('partnerUid');
    const isCaller = searchParams.get('caller') === 'true';

    if (!urlChatId || !urlPartnerUid) {
        router.push('/queue');
        return;
    }

    setChatId(urlChatId);
    isUnloading.current = false;
    let isCancelled = false;
    const localUnsubscribers: Unsubscribe[] = [];

    // The single, consolidated cleanup function
    const cleanup = () => {
        if (isCancelled) return;
        console.log("Cleaning up chat session...");
        isCancelled = true;
        isUnloading.current = true;

        localUnsubscribers.forEach(unsub => unsub());
        localUnsubscribers.length = 0;

        if (pc.current) {
            pc.current.ontrack = null;
            pc.current.onicecandidate = null;
            pc.current.onconnectionstatechange = null;
            pc.current.oniceconnectionstatechange = null;
            pc.current.getSenders().forEach(sender => {
              try {
                pc.current?.removeTrack(sender);
              } catch(e) {
                console.error("error removing track", e);
              }
            });
            pc.current.close();
            pc.current = null;
        }

        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
        }

        if (localVideoRef.current) localVideoRef.current.srcObject = null;
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
        
        setPartner(null);
        isUnloading.current = false;
    };
    
    const initializeChat = async () => {
        setIsConnecting(true);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            if (isCancelled) { stream.getTracks().forEach(t => t.stop()); return; }
            localStreamRef.current = stream;
            setHasCameraPermission(true);
            setHasMicPermission(true);

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }
            
            // Apply initial media state
            const initialCamOn = JSON.parse(localStorage.getItem('ran-chat-cam-on') ?? 'true');
            const initialMicOn = JSON.parse(localStorage.getItem('ran-chat-mic-on') ?? 'true');
            stream.getVideoTracks().forEach(t => t.enabled = initialCamOn);
            stream.getAudioTracks().forEach(t => t.enabled = initialMicOn);
            setIsCamOn(initialCamOn);
            setIsMicOn(initialMicOn);
            await updateUser(user.uid, { isCamOn: initialCamOn, isMicOn: initialMicOn });
            
        } catch (error) {
            console.error("Error accessing media devices:", error);
            setHasCameraPermission(false);
            setHasMicPermission(false);
            setIsCamOn(false);
            setIsMicOn(false);
             await updateUser(user.uid, { isCamOn: false, isMicOn: false });
        }
        
        if (isCancelled) return;

        const peerConnection = new RTCPeerConnection(servers);
        pc.current = peerConnection;

        // Add tracks from local stream to peer connection
        if (localStreamRef.current) {
            for (const track of localStreamRef.current.getTracks()) {
                peerConnection.addTrack(track, localStreamRef.current);
            }
        }
        
        // Setup Peer Connection event handlers
        peerConnection.oniceconnectionstatechange = () => console.log(`ICE Connection State: ${peerConnection.iceConnectionState}`);
        peerConnection.onconnectionstatechange = () => console.log(`Connection State: ${peerConnection.connectionState}`);
        
        peerConnection.ontrack = (event) => {
            if (remoteVideoRef.current && event.streams[0]) {
                remoteVideoRef.current.srcObject = event.streams[0];
            }
        };

        peerConnection.onicecandidate = (event) => {
            event.candidate && addIceCandidate(urlChatId, user.uid, event.candidate.toJSON());
        };

        // Setup Firestore listeners
        localUnsubscribers.push(onSnapshot(doc(firestore, 'users', urlPartnerUid), (docSnap) => {
            if (isCancelled) return;
            if (docSnap.exists()) {
                setPartner(docSnap.data() as AppUser);
            } else {
                setPartner(null);
            }
        }));

        localUnsubscribers.push(listenForIceCandidates(urlChatId, urlPartnerUid, (candidate) => {
            if (isCancelled || !pc.current) return;
            pc.current.addIceCandidate(new RTCIceCandidate(candidate));
        }));
        
        localUnsubscribers.push(onSnapshot(doc(firestore, 'chats', urlChatId), async (docSnap) => {
            if (isCancelled) return;
            if (!docSnap.exists() && !isUnloading.current) {
                toast({ title: "Partner has disconnected", description: "Finding a new partner..." });
                await endChat(urlChatId);
                router.push('/queue');
            }
        }));

        // Signaling logic
        if (isCaller) {
            localUnsubscribers.push(listenForAnswer(urlChatId, urlPartnerUid, async (answer) => {
                if (isCancelled || !pc.current || pc.current.currentRemoteDescription) return;
                await pc.current.setRemoteDescription(new RTCSessionDescription(answer));
            }));

            const offerDescription = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offerDescription);
            await createOffer(urlChatId, user.uid, { type: offerDescription.type, sdp: offerDescription.sdp });
        } else {
            localUnsubscribers.push(listenForOffer(urlChatId, urlPartnerUid, async (offer) => {
                if (isCancelled || !pc.current || pc.current.remoteDescription) return;
                await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
                const answerDescription = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answerDescription);
                await createAnswer(urlChatId, user.uid, { type: answerDescription.type, sdp: answerDescription.sdp });
            }));
        }

        setIsConnecting(false);
    };

    initializeChat();

    // Main cleanup function on component unmount
    return () => {
        cleanup();
        if (chatId && !isUnloading.current) {
            endChat(chatId).then(() => {
                if (user) updateUserStatus(user.uid, 'online');
            });
        }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, appUser]);
  
  const handleToggleMic = () => {
    if (!hasMicPermission) return;
    const newMicState = !isMicOn;
    setIsMicOn(newMicState);
    if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(t => t.enabled = newMicState);
    }
    if (user) {
        updateUser(user.uid, { isMicOn: newMicState });
        localStorage.setItem('ran-chat-mic-on', JSON.stringify(newMicState));
    }
  }

  const handleToggleCam = () => {
    if (!hasCameraPermission) return;
    const newCamState = !isCamOn;
    setIsCamOn(newCamState);
     if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach(t => t.enabled = newCamState);
    }
    if (user) {
        updateUser(user.uid, { isCamOn: newCamState });
        localStorage.setItem('ran-chat-cam-on', JSON.stringify(newCamState));
    }
  }

  const handleNext = useCallback(async () => {
    isUnloading.current = true;
    if (chatId) {
      await endChat(chatId);
    }
    if(user) {
      await updateUserStatus(user.uid, 'searching');
    }
    router.push('/queue');
  }, [chatId, user, router]);

  const fullUserDelete = useCallback(async () => {
    if (user && auth?.currentUser) {
        isUnloading.current = true;
        if (chatId) {
           await endChat(chatId);
        }
        try {
            await deleteFirestoreUser(user.uid);
            await deleteAuthUser(auth.currentUser);
            console.log("Anonymous user account and data deleted successfully.");
        } catch (error) {
            console.error("Error deleting anonymous user:", error);
            toast({
                variant: "destructive",
                title: "Cleanup Error",
                description: "Could not fully delete user account."
            });
        }
    }
  }, [user, auth, toast, chatId]);

  const handleStop = async () => {
    await fullUserDelete();
    router.push("/");
  };
  
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isUnloading.current) return;
      // This is a fire-and-forget operation on closing the tab
      fullUserDelete();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [fullUserDelete]);


  return (
    <main className="grid h-screen max-h-screen grid-cols-1 lg:grid-cols-[1fr_400px] overflow-hidden">
      <div className="relative flex flex-col items-center justify-between p-4 bg-black/90 h-full">
        <div className={cn(
          "grid w-full flex-1 gap-4 transition-all duration-300",
          isLocalVideoMinimized ? "grid-rows-1" : "grid-rows-[1fr_auto] md:grid-rows-1 md:grid-cols-[1fr_300px]"
        )}>
          <div className="relative group/videoplayer w-full h-full min-h-0">
            <VideoPlayer
                name={partner?.username || 'Stranger'}
                isMuted={!partner?.isMicOn}
                isCamOff={!partner?.isCamOn}
                isConnecting={isConnecting || !partner}
                className="h-full"
            >
              <video ref={remoteVideoRef} className={cn("w-full h-full object-cover", !partner?.isCamOn && 'invisible')} autoPlay playsInline />
            </VideoPlayer>
          </div>
          
          <div className={cn(
              "relative group/videoplayer w-full min-h-0 transition-all duration-300",
              isLocalVideoMinimized ? "h-10" : "h-full"
            )}>
              <div className="relative w-full h-full">
                <VideoPlayer
                  name={appUser?.username || "You"}
                  isMuted={!isMicOn}
                  isCamOff={!isCamOn || !hasCameraPermission}
                  className="h-full"
                >
                  <video ref={localVideoRef} className={cn("w-full h-full object-cover", !isCamOn && 'invisible')} autoPlay muted playsInline />
                </VideoPlayer>
                <Button 
                    size="icon" 
                    variant="ghost" 
                    className="absolute top-1 right-1 z-30 h-6 w-6 rounded-full bg-black/30 text-white hover:bg-black/50 opacity-0 group-hover/videoplayer:opacity-100 transition-opacity"
                    onClick={() => setIsLocalVideoMinimized(prev => !prev)}
                  >
                    {isLocalVideoMinimized ? <Maximize size={14} /> : <Minimize size={14} />}
                    <span className="sr-only">{isLocalVideoMinimized ? 'Maximize' : 'Minimize'} video</span>
                  </Button>
              </div>
          </div>
        </div>

        <div className="w-full max-w-md pt-4">
          <ChatControls
            isMicOn={isMicOn}
            isCamOn={isCamOn}
            hasMicPermission={hasMicPermission}
            hasCameraPermission={hasCameraPermission}
            isConnecting={isConnecting}
            onToggleMic={handleToggleMic}
            onToggleCam={handleToggleCam}
            onNext={handleNext}
            onStop={handleStop}
          />
        </div>
      </div>
      <div className="w-full lg:max-w-[400px] flex flex-col bg-card/50 backdrop-blur-sm border-l border-border h-full">
        {chatId && user ? (
          <ChatWindow chatId={chatId} currentUserUid={user.uid} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <p>Waiting for chat to start...</p>
          </div>
        )}
      </div>
    </main>
  );
}


export default function ChatPage() {
    return (
        <Suspense fallback={<div className="flex h-screen w-full items-center justify-center bg-background"><p className="text-muted-foreground">Loading Chat...</p></div>}>
            <ChatPageContent />
        </Suspense>
    )
}
