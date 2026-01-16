
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
import { createOffer, listenForOffer, createAnswer, listenForAnswer, addIceCandidate, listenForIceCandidates, endChat, updateUserStatus, deleteUser as deleteFirestoreUser, updateUser, addUserToQueue } from '@/lib/firebase/firestore';
import { Unsubscribe, onSnapshot, doc } from 'firebase/firestore';
import { firestore } from '@/lib/firebase/config';
import { deleteUser as deleteAuthUser } from 'firebase/auth';
import type { User as AppUser } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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

  // --- State Management ---
  const [isConnecting, setIsConnecting] = useState(true);
  const [isLocalVideoMinimized, setIsLocalVideoMinimized] = useState(false);
  const [partner, setPartner] = useState<AppUser | null>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState(true);
  const [hasMicPermission, setHasMicPermission] = useState(true);

  // Initialize cam/mic state from localStorage to persist user preference
  const [isMicOn, setIsMicOn] = useState(() => {
    if (typeof window === 'undefined') return true;
    const saved = localStorage.getItem('ran-chat-mic-on');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [isCamOn, setIsCamOn] = useState(() => {
    if (typeof window === 'undefined') return true;
    const saved = localStorage.getItem('ran-chat-cam-on');
    return saved !== null ? JSON.parse(saved) : true;
  });
  
  // --- Refs for stable objects across renders ---
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const isUnloading = useRef(false);

  // This is the main setup and teardown effect. It's designed to run ONCE per chat session.
  useEffect(() => {
    if (!user) return; // Wait for authentication to complete

    // Get stable chat parameters from the URL
    const urlChatId = searchParams.get('chatId');
    const urlPartnerUid = searchParams.get('partnerUid');
    const isCaller = searchParams.get('caller') === 'true';

    if (!urlChatId || !urlPartnerUid) {
      router.push('/queue');
      return;
    }

    let isCancelled = false;
    const unsubscribers: Unsubscribe[] = [];

    const setupChat = async () => {
      setIsConnecting(true);

      // 1. Get User Media
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (isCancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        
        // Sync media tracks with the initial state
        stream.getVideoTracks().forEach(t => t.enabled = isCamOn);
        stream.getAudioTracks().forEach(t => t.enabled = isMicOn);

        setHasCameraPermission(true);
        setHasMicPermission(true);
      } catch (error) {
        console.error("Error accessing media devices:", error);
        setHasCameraPermission(false);
        setHasMicPermission(false);
        setIsCamOn(false);
        setIsMicOn(false);
      }
      
      // 2. Initialize WebRTC
      pc.current = new RTCPeerConnection(servers);
      remoteStreamRef.current = new MediaStream();
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStreamRef.current;

      // Add local tracks to the connection BEFORE creating the offer
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc.current!.addTrack(track, localStreamRef.current!);
        });
      }

      // 3. Setup WebRTC event handlers
      pc.current.ontrack = (event) => {
        event.streams[0].getTracks().forEach(track => {
          remoteStreamRef.current?.addTrack(track);
        });
      };
      
      pc.current.onicecandidate = event => {
        if (event.candidate) {
          addIceCandidate(urlChatId, user.uid, event.candidate.toJSON());
        }
      };

      // 4. Setup Firestore Listeners
      unsubscribers.push(
        onSnapshot(doc(firestore, 'users', urlPartnerUid), (docSnap) => {
          if (docSnap.exists()) setPartner(docSnap.data() as AppUser);
          else setPartner(null);
        })
      );
      
      unsubscribers.push(
        listenForIceCandidates(urlChatId, urlPartnerUid, (candidate) => {
          if (pc.current?.remoteDescription || isCaller) {
            pc.current?.addIceCandidate(new RTCIceCandidate(candidate));
          }
        })
      );
      
      unsubscribers.push(
        onSnapshot(doc(firestore, 'chats', urlChatId), (docSnap) => {
          if (!docSnap.exists() && !isUnloading.current) {
             toast({ title: "Partner has disconnected", description: "Finding a new partner..." });
             router.push('/queue');
          }
        })
      );

      // 5. Signaling Logic (Offer/Answer Handshake)
      if (isCaller) {
        unsubscribers.push(listenForAnswer(urlChatId, urlPartnerUid, async (answer) => {
            if (pc.current && !pc.current.currentRemoteDescription) {
                await pc.current.setRemoteDescription(new RTCSessionDescription(answer));
            }
        }));
        const offer = await pc.current.createOffer();
        await pc.current.setLocalDescription(offer);
        await createOffer(urlChatId, user.uid, { type: offer.type, sdp: offer.sdp });
      } else { // Callee
        unsubscribers.push(listenForOffer(urlChatId, urlPartnerUid, async (offer) => {
            if (pc.current && !pc.current.remoteDescription) {
                await pc.current.setRemoteDescription(new RTCSessionDescription(offer));
                const answer = await pc.current.createAnswer();
                await pc.current.setLocalDescription(answer);
                await createAnswer(urlChatId, user.uid, { type: answer.type, sdp: answer.sdp });
            }
        }));
      }

      // 6. Update own status in Firestore with initial media state
      await updateUser(user.uid, { isCamOn, isMicOn });

      setIsConnecting(false);
    };

    setupChat();
    
    // The single, robust cleanup function for when the component unmounts or chat ends
    return () => {
      isCancelled = true;
      console.log("Cleaning up chat session...");
      
      unsubscribers.forEach(unsub => unsub());

      if (pc.current) {
        // Detach event handlers
        pc.current.ontrack = null;
        pc.current.onicecandidate = null;
        pc.current.onconnectionstatechange = null;
        pc.current.oniceconnectionstatechange = null;

        // Stop all senders and close the connection
        pc.current.getSenders().forEach(sender => {
          try { pc.current?.removeTrack(sender); } catch (e) { console.error("Error removing track", e)}
        });
        pc.current.close();
        pc.current = null;
      }

      // Stop all media tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      if (remoteStreamRef.current) {
        remoteStreamRef.current.getTracks().forEach(track => track.stop());
        remoteStreamRef.current = null;
      }
      
      // Clean up video elements
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

      // Clean up Firestore chat document if we are not navigating away due to page unload
      if (!isUnloading.current && urlChatId) {
          endChat(urlChatId);
      }
    };
  // This dependency array is critical. It ensures the setup logic runs only ONCE when the user is authenticated.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // --- User Actions ---
  const handleToggleMic = useCallback(() => {
    if (!hasMicPermission) return;
    const newMicState = !isMicOn;
    setIsMicOn(newMicState);
    localStreamRef.current?.getAudioTracks().forEach(t => t.enabled = newMicState);
    if (user) {
        updateUser(user.uid, { isMicOn: newMicState });
        localStorage.setItem('ran-chat-mic-on', JSON.stringify(newMicState));
    }
  }, [isMicOn, hasMicPermission, user]);

  const handleToggleCam = useCallback(() => {
    if (!hasCameraPermission) return;
    const newCamState = !isCamOn;
    setIsCamOn(newCamState);
    localStreamRef.current?.getVideoTracks().forEach(t => t.enabled = newCamState);
    if (user) {
        updateUser(user.uid, { isCamOn: newCamState });
        localStorage.setItem('ran-chat-cam-on', JSON.stringify(newCamState));
    }
  }, [isCamOn, hasCameraPermission, user]);

  const handleNext = useCallback(async () => {
    isUnloading.current = true; // prevent cleanup from running endChat again
    const chatId = searchParams.get('chatId');

    // First, end the current chat
    if (chatId) {
      await endChat(chatId);
    }

    // Then, put self back into the queue
    if (user && appUser) {
      await updateUserStatus(user.uid, 'searching');
      // We need to omit fields that are not part of the queue data
      const { uid, createdAt, ...queueData } = appUser;
      await addUserToQueue(user.uid, { ...queueData, status: 'searching' });
    }

    // Finally, navigate to the queue page
    router.push('/queue');
  }, [searchParams, user, appUser, router]);
  
  const fullUserDelete = useCallback(async () => {
    if (user && auth?.currentUser) {
        isUnloading.current = true;
        const chatId = searchParams.get('chatId');
        if (chatId) await endChat(chatId);
        
        try {
            await deleteFirestoreUser(user.uid);
            await deleteAuthUser(auth.currentUser);
            console.log("Anonymous user account and data deleted successfully.");
        } catch (error) {
            console.error("Error deleting anonymous user:", error);
        }
    }
  }, [user, auth, searchParams]);

  const handleStop = async () => {
    await fullUserDelete();
    router.push("/");
  };
  
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Don't run the full delete if we are intentionally navigating away
      // or a match was found, as other cleanup logic will handle it.
      if (isUnloading.current) return;
      
      const chatId = searchParams.get('chatId');
      if (chatId) endChat(chatId);
      if (user) updateUserStatus(user.uid, 'offline');
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, searchParams]);


  return (
    <main className="grid h-screen max-h-screen grid-cols-1 lg:grid-cols-[1fr_400px] overflow-hidden">
      <div className="relative flex flex-col items-center justify-between p-4 bg-black/90 h-full">
        {(!hasCameraPermission || !hasMicPermission) && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Permissions Denied</AlertTitle>
              <AlertDescription>
                { !hasCameraPermission && 'Camera access has been denied. ' }
                { !hasMicPermission && 'Microphone access has been denied. ' }
                 Please grant permissions in your browser settings to share your video and audio. You can still watch your partner's stream.
              </AlertDescription>
            </Alert>
        )}
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
        {user ? (
          <ChatWindow chatId={searchParams.get('chatId')!} currentUserUid={user.uid} />
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
