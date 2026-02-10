
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
  const remoteDescSet = useRef(false);
  const iceQueue = useRef<RTCIceCandidateInit[]>([]);

  // --- State ---
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [partner, setPartner] = useState<AppUser | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLocalVideoMinimized, setIsLocalVideoMinimized] = useState(false);
  const [debugStatus, setDebugStatus] = useState<string>("Initializing...");
  
  // Controls state
  const [isMicOn, setIsMicOn] = useState(appUser?.isMicOn ?? true);
  const [isCamOn, setIsCamOn] = useState(appUser?.isCamOn ?? true);
  const [hasCameraPermission, setHasCameraPermission] = useState(true);
  const [hasMicPermission, setHasMicPermission] = useState(true);

  const chatId = searchParams.get('chatId');
  const partnerUid = searchParams.get('partnerUid');
  const isCaller = searchParams.get('caller') === 'true';

  // 1. Get User Media
  useEffect(() => {
    let activeStream: MediaStream | null = null;
    
    async function getMedia() {
      try {
        setDebugStatus("Requesting camera access...");
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        // Sync with appUser preferences
        const camEnabled = appUser?.isCamOn ?? true;
        const micEnabled = appUser?.isMicOn ?? true;
        
        stream.getVideoTracks().forEach(t => t.enabled = camEnabled);
        stream.getAudioTracks().forEach(t => t.enabled = micEnabled);
        
        setIsCamOn(camEnabled);
        setIsMicOn(micEnabled);
        setLocalStream(stream);
        activeStream = stream;
        setDebugStatus("Camera ready - waiting for partner...");
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Media error:", err);
        setDebugStatus(`Camera error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        setHasCameraPermission(false);
        setHasMicPermission(false);
        toast({
          variant: "destructive",
          title: "Permission Denied",
          description: "Please allow camera and mic access to chat.",
        });
      }
    }

    if (appUser && !localStream) {
      getMedia();
    }

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [appUser, toast, localStream]);

  // 2. WebRTC Connection Management
  useEffect(() => {
    if (!user || !chatId || !partnerUid || !localStream) return;

    const pc = new RTCPeerConnection(servers);
    pcRef.current = pc;
    const unsubscribers: Unsubscribe[] = [];
    let connectionTimeout: NodeJS.Timeout;

    // Tracks
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });

    pc.ontrack = (event) => {
      console.log("Track received:", event.track.kind);
      setDebugStatus(`Receiving ${event.track.kind}...`);
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        addIceCandidate(chatId, user.uid, event.candidate.toJSON());
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("ICE Connection State:", pc.iceConnectionState);
      setDebugStatus(`ICE: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'completed') {
        setIsConnecting(false);
        setDebugStatus("Connected!");
        if (connectionTimeout) clearTimeout(connectionTimeout);
      } else if (pc.iceConnectionState === 'failed') {
        setDebugStatus("Connection failed - ICE candidates couldn't connect");
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("PC Connection State:", pc.connectionState);
      setDebugStatus(`Connection: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        setIsConnecting(false);
        setDebugStatus("Connected!");
        if (connectionTimeout) clearTimeout(connectionTimeout);
      } else if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        if (!isUnloading.current) {
          toast({ title: "Disconnected", description: "The connection was lost." });
          router.push('/queue');
        }
      }
    };

    // Signaling
    const setupSignaling = async () => {
      try {
        // Listen for Partner's Signalling Data
        const partnerDocRef = doc(firestore, 'chats', chatId, 'peers', partnerUid);
        unsubscribers.push(onSnapshot(partnerDocRef, async (snapshot) => {
          const data = snapshot.data();
          if (!data) return;

          try {
            if (data.offer && !isCaller && (pc.signalingState === 'stable' || pc.signalingState === 'have-remote-offer')) {
              console.log("Setting remote offer");
              setDebugStatus("Received offer - creating answer...");
              await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
              remoteDescSet.current = true;
              
              // Process queued ICE candidates
              while (iceQueue.current.length > 0) {
                const cand = iceQueue.current.shift();
                if (cand) {
                  await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e => console.warn("ICE candidate error:", e));
                }
              }

              console.log("Creating answer");
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await createAnswer(chatId, user.uid, { type: answer.type, sdp: answer.sdp });
              setDebugStatus("Answer sent - connecting...");
            }

            if (data.answer && isCaller && (pc.signalingState === 'have-local-offer' || pc.signalingState === 'have-remote-offer')) {
              console.log("Setting remote answer");
              setDebugStatus("Received answer - establishing connection...");
              await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
              remoteDescSet.current = true;
              
              while (iceQueue.current.length > 0) {
                const cand = iceQueue.current.shift();
                if (cand) {
                  await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e => console.warn("ICE candidate error:", e));
                }
              }
            }
          } catch (err) {
            console.error("Signaling error:", err);
            setDebugStatus(`Signaling error: ${err instanceof Error ? err.message : 'Unknown'}`);
          }
        }));

        // Listen for ICE candidates
        unsubscribers.push(listenForIceCandidates(chatId, partnerUid, async (cand) => {
          try {
            if (remoteDescSet.current) {
              await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e => console.warn("ICE candidate error:", e));
            } else {
              iceQueue.current.push(cand);
            }
          } catch (err) {
            console.warn("ICE candidate handling error:", err);
          }
        }));

        // Start Connection with timeout
        if (isCaller) {
          console.log("Creating offer");
          setDebugStatus("Creating offer...");
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await createOffer(chatId, user.uid, { type: offer.type, sdp: offer.sdp });
          setDebugStatus("Offer sent - waiting for answer...");
        }

        // Set connection timeout
        connectionTimeout = setTimeout(() => {
          if (pc.connectionState !== 'connected' && pc.iceConnectionState !== 'completed') {
            console.warn("Connection timeout - forcing state check");
            setDebugStatus("Connection timeout - check internet/firewall");
            if (
              setIsConnecting(false);
              setDebugStatus("Connected!");
            }
          }
        }, 10000);
      } catch (err) {
        console.error("Setup signaling error:", err);
        setDebugStatus(`Setup error: ${err instanceof Error ? err.message : 'Unknown'}`);
        toast({ variant: "destructive", title: "Connection Error", description: "Failed to establish connection" });
      }
    };

    setupSignaling();

    // Monitor Partner Presence
    unsubscribers.push(onSnapshot(doc(firestore, 'users', partnerUid), (snap) => {
      if (snap.exists()) {
        setPartner(snap.data() as AppUser);
      } else if (!isUnloading.current) {
        toast({ title: "Partner left" });
        router.push('/queue');
      }
    }));

    return () => {
      if (connectionTimeout) clearTimeout(connectionTimeout);
      unsubscribers.forEach(u => u());
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    };
  }, [user, chatId, partnerUid, isCaller, localStream, router, toast]);

  // Audio Activity Detection
  useEffect(() => {
    if (!localStream || !isMicOn) {
      setIsSpeaking(false);
      return;
    }

    let audioCtx: AudioContext;
    let analyser: AnalyserNode;
    let source: MediaStreamAudioSourceNode;
    let animationFrame: number;

    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      source = audioCtx.createMediaStreamSource(localStream);
      source.connect(analyser);
      analyser.fftSize = 256;
      
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((a, b) => a + b, 0);
        const average = sum / bufferLength;
        setIsSpeaking(average > 20);
        animationFrame = requestAnimationFrame(checkVolume);
      };
      checkVolume();
    } catch (e) {
      console.warn("Audio monitoring failed:", e);
    }

    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (source) source.disconnect();
      if (audioCtx) audioCtx.close();
    };
  }, [localStream, isMicOn]);

  // Handlers
  const handleToggleMic = useCallback(() => {
    setIsMicOn(prev => {
      const newVal = !prev;
      localStream?.getAudioTracks().forEach(t => t.enabled = newVal);
      if (user) updateUser(user.uid, { isMicOn: newVal });
      return newVal;
    });
  }, [localStream, user]);

  const handleToggleCam = useCallback(() => {
    setIsCamOn(prev => {
      const newVal = !prev;
      localStream?.getVideoTracks().forEach(t => t.enabled = newVal);
      if (user) updateUser(user.uid, { isCamOn: newVal });
      return newVal;
    });
  }, [localStream, user]);

  const handleNext = async () => {
    isUnloading.current = true;
    if (chatId) await endChat(chatId);
    router.push('/queue');
  };

  const handleStop = async () => {
    isUnloading.current = true;
    if (chatId) await endChat(chatId);
    if (user) await updateUserStatus(user.uid, 'offline');
    router.push('/');
  };

  if (!chatId || !partnerUid || !appUser) {
    return <div className="flex h-screen items-center justify-center">Loading session...</div>;
  }

  return (
    <main className="grid h-screen max-h-screen grid-cols-1 lg:grid-cols-[1fr_400px] overflow-hidden bg-background">
      <div className="relative flex flex-col items-center justify-between p-4 bg-black/90">
        
        {/* Debug Status Bar */}
        <div className="w-full text-center text-xs md:text-sm text-yellow-400 bg-black/50 px-2 py-1 rounded mb-2 font-mono">
          {debugStatus}
        </div>

        <div className={cn(
          "grid w-full flex-1 gap-4 transition-all duration-300",
          isLocalVideoMinimized ? "grid-rows-1" : "grid-rows-[1fr_auto] md:grid-rows-1 md:grid-cols-[1fr_300px]"
        )}>
          {/* Partner View */}
          <VideoPlayer
            name={partner?.username || 'Partner'}
            isMuted={!partner?.isMicOn}
            isCamOff={!partner?.isCamOn || !remoteStream}
            isConnecting={isConnecting}
            className="h-full"
          >
            <video ref={remoteVideoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
          </VideoPlayer>
          
          {/* Local View */}
          <div className={cn("relative transition-all", isLocalVideoMinimized ? "h-12 w-48 self-end" : "h-full")}>
            <VideoPlayer
              name={appUser.username || "You"}
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
              className="absolute top-2 right-2 z-40 bg-black/20 text-white hover:bg-black/40 h-8 w-8"
              onClick={() => setIsLocalVideoMinimized(!isLocalVideoMinimized)}
            >
              {isLocalVideoMinimized ? <Maximize size={16}/> : <Minimize size={16}/>}
            </Button>
          </div>
        </div>

        <div className="w-full max-w-md mt-4">
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

      <aside className="w-full lg:max-w-[400px] flex flex-col bg-card border-l border-border h-full">
        <ChatWindow chatId={chatId} currentUserUid={user?.uid || ''} />
      </aside>
    </main>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading...</div>}>
      <ChatPageContent />
    </Suspense>
  );
}
