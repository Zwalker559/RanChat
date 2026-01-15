"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { VideoPlayer } from '@/components/chat/video-player';
import { ChatWindow } from '@/components/chat/chat-window';
import { ChatControls } from '@/components/chat/chat-controls';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Maximize, Minimize } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createOffer, listenForOffer, createAnswer, listenForAnswer, addIceCandidate, listenForIceCandidates, endChat, updateUserStatus, getUser, getChatDoc, deleteUser as deleteFirestoreUser } from '@/lib/firebase/firestore';
import { Unsubscribe, onSnapshot, doc } from 'firebase/firestore';
import { firestore } from '@/lib/firebase/config';
import { deleteUser as deleteAuthUser } from 'firebase/auth';

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
  const [isConnecting, setIsConnecting] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState(true);
  const [isLocalVideoMinimized, setIsLocalVideoMinimized] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [partnerUid, setPartnerUid] = useState<string | null>(null);
  const [partnerUsername, setPartnerUsername] = useState<string>('Stranger');

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  
  const firestoreUnsubscribers = useRef<Unsubscribe[]>([]);
  const isUnloading = useRef(false);

  const cleanup = useCallback(async (shouldEndChat = true) => {
    console.log("Cleaning up chat session...");
    firestoreUnsubscribers.current.forEach(unsub => unsub());
    firestoreUnsubscribers.current = [];

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

    if (chatId && user && shouldEndChat) {
      await endChat(chatId, user.uid);
    } else if (user) {
        await updateUserStatus(user.uid, 'online');
    }

    setChatId(null);
    setPartnerUid(null);
    setPartnerUsername('Stranger');
    setIsConnecting(false);
  }, [chatId, user]);


  const startWebRTC = useCallback(async (isCaller: boolean, currentChatId: string, currentPartnerUid: string) => {
    if (!user || !auth) return;
    
    setIsConnecting(false); 
    setChatId(currentChatId);
    setPartnerUid(currentPartnerUid);

    const partner = await getUser(currentPartnerUid);
    setPartnerUsername(partner?.username || 'Stranger');

    pc.current = new RTCPeerConnection(servers);

    localStreamRef.current?.getTracks().forEach(track => {
      pc.current!.addTrack(track, localStreamRef.current!);
    });

    pc.current.ontrack = event => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };
    
    pc.current.onicecandidate = event => {
        event.candidate && addIceCandidate(currentChatId, user.uid, event.candidate.toJSON());
    };

    if (isCaller) {
        const offerDescription = await pc.current.createOffer();
        await pc.current.setLocalDescription(offerDescription);
        await createOffer(currentChatId, user.uid, { type: offerDescription.type, sdp: offerDescription.sdp });
        
        const unsub = listenForAnswer(currentChatId, currentPartnerUid, async (answer) => {
            if (pc.current && !pc.current.currentRemoteDescription) {
                const answerDescription = new RTCSessionDescription(answer);
                await pc.current.setRemoteDescription(answerDescription);
            }
        });
        firestoreUnsubscribers.current.push(unsub);
    } else { 
        const unsub = listenForOffer(currentChatId, currentPartnerUid, async (offer) => {
            if (pc.current) {
                await pc.current.setRemoteDescription(new RTCSessionDescription(offer));
                const answerDescription = await pc.current.createAnswer();
                await pc.current.setLocalDescription(answerDescription);
                await createAnswer(currentChatId, user.uid, { type: answerDescription.type, sdp: answerDescription.sdp });
            }
        });
        firestoreUnsubscribers.current.push(unsub);
    }
    
    const unsubIce = listenForIceCandidates(currentChatId, currentPartnerUid, (candidate) => {
        pc.current?.addIceCandidate(new RTCIceCandidate(candidate));
    });
    firestoreUnsubscribers.current.push(unsubIce);
    
    const chatDocUnsub = onSnapshot(doc(firestore, 'chats', currentChatId), (docSnap) => {
        if (!docSnap.exists()) {
            console.log("Chat has been ended by partner.");
            toast({ title: "Partner has disconnected", description: "Finding a new partner..." });
            handleNext(true);
        }
    });
    firestoreUnsubscribers.current.push(chatDocUnsub);

  }, [user, auth, toast]);


  const startMedia = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        stream.getAudioTracks().forEach(t => t.enabled = isMicOn);
        stream.getVideoTracks().forEach(t => t.enabled = isCamOn);
        setHasCameraPermission(true);
        if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
        }
        return stream;
    } catch (error) {
        console.error('Error accessing camera:', error);
        setHasCameraPermission(false);
        toast({
            variant: 'destructive',
            title: 'Camera Access Denied',
            description: 'Please enable camera permissions in your browser settings to use this feature.',
        });
        setIsCamOn(false);
        setIsConnecting(false);
        return null;
    }
  }, [toast, isMicOn, isCamOn]);

  const handleNext = useCallback(async (isAutoNext = false) => {
    setIsConnecting(true);
    await cleanup();
    router.push('/queue');
  }, [cleanup, router]);

  const fullUserDelete = useCallback(async () => {
    if (user && auth?.currentUser) {
        try {
            await deleteFirestoreUser(user.uid);
            // This is the key part: deleting the user from Firebase Auth
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
  }, [user, auth, toast]);

  const handleStop = async () => {
    isUnloading.current = true;
    await cleanup();
    await fullUserDelete();
    router.push("/");
  };
  
  useEffect(() => {
    const handleUnload = (e: BeforeUnloadEvent) => {
      // This is a last-resort attempt. Modern browsers limit what can be done here.
      // We can't use async operations. The most reliable cleanup is user-initiated (Stop button).
      if (user && auth?.currentUser && !isUnloading.current) {
          // This will not reliably work, but it's the best we can do in `beforeunload`.
          // The primary cleanup should happen via the "Stop" button.
          navigator.sendBeacon(`/api/cleanup?uid=${user.uid}`);
      }
    };
  
    window.addEventListener('beforeunload', handleUnload);

    return () => {
        window.removeEventListener('beforeunload', handleUnload);
        // This cleanup runs when the component unmounts, e.g., navigating away
        if (!isUnloading.current) {
            cleanup(true);
        }
    };
  }, [cleanup, user, auth]);
  
  useEffect(() => {
    const initializeChat = async () => {
        if (!user || !appUser || !localStreamRef.current) return;

        const urlChatId = searchParams.get('chatId');
        const urlPartnerUid = searchParams.get('partnerUid');
        const urlIsCaller = searchParams.get('caller') === 'true';

        if (urlChatId && urlPartnerUid) {
            setChatId(urlChatId);
            const chatDoc = await getChatDoc(urlChatId);
            if (chatDoc) {
                await updateUserStatus(user.uid, 'in-chat');
                startWebRTC(urlIsCaller, urlChatId, urlPartnerUid);
            } else {
                toast({ title: "Chat not found", description: "The chat you were looking for doesn't exist. Finding a new partner." });
                handleNext();
            }
        } else {
            router.push('/queue');
        }
    };

    if (user && appUser) {
        startMedia().then(stream => {
            if (stream) initializeChat();
            else router.push('/'); // No camera access, go home
        });
    } else if(!user) {
        // If there's no user, auth is likely still loading or failed.
        // AuthProvider handles redirecting, so we can just wait.
    }

  }, [user, appUser, searchParams, startMedia, router, startWebRTC, handleNext, toast]);

  return (
    <main className="grid h-screen max-h-screen grid-cols-1 lg:grid-cols-[1fr_400px] overflow-hidden">
      <div className="relative flex flex-col items-center justify-between p-4 bg-black/90 h-full">
        <div className={cn(
          "grid w-full flex-1 gap-4 transition-all duration-300",
          isLocalVideoMinimized ? "grid-rows-1" : "grid-rows-[1fr_auto] md:grid-rows-1 md:grid-cols-[1fr_300px]"
        )}>
          <div className="relative group/videoplayer w-full h-full min-h-0">
            <VideoPlayer
                name={partnerUsername}
                isConnecting={isConnecting || !partnerUid}
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
                  { !hasCameraPermission && isCamOn && (
                      <Alert variant="destructive" className="absolute bottom-2 left-2 right-2 p-2">
                        <AlertTitle className="text-xs">Camera Required</AlertTitle>
                        <AlertDescription className="text-xs">
                          Please allow camera access.
                        </AlertDescription>
                      </Alert>
                  )}
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
            isConnecting={isConnecting}
            inCall={!!chatId}
            onToggleMic={() => {
                const newMicState = !isMicOn;
                setIsMicOn(newMicState);
                if (localStreamRef.current) {
                    localStreamRef.current.getAudioTracks().forEach(t => t.enabled = newMicState);
                }
            }}
            onToggleCam={() => {
                const newCamState = !isCamOn;
                setIsCamOn(newCamState);
                 if (localStreamRef.current) {
                    localStreamRef.current.getVideoTracks().forEach(t => t.enabled = newCamState);
                }
            }}
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
        <Suspense fallback={<div className="flex h-screen w-full items-center justify-center"><p>Loading Chat...</p></div>}>
            <ChatPageContent />
        </Suspense>
    )
}
