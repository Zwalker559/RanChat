
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
import { createOffer, createAnswer, addIceCandidate, listenForIceCandidates, endChat, updateUserStatus, updateUser } from '@/lib/firebase/firestore';
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

  // --- Refs ---
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const isUnloading = useRef(false);

  // --- State ---
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [partner, setPartner] = useState<AppUser | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLocalVideoMinimized, setIsLocalVideoMinimized] = useState(false);
  
  // Controls state
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [hasCameraPermission, setHasCameraPermission] = useState(true);
  const [hasMicPermission, setHasMicPermission] = useState(true);

  const chatId = searchParams.get('chatId');
  const partnerUid = searchParams.get('partnerUid');
  const isCaller = searchParams.get('caller') === 'true';

  // Effect 1: Get user media (camera/mic). This is the first step.
  useEffect(() => {
    let isCancelled = false;
    const getMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (isCancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        const savedCamOn = appUser?.isCamOn ?? true;
        const savedMicOn = appUser?.isMicOn ?? true;

        stream.getVideoTracks().forEach(t => t.enabled = savedCamOn);
        stream.getAudioTracks().forEach(t => t.enabled = savedMicOn);
        
        setIsCamOn(savedCamOn);
        setIsMicOn(savedMicOn);
        setHasCameraPermission(true);
        setHasMicPermission(true);

        setLocalStream(stream); // This state change triggers the WebRTC effect
      } catch (error) {
        console.error("Error accessing media devices:", error);
        setHasCameraPermission(false);
        setHasMicPermission(false);
        toast({
          variant: "destructive",
          title: "Permissions Error",
          description: "Camera and Microphone access denied. Please enable them to use the chat.",
        });
      }
    };
    if (appUser) {
        getMedia();
    }

    return () => {
      isCancelled = true;
    };
  }, [toast, appUser]);


  // Effect 2: Main WebRTC connection logic. Triggers after `localStream` is set.
  useEffect(() => {
    if (!user || !chatId || !partnerUid || !localStream) {
      return;
    }

    isUnloading.current = false;
    const unsubscribers: Unsubscribe[] = [];

    // --- 1. Create Peer Connection ---
    const pc = new RTCPeerConnection(servers);
    pcRef.current = pc;
    setIsConnecting(true);

    // --- 2. Add local stream to the connection ---
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
   
    // --- 3. Setup event handlers for the connection ---
    pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
            setRemoteStream(event.streams[0]);
        }
    };

    pc.onicecandidate = event => {
      if (event.candidate && user) {
        addIceCandidate(chatId, user.uid, event.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Connection state: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        setIsConnecting(false);
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        if (!isUnloading.current) {
          toast({ title: "Partner disconnected" });
          router.push('/queue');
        }
      }
    };

    // --- 4. Setup Signaling (the "handshake") ---
    const setupSignaling = async () => {
        // A) Listen for remote ICE candidates
        unsubscribers.push(
          listenForIceCandidates(chatId, partnerUid, (candidate) => {
            if (pc.signalingState !== 'closed') {
              pc.addIceCandidate(new RTCIceCandidate(candidate))
                .catch(e => console.error("Error adding received ICE candidate", e));
            }
          })
        );
        
        // B) Listen for offers/answers from the partner
        const partnerPeerRef = doc(firestore, 'chats', chatId, 'peers', partnerUid);
        unsubscribers.push(onSnapshot(partnerPeerRef, async (snapshot) => {
            const data = snapshot.data();
            if (!pcRef.current || !data) return;

            // Logic for the callee to receive an offer
            if (data.offer && !isCaller) {
                 if (pcRef.current.signalingState !== 'stable') return;
                 console.log("Received offer, creating answer...");
                 await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.offer));
                 const answer = await pcRef.current.createAnswer();
                 await pcRef.current.setLocalDescription(answer);
                 await createAnswer(chatId, user.uid, { type: answer.type, sdp: answer.sdp });
            }

            // Logic for the caller to receive an answer
            if (data.answer && isCaller) {
                if (pcRef.current.signalingState !== 'have-local-offer') return;
                console.log("Received answer.");
                await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
        }));

        // C) If we are the caller, create and send the initial offer
        if (isCaller) {
            console.log("Creating offer...");
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await createOffer(chatId, user.uid, { type: offer.type, sdp: offer.sdp });
        }
    };

    setupSignaling().catch(e => {
        console.error("Signaling setup failed:", e);
        toast({ variant: 'destructive', title: 'Connection Failed', description: 'Could not establish a connection.' });
    });

    // --- 5. Setup other listeners for chat/user state ---
    unsubscribers.push(
      onSnapshot(doc(firestore, 'users', partnerUid), (docSnap) => {
        if (docSnap.exists()) {
          setPartner(docSnap.data() as AppUser);
        } else if (!isUnloading.current) {
          toast({ title: "Partner has left the chat" });
          router.push('/queue');
        }
      })
    );
    unsubscribers.push(
      onSnapshot(doc(firestore, 'chats', chatId), (docSnap) => {
        if (!docSnap.exists() && !isUnloading.current) {
          toast({ title: "Chat ended" });
          router.push('/queue');
        }
      })
    );

    // --- 6. Cleanup ---
    return () => {
      isUnloading.current = true;
      unsubscribers.forEach(unsub => unsub());
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      setRemoteStream(null);
    };
  }, [user, chatId, partnerUid, isCaller, router, toast, localStream]);

  // Effect 3: Attach streams to video elements.
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);
  
  // Effect 4: Audio activity detection for speaking indicator
  useEffect(() => {
    let animationFrameId: number;
    let audioContext: AudioContext;
    let analyser: AnalyserNode;
    let source: MediaStreamAudioSourceNode;

    if (localStream && isMicOn) {
        const audioTracks = localStream.getAudioTracks();
        if (audioTracks.length === 0 || !audioTracks.some(t => t.enabled)) {
            setIsSpeaking(false);
            return;
        };

        try {
            audioContext = new window.AudioContext();
            analyser = audioContext.createAnalyser();
            analyser.minDecibels = -90;
            analyser.maxDecibels = -10;
            analyser.smoothingTimeConstant = 0.85;

            source = audioContext.createMediaStreamSource(localStream);
            source.connect(analyser);

            analyser.fftSize = 32;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            const loop = () => {
                animationFrameId = requestAnimationFrame(loop);
                analyser.getByteFrequencyData(dataArray);
                const sum = dataArray.reduce((a, b) => a + b, 0);
                const avg = bufferLength > 0 ? sum / bufferLength : 0;
                setIsSpeaking(avg > 15);
            };
            loop();
        } catch(e) {
            console.error("Audio context error:", e);
            setIsSpeaking(false);
        }

    } else {
        setIsSpeaking(false);
    }

    return () => {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        source?.disconnect();
        if (audioContext?.state !== 'closed') {
            audioContext?.close().catch(e => console.error("Error closing audio context", e));
        }
    };
  }, [localStream, isMicOn]);


  // --- User Actions ---
  const handleToggleMic = useCallback(() => {
    setIsMicOn(prev => {
        const newMicState = !prev;
        localStream?.getAudioTracks().forEach(t => t.enabled = newMicState);
        if (user) {
            updateUser(user.uid, { isMicOn: newMicState });
        }
        if (!newMicState) setIsSpeaking(false);
        return newMicState;
    });
  }, [localStream, user]);

  const handleToggleCam = useCallback(() => {
    setIsCamOn(prev => {
        const newCamState = !prev;
        localStream?.getVideoTracks().forEach(t => t.enabled = newCamState);
        if (user) {
            updateUser(user.uid, { isCamOn: newCamState });
        }
        return newCamState;
    });
  }, [localStream, user]);

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
      isUnloading.current = true;
      if (user && chatId) {
        // Stop media streams on unload to turn off camera light
        localStream?.getTracks().forEach(track => track.stop());
        endChat(chatId);
        updateUserStatus(user.uid, 'offline');
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        // Also cleanup streams if the component unmounts for other reasons (e.g. navigation)
        if (isUnloading.current) {
           localStream?.getTracks().forEach(track => track.stop());
        }
    }
  }, [user, chatId, localStream]);

  if (!chatId || !partnerUid || !appUser) {
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
                isCamOff={!partner?.isCamOn || !remoteStream}
                isConnecting={isConnecting && !remoteStream}
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
                  isConnecting={!localStream}
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
            isSpeaking={isSpeaking}
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

    