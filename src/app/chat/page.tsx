"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { VideoPlayer } from "@/components/chat/video-player";
import { ChatWindow } from "@/components/chat/chat-window";
import { ChatControls } from "@/components/chat/chat-controls";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Minus, Plus } from "lucide-react";

export default function ChatPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState(true);
  const [isLocalVideoMinimized, setIsLocalVideoMinimized] = useState(false);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);

  const remoteVideo = useMemo(() => PlaceHolderImages.find(p => p.id === 'remote-video-feed'), []);

  const handleSkip = () => {
    console.log("Skipping chat...");
    setIsConnecting(true);
    setTimeout(() => {
      // In a real app, you'd connect to a new user here.
      setIsConnecting(false);
    }, 1500);
  };

  const handleStop = () => {
    console.log("Stopping chat...");
    router.push("/");
  };
  
  useEffect(() => {
    const getCameraPermission = async () => {
      // Don't ask for permissions if camera is off
      if (!isCamOn) {
        if (localVideoRef.current && localVideoRef.current.srcObject) {
          const stream = localVideoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach(track => track.stop());
          localVideoRef.current.srcObject = null;
        }
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: isMicOn });
        setHasCameraPermission(true);

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        
        // Mute/unmute audio track based on isMicOn
        stream.getAudioTracks().forEach(track => {
          track.enabled = isMicOn;
        });

      } catch (error) {
        console.error('Error accessing camera:', error);
        setHasCameraPermission(false);
        if (isCamOn) { // Only show toast if user intended to turn cam on
           toast({
             variant: 'destructive',
             title: 'Camera Access Denied',
             description: 'Please enable camera permissions in your browser settings to use this feature.',
           });
        }
        setIsCamOn(false); // Force cam off if permission denied
      }
    };

    getCameraPermission();
    
    // Cleanup function to stop media tracks when component unmounts or deps change
    return () => {
      if (localVideoRef.current && localVideoRef.current.srcObject) {
        const stream = localVideoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    }
  }, [isCamOn, isMicOn, toast]);


  return (
    <main className="grid h-screen max-h-screen grid-cols-1 lg:grid-cols-[1fr_400px] overflow-hidden">
      <div className="relative flex flex-col items-center justify-center p-4 bg-black/90">
        <VideoPlayer
          src={remoteVideo?.imageUrl ?? ''}
          data-ai-hint={remoteVideo?.imageHint}
          name="Stranger"
          isConnecting={isConnecting}
          className="w-full h-full"
        />
        <div className={cn(
            "absolute top-4 right-4 z-20 transition-all duration-300 ease-in-out",
            isLocalVideoMinimized ? "w-28" : "w-1/5 max-w-[200px] min-w-[150px]"
          )}>
          <VideoPlayer
            name="You"
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
              variant="secondary" 
              className="absolute -top-2 -left-2 z-30 h-6 w-6 rounded-full bg-background/50 hover:bg-background"
              onClick={() => setIsLocalVideoMinimized(prev => !prev)}
            >
              {isLocalVideoMinimized ? <Plus size={14} /> : <Minus size={14} />}
              <span className="sr-only">{isLocalVideoMinimized ? 'Maximize' : 'Minimize'} video</span>
            </Button>
        </div>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-full max-w-sm px-4">
          <ChatControls
            isMicOn={isMicOn}
            isCamOn={isCamOn}
            isConnecting={isConnecting}
            onToggleMic={() => setIsMicOn((prev) => !prev)}
            onToggleCam={() => setIsCamOn((prev) => !prev)}
            onSkip={handleSkip}
            onStop={handleStop}
          />
        </div>
      </div>
      <div className="w-full lg:max-w-[400px] flex flex-col bg-card/50 backdrop-blur-sm border-l border-border h-full">
        <ChatWindow />
      </div>
    </main>
  );
}
