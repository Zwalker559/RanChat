
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
import { createOffer, listenForOffer, createAnswer, listenForAnswer, addIceCandidate, listenForIceCandidates, endChat, updateUserStatus, addUserToQueue, updateUser } from '@/lib/firebase/firestore';
import { Unsubscribe, onSnapshot, doc } from 'firebase/firestore';
import { firestore } from '@/lib/firebase/config';
import type { User as AppUser } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

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
  const { user, appUser } = useAuth();

  // --- State Management ---
  const [isConnecting, setIsConnecting] = useState(true);
  const [isLocalVideoMinimized, setIsLocalVideoMinimized] = useState(false);
  const [partner, setPartner] = useState<AppUser | null>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState(true);
  const [hasMicPermission, setHasMicPermission] = useState(true);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null); // NEW: State to hold the remote stream safely

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
  const isUnloading = useRef(false);

  const chatId = searchParams.get('chatId');
  const partnerUid = searchParams.get('partnerUid');
  const isCaller = searchParams.get('caller') === 'true';

  // Effect to safely attach the remote stream to the video element
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      
      // Mute, Play, then Unmute to handle browser autoplay policies
      remoteVideoRef.current.muted = true;
      const playPromise = remoteVideoRef.current.play();

      if (playPromise !== undefined) {
        playPromise.then(() => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.muted = false;
          }
        }).catch(error => {
          console.error("Remote video playback was prevented:", error);
          toast({
            variant: "destructive",
            title: "Playback Error",
            description: "Could not play partner's video automatically."
          });
        });
      }
    }
  }, [remoteStream, toast]);

  // Main setup and teardown effect
  useEffect(() => {
    if (!user || !chatId || !partnerUid) {
      return;
    }

    let isCancelled = false;
    const unsubscribers: Unsubscribe[] = [];
    
    const setupChat = async () => {
      setIsConnecting(true);
      isUnloading.current = false;
      setRemoteStream(null); // Reset remote stream on new chat

      pc.current = new RTCPeerConnection(servers);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (isCancelled) { 
          stream.getTracks().forEach(t => t.stop()); 
          return; 
        }
        
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        
        stream.getVideoTracks().forEach(t => t.enabled = isCamOn);
        stream.getAudioTracks().forEach(t => t.enabled = isMicOn);

        stream.getTracks().forEach(track => {
          if (pc.current) {
            pc.current.addTrack(track, stream);
          }
        });

        setHasCameraPermission(true);
        setHasMicPermission(true);
      } catch (error) {
        console.error("Error accessing media devices:", error);
        if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')) {
            setHasCameraPermission(false);
            setHasMicPermission(false);
        } else {
            const mediaError = error as Error;
            if (mediaError.message.includes('video')) setHasCameraPermission(false);
            if (mediaError.message.includes('audio')) setHasMicPermission(false);
        }
      }
      
      // NEW: Safely set remote stream to state, avoiding race conditions.
      pc.current.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
      };
      
      pc.current.onicecandidate = event => {
        if (event.candidate && user) {
          addIceCandidate(chatId, user.uid, event.candidate.toJSON());
        }
      };

      unsubscribers.push(
        onSnapshot(doc(firestore, 'users', partnerUid), (docSnap) => {
          if (docSnap.exists()) {
            setPartner(docSnap.data() as AppUser);
          } else {
            if (!isUnloading.current) {
              toast({ title: "Partner has disconnected", description: "Finding a new partner..." });
              router.push('/queue');
            }
          }
        })
      );
      
      unsubscribers.push(
        listenForIceCandidates(chatId, partnerUid, (candidate) => {
          if (pc.current?.remoteDescription) {
            pc.current?.addIceCandidate(new RTCIceCandidate(candidate));
          }
        })
      );
      
      unsubscribers.push(
        onSnapshot(doc(firestore, 'chats', chatId), (docSnap) => {
          if (!docSnap.exists() && !isUnloading.current) {
             toast({ title: "Chat ended", description: "Finding a new partner..." });
             router.push('/queue');
          }
        })
      );

      if (isCaller) {
        unsubscribers.push(listenForAnswer(chatId, partnerUid, async (answer) => {
            if (pc.current && !pc.current.currentRemoteDescription) {
                await pc.current.setRemoteDescription(new RTCSessionDescription(answer));
            }
        }));
        
        const offer = await pc.current.createOffer();
        await pc.current.setLocalDescription(offer);
        await createOffer(chatId, user.uid, { type: offer.type, sdp: offer.sdp });
      } else {
        unsubscribers.push(listenForOffer(chatId, partnerUid, async (offer) => {
            if (pc.current && !pc.current.remoteDescription) {
                await pc.current.setRemoteDescription(new RTCSessionDescription(offer));
                const answer = await pc.current.createAnswer();
                await pc.current.setLocalDescription(answer);
                await createAnswer(chatId, user.uid, { type: answer.type, sdp: answer.sdp });
            }
        }));
      }

      await updateUser(user.uid, { isCamOn, isMicOn });
      setIsConnecting(false);
    };

    setupChat();
    
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
      
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      setRemoteStream(null);
    };
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
    isUnloading.current = true;
    if (chatId) {
      await endChat(chatId);
    }
    router.push('/queue');
  }, [chatId, router]);
  
  const handleStop = async () => {
    isUnloading.current = true;
    if (chatId) await endChat(chatId);
    if (user) await updateUserStatus(user.uid, 'offline');
    router.push("/");
  };
  
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isUnloading.current) return;
      if (user) updateUserStatus(user.uid, 'offline');
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [user]);

  if (!chatId || !partnerUid) {
    return (
        <div className="flex h-screen w-full items-center justify-center bg-background">
            <p className="text-muted-foreground animate-pulse">Initializing Chat...</p>
        </div>
    );
  }

  const showPermissionAlert = !hasCameraPermission || !hasMicPermission;

  return (
    <main className="grid h-screen max-h-screen grid-cols-1 lg:grid-cols-[1fr_400px] overflow-hidden">
      <div className="relative flex flex-col items-center justify-between p-4 bg-black/90 h-full">
        
        {showPermissionAlert && (
          <Alert variant="destructive" className="absolute top-4 left-4 right-4 z-50 max-w-xl mx-auto">
            <AlertTitle>Permissions Required</AlertTitle>
            <AlertDescription>
              Your {!hasCameraPermission && 'camera'}{!hasCameraPermission && !hasMicPermission && ' and '}{!hasMicPermission && 'microphone'} access is denied. Please enable permissions in your browser settings to share your video/audio.
            </AlertDescription>
          </Alert>
        )}
        
        <div className={cn(
          "grid w-full flex-1 gap-4 transition-all duration-300",
          showPermissionAlert ? "pt-16" : "",
          isLocalVideoMinimized ? "grid-rows-1" : "grid-rows-[1fr_auto] md:grid-rows-1 md:grid-cols-[1fr_300px]"
        )}>
          <div className="relative group/videoplayer w-full h-full min-h-0">
             <VideoPlayer
                name={partner?.username || 'Stranger'}
                isMuted={!partner?.isMicOn}
                isCamOff={!partner?.isCamOn || !remoteStream}
                isConnecting={isConnecting && !remoteStream}
                className="h-full"
            >
              <video ref={remoteVideoRef} className="w-full h-full object-cover" playsInline />
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
                  isConnecting={isConnecting && !localStreamRef.current}
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
