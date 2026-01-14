"use client";

import { useState, useMemo } from "react";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { VideoPlayer } from "@/components/chat/video-player";
import { ChatWindow } from "@/components/chat/chat-window";
import { ChatControls } from "@/components/chat/chat-controls";
import { useRouter } from "next/navigation";

export default function ChatPage() {
  const router = useRouter();
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);

  const localVideo = useMemo(() => PlaceHolderImages.find(p => p.id === 'local-video-feed'), []);
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

  return (
    <main className="flex h-screen max-h-screen flex-col lg:flex-row overflow-hidden">
      <div className="relative flex flex-1 flex-col items-center justify-center gap-4 p-4 bg-black/50">
        <div className="grid w-full h-full max-w-5xl grid-cols-1 md:grid-cols-2 gap-4">
          <VideoPlayer
            src={remoteVideo?.imageUrl ?? ''}
            data-ai-hint={remoteVideo?.imageHint}
            name="Stranger"
            isConnecting={isConnecting}
          />
          <VideoPlayer
            src={localVideo?.imageUrl ?? ''}
            data-ai-hint={localVideo?.imageHint}
            name="You"
            isMuted={!isMicOn}
            isCamOff={!isCamOn}
          />
        </div>
        <div className="w-full max-w-5xl">
          <ChatControls
            isMicOn={isMicOn}
            isCamOn={isCamOn}
            onToggleMic={() => setIsMicOn((prev) => !prev)}
            onToggleCam={() => setIsCamOn((prev) => !prev)}
            onSkip={handleSkip}
            onStop={handleStop}
          />
        </div>
      </div>
      <div className="w-full lg:w-[350px] lg:max-w-[350px] flex flex-col bg-card/50 backdrop-blur-sm border-l border-border">
        <ChatWindow />
      </div>
    </main>
  );
}
