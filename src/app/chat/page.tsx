
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
import { createOffer, listenForOffer, createAnswer, listenForAnswer, addIceCandidate, listenForIceCandidates, endChat, updateUserStatus, updateUser } from '@/lib/firebase/firestore';
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
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [localStreamReady, setLocalStreamReady] = useState(false);


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

  // This effect safely attaches the remote stream to the video element when it's ready.
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
        remoteVideoRef.current.muted = false; // Unmute here after srcObject is set
        remoteVideoRef.current.play().catch(e => console.error("Remote play failed", e));
    }
  }, [remoteStream]);


  // Main setup and teardown effect
  useEffect(() => {
    if (!user || !chatId || !partnerUid) {
      return;
    }

    let isCancelled = false;
    const unsubscribers: Unsubscribe[] = [];
    
    // 1. Create Peer Connection INSTANCE immediately
    const peerConnection = new RTCPeerConnection(servers);
    pc.current = peerConnection;
    setIsConnecting(true);
    setRemoteStream(null);
    isUnloading.current = false;
    
    // 2. Setup WebRTC event handlers on the instance
    peerConnection.onicecandidate = event => {
      if (event.candidate && user) {
        addIceCandidate(chatId, user.uid, event.candidate.toJSON());
      }
    };
    
    peerConnection.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
          // This is a more robust way to handle tracks and build the stream
          const currentStream = remoteStream || new MediaStream();
          currentStream.addTrack(track);
          setRemoteStream(currentStream);
      });
    };

    const setupAndStart = async () => {
      // 3. Get User Media
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (isCancelled) { 
          stream.getTracks().forEach(t => t.stop()); 
          return; 
        }
        setHasCameraPermission(true);
        setHasMicPermission(true);
      } catch (error) {
        console.error("Error accessing media devices:", error);
        setHasCameraPermission(false);
        setHasMicPermission(false);
        setIsConnecting(false);
        toast({
            variant: "destructive",
            title: "Permissions Error",
            description: "Camera and Microphone access denied. Please enable in your browser settings.",
        });
        return;
      }

      // 4. Attach media to local elements and connection
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setLocalStreamReady(true);
      
      stream.getVideoTracks().forEach(t => t.enabled = isCamOn);
      stream.getAudioTracks().forEach(t => t.enabled = isMicOn);

      stream.getTracks().forEach(track => {
        try {
          peerConnection.addTrack(track, stream);
        } catch (e) {
          console.error("Error adding track:", e);
        }
      });
      
      // 5. Set up all Firestore listeners
      unsubscribers.push(
        listenForIceCandidates(chatId, partnerUid, (candidate) => {
          peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
            .catch(e => console.error("Error adding received ICE candidate", e));
        })
      );
      
      unsubscribers.push(
        onSnapshot(doc(firestore, 'users', partnerUid), (docSnap) => {
          if (docSnap.exists()) {
            setPartner(docSnap.data() as AppUser);
          } else {
            if (!isUnloading.current) {
              toast({ title: "Partner has disconnected" });
              router.push('/queue');
            }
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

      // 6. Start the signaling process (Offer/Answer)
      if (isCaller) {
        unsubscribers.push(listenForAnswer(chatId, partnerUid, async (answer) => {
            if (peerConnection.currentRemoteDescription) return;
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }));
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await createOffer(chatId, user.uid, { type: offer.type, sdp: offer.sdp });
      } else {
        unsubscribers.push(listenForOffer(chatId, partnerUid, async (offer) => {
            if (peerConnection.remoteDescription) return;
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            await createAnswer(chatId, user.uid, { type: answer.type, sdp: answer.sdp });
        }));
      }

      await updateUser(user.uid, { isCamOn, isMicOn });
      setIsConnecting(false);
    };

    setupAndStart();
    
    // 7. Unified cleanup function
    return () => {
      isCancelled = true;
      console.log("Cleaning up chat session...");
      
      unsubscribers.forEach(unsub => unsub());

      if (pc.current) {
        pc.current.getTransceivers().forEach(transceiver => transceiver.stop());
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
      setLocalStreamReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, chatId, partnerUid, isCaller]);

  useEffect(() => {
    let animationFrameId: number;
    let audioContext: AudioContext;
    let analyser: AnalyserNode;
    let source: MediaStreamAudioSourceNode;

    if (localStreamReady && isMicOn && localStreamRef.current) {
        const stream = localStreamRef.current;
        const audioTracks = stream.getAudioTracks();
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

            source = audioContext.createMediaStreamSource(stream);
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
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        source?.disconnect();
        if (audioContext?.state !== 'closed') {
            audioContext?.close().catch(e => console.error("Error closing audio context", e));
        }
    };
}, [localStreamReady, isMicOn]);


  // --- User Actions ---
  const handleToggleMic = useCallback(() => {
    setIsMicOn(prev => {
        const newMicState = !prev;
        localStreamRef.current?.getAudioTracks().forEach(t => t.enabled = newMicState);
        if (user) {
            updateUser(user.uid, { isMicOn: newMicState });
            localStorage.setItem('ran-chat-mic-on', JSON.stringify(newMicState));
        }
        if (!newMicState) setIsSpeaking(false);
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
      if (user) {
        updateUserStatus(user.uid, 'offline');
      }
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
              <video ref={remoteVideoRef} className="w-full h-full object-cover" playsInline muted />
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
