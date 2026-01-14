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
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { findPartner, createOffer, listenForOffer, createAnswer, listenForAnswer, addIceCandidate, listenForIceCandidates, endChat, updateUserStatus, getUser, listenForPartner, getChatDoc } from '@/lib/firebase/firestore';
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
  const { user, appUser } = useAuth();

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
    }

    setChatId(null);
    setPartnerUid(null);
    setPartnerUsername('Stranger');
    setIsConnecting(false);
  }, [chatId, user]);


  const startWebRTC = useCallback(async (isCaller: boolean, currentChatId: string, currentPartnerUid: string) => {
    if (!user) return;
    
    setIsConnecting(false); // We have a match, no longer connecting
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
    
    // Listen for partner disconnecting
    const chatDocUnsub = onSnapshot(doc(firestore, 'chats', currentChatId), (docSnap) => {
        if (!docSnap.exists()) {
            console.log("Chat has been ended by partner.");
            toast({ title: "Partner has disconnected", description: "Finding a new partner..." });
            handleNext(true); // Automatically find a new partner
        }
    });
    firestoreUnsubscribers.current.push(chatDocUnsub);

  }, [user, toast]);


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
        return null;
    }
  }, [toast, isMicOn, isCamOn]);

  const handleNext = useCallback(async (isAutoNext = false) => {
    setIsConnecting(true);
    
    await cleanup();
    
    // Start media stream before finding a partner
    const stream = await startMedia();
    if (!stream) {
        setIsConnecting(false);
        return;
    }

    if (user && appUser) {
        const match = await findPartner(user.uid, appUser.preferences);
        if (match) {
            await updateUserStatus(user.uid, 'in-chat');
            startWebRTC(true, match.chatId, match.partnerUid);
        } else {
            // No immediate match, go to queue.
            router.push('/queue');
        }
    }
  }, [user, appUser, cleanup, router, startWebRTC, startMedia]);

  const handleStop = async () => {
    setIsConnecting(false);
    await cleanup();
    if (user) {
      try {
        await deleteAuthUser(user);
        console.log("Anonymous user deleted.");
      } catch (error) {
        console.error("Error deleting anonymous user:", error);
      }
    }
    router.push("/");
  };

  // Initial media setup & cleanup
  useEffect(() => {
    startMedia();
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (user) {
        // This is not guaranteed to run, but it's the best we can do.
        deleteAuthUser(user).catch(e => console.error("Could not delete user on unload", e));
      }
    };
  
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        cleanup(true);
    };
  }, [startMedia, cleanup, user]);
  
  // Main logic to start or join a chat
  useEffect(() => {
    const initializeChat = async () => {
        if (!user || !appUser || !localStreamRef.current) return;

        const urlChatId = searchParams.get('chatId');
        
        // If there's a chatId in URL, we are joining.
        if (urlChatId) {
            setChatId(urlChatId);
            const chatDoc = await getChatDoc(urlChatId);
            if (chatDoc) {
                const partner = chatDoc.participants.find(p => p !== user.uid);
                if (partner) {
                    await updateUserStatus(user.uid, 'in-chat');
                    startWebRTC(false, urlChatId, partner);
                } else {
                    toast({variant: 'destructive', title: "Chat is invalid"});
                    router.push('/');
                }
            } else {
                // If chat doc doesn't exist, it might have been deleted, start fresh
                handleNext();
            }
        } else if (!chatId) { // No chatId anywhere, so we are initiating
            handleNext();
        }
    };

    if (user && appUser && hasCameraPermission) {
        if (localStreamRef.current) {
            initializeChat();
        } else {
            startMedia().then(stream => {
                if (stream) initializeChat();
            });
        }
    }

  }, [user, appUser, searchParams, hasCameraPermission, startMedia, router, startWebRTC, handleNext, toast, chatId]);

  return (
    <main className="grid h-screen max-h-screen grid-cols-1 lg:grid-cols-[1fr_400px] overflow-hidden">
      <div className="relative flex flex-col items-center justify-center p-4 bg-black/90">
        <div className="w-full h-full flex items-center justify-center max-w-4xl max-h-[calc(100vh-120px)] aspect-video">
            <VideoPlayer
                name={partnerUsername}
                isConnecting={isConnecting}
            >
              <video ref={remoteVideoRef} className="w-full h-full object-cover" autoPlay playsInline />
            </VideoPlayer>
        </div>
        <div className={cn(
            "absolute top-4 right-4 z-20 transition-all duration-300 ease-in-out",
            isLocalVideoMinimized ? "w-24" : "w-48"
          )}>
          <div className="relative group/videoplayer">
            <VideoPlayer
              name={appUser?.username || "You"}
              isMuted={!isMicOn}
              isCamOff={!isCamOn}
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
                {isLocalVideoMinimized ? <Plus size={14} /> : <Minus size={14} />}
                <span className="sr-only">{isLocalVideoMinimized ? 'Maximize' : 'Minimize'} video</span>
              </Button>
          </div>
        </div>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-full max-w-md px-4">
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
        <Suspense fallback={<div>Loading...</div>}>
            <ChatPageContent />
        </Suspense>
    )
}
