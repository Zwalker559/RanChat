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

  const handleNext = () => {
    if (isConnecting) {
      // If we are connecting, this button acts as a 'Stop' button.
      setIsConnecting(false);
      // Navigate back to home on stop.
      router.push("/");
      return;
    }
    console.log("Skipping chat...");
    setIsConnecting(true);
    // In a real app, you'd find a new user here, with a higher chance for the selected gender.
    setTimeout(() => {
      setIsConnecting(false);
    }, 1500);
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
        <div className="w-full h-full flex items-center justify-center">
            <VideoPlayer
                src={remoteVideo?.imageUrl ?? ''}
                data-ai-hint={remoteVideo?.imageHint}
                name="Stranger"
                isConnecting={isConnecting}
                className="w-full max-w-lg max-h-[50vh] aspect-video"
            />
        </div>
        <div className={cn(
            "absolute top-4 right-4 z-20 transition-all duration-300 ease-in-out",
            isLocalVideoMinimized ? "w-24" : "w-1/6 max-w-[160px] min-w-[120px]"
          )}>
          <div className="relative">
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
                variant="ghost" 
                className="absolute top-0 right-0 z-30 h-6 w-6 rounded-full bg-black/30 text-white hover:bg-black/50"
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
            onToggleMic={() => setIsMicOn((prev) => !prev)}
            onToggleCam={() => setIsCamOn((prev) => !prev)}
            onNext={handleNext}
          />
        </div>
      </div>
      <div className="w-full lg:max-w-[400px] flex flex-col bg-card/50 backdrop-blur-sm border-l border-border h-full">
        <ChatWindow />
      </div>
    </main>
  );
}
