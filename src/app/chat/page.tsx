
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

  // Get stable chat parameters from the URL
  const chatId = searchParams.get('chatId');
  const partnerUid = searchParams.get('partnerUid');
  const isCaller = searchParams.get('caller') === 'true';

  // This is the main setup and teardown effect. It's designed to run ONCE per chat session.
  useEffect(() => {
    // Guard against running without essential info
    if (!user || !chatId || !partnerUid) {
      return;
    }

    let isCancelled = false;
    const unsubscribers: Unsubscribe[] = [];
    
    const setupChat = async () => {
      setIsConnecting(true);
      isUnloading.current = false;

      // 1. Initialize WebRTC
      pc.current = new RTCPeerConnection(servers);

      // 2. Initialize remote stream and attach to video element immediately
      // This prevents a race condition where the track arrives before the element is ready.
      remoteStreamRef.current = new MediaStream();
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }
      
      // 3. Get User Media and setup local stream
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (isCancelled) { 
          stream.getTracks().forEach(t => t.stop()); 
          return; 
        }
        
        localStreamRef.current = stream;

        // Attach local stream to video element
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        
        // Sync media tracks with the initial state from component state
        stream.getVideoTracks().forEach(t => t.enabled = isCamOn);
        stream.getAudioTracks().forEach(t => t.enabled = isMicOn);

        // Add local tracks to the connection BEFORE creating the offer
        stream.getTracks().forEach(track => {
          pc.current!.addTrack(track, stream);
        });

        setHasCameraPermission(true);
        setHasMicPermission(true);
      } catch (error) {
        console.error("Error accessing media devices:", error);
        // Only set permissions to false, don't toast, show UI instead.
        setHasCameraPermission(false);
        setHasMicPermission(false);
        // We can continue without local media, the user can still watch.
      }
      
      // 4. Setup WebRTC event handlers
      pc.current.ontrack = (event) => {
        event.streams[0].getTracks().forEach(track => {
          remoteStreamRef.current?.addTrack(track);
        });
        if (remoteVideoRef.current) {
          remoteVideoRef.current.muted = false;
        }
      };
      
      pc.current.onicecandidate = event => {
        if (event.candidate) {
          addIceCandidate(chatId, user.uid, event.candidate.toJSON());
        }
      };

      // 5. Setup Firestore Listeners
      // Listen for partner's metadata (name, cam/mic status)
      unsubscribers.push(
        onSnapshot(doc(firestore, 'users', partnerUid), (docSnap) => {
          if (docSnap.exists()) {
            setPartner(docSnap.data() as AppUser);
          } else {
            setPartner(null); // Partner document deleted
          }
        })
      );
      
      // Listen for ICE candidates from partner
      unsubscribers.push(
        listenForIceCandidates(chatId, partnerUid, (candidate) => {
           // Only add candidates after the remote description is set
          if (pc.current?.remoteDescription) {
            pc.current?.addIceCandidate(new RTCIceCandidate(candidate));
          }
        })
      );
      
      // Listen for chat deletion (partner disconnected)
      unsubscribers.push(
        onSnapshot(doc(firestore, 'chats', chatId), (docSnap) => {
          // If doc doesn't exist and we are not the one who triggered the unload
          if (!docSnap.exists() && !isUnloading.current) {
             toast({ title: "Partner has disconnected", description: "Finding a new partner..." });
             router.push('/queue');
          }
        })
      );

      // 6. Signaling Logic (Offer/Answer Handshake)
      if (isCaller) {
        // Listen for the answer from the callee
        unsubscribers.push(listenForAnswer(chatId, partnerUid, async (answer) => {
            if (pc.current && !pc.current.currentRemoteDescription) {
                await pc.current.setRemoteDescription(new RTCSessionDescription(answer));
            }
        }));
        
        // Create and send the offer
        const offer = await pc.current.createOffer();
        await pc.current.setLocalDescription(offer);
        await createOffer(chatId, user.uid, { type: offer.type, sdp: offer.sdp });
      } else { // Callee
        // Listen for the offer from the caller
        unsubscribers.push(listenForOffer(chatId, partnerUid, async (offer) => {
            if (pc.current && !pc.current.remoteDescription) {
                await pc.current.setRemoteDescription(new RTCSessionDescription(offer));
                const answer = await pc.current.createAnswer();
                await pc.current.setLocalDescription(answer);
                await createAnswer(chatId, user.uid, { type: answer.type, sdp: answer.sdp });
            }
        }));
      }

      // 7. Update own status in Firestore with initial media state
      await updateUser(user.uid, { isCamOn, isMicOn });

      setIsConnecting(false);
    };

    setupChat();
    
    // The single, robust cleanup function
    return () => {
      isCancelled = true;
      console.log("Cleaning up chat session...");
      
      unsubscribers.forEach(unsub => unsub());

      if (pc.current) {
        pc.current.ontrack = null;
        pc.current.onicecandidate = null;
        pc.current.close();
        pc.current = null;
      }

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      if (remoteStreamRef.current) {
        remoteStreamRef.current.getTracks().forEach(track => track.stop());
        remoteStreamRef.current = null;
      }
      
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

      // The 'Next' or 'Stop' buttons will have already deleted the chat doc.
      // This cleanup only runs if the component unmounts unexpectedly (e.g. browser refresh)
      if (!isUnloading.current && chatId) {
          endChat(chatId);
          if (user) {
              updateUserStatus(user.uid, 'offline');
          }
      }
    };
  // This effect MUST re-run if the user, chatId, or partner changes.
  // Other values are stable or handled by component state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, chatId, partnerUid, isCaller]);


  // --- User Actions ---
  const handleToggleMic = useCallback(() => {
    setIsMicOn(prev => {
        const newMicState = !prev;
        localStreamRef.current?.getAudioTracks().forEach(t => t.enabled = newMicState);
        if (user) {
            updateUser(user.uid, { isMicOn: newMicState });
            localStorage.setItem('ran-chat-mic-on', JSON.stringify(newMicState));
        }
        return newMicState;
    });
  }, [user]);

  const handleToggleCam = useCallback(() => {
    setIsCamOn(prev => {
        const newCamState = !prev;
        localStreamRef.current?.getVideoTracks().forEach(t => t.enabled = newCamState);
        if (user) {
            updateUser(user.uid, { isCamOn: newCamState });
            localStorage.setItem('ran-chat-cam-on', JSON.stringify(newCamState));
        }
        return newCamState;
    });
  }, [user]);

  const handleNext = useCallback(async () => {
    isUnloading.current = true; // prevent cleanup from running endChat
    
    // End the current chat session, which will trigger the partner's listener to redirect
    if (chatId) {
      await endChat(chatId);
    }

    // Then, put self back into the queue and navigate
    if (user && appUser) {
      await updateUserStatus(user.uid, 'searching');
      // We need to omit fields that are not part of the queue data
      const { uid, createdAt, ...queueData } = appUser;
      await addUserToQueue(user.uid, { ...queueData, status: 'searching' });
      router.push('/queue');
    } else {
      // Fallback if user data is missing for some reason
      router.push('/');
    }
  }, [chatId, user, appUser, router]);
  
  const fullUserDelete = useCallback(async () => {
    if (user && auth?.currentUser) {
        if (chatId) await endChat(chatId);
        
        try {
            await deleteFirestoreUser(user.uid);
            await deleteAuthUser(auth.currentUser);
        } catch (error) {
            console.error("Error deleting anonymous user:", error);
        }
    }
  }, [user, auth, chatId]);

  const handleStop = async () => {
    isUnloading.current = true; // Mark as intentional unload
    await fullUserDelete();
    router.push("/");
  };
  
  useEffect(() => {
    const handleBeforeUnload = () => {
      // This is a "best-effort" fire-and-forget attempt on browser close.
      if (isUnloading.current) return;
      if (chatId) endChat(chatId);
      if (user) updateUserStatus(user.uid, 'offline');
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [user, chatId]);

  // If params are not ready yet, show a loading state to prevent redirect loops.
  if (!chatId || !partnerUid) {
    return (
        <div className="flex h-screen w-full items-center justify-center bg-background">
            <p className="text-muted-foreground animate-pulse">Initializing Chat...</p>
        </div>
    );
  }

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
              <video ref={remoteVideoRef} className="w-full h-full object-cover" autoPlay playsInline />
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
                  isCamOff={!isCamOn}
                  className="h-full"
                >
                  <video ref={localVideoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
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
        {user && chatId ? (
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

    

    

    