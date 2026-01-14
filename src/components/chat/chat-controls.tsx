"use client";

import { useState } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  SkipForward,
  Loader2,
  PhoneOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

interface ChatControlsProps {
  isMicOn: boolean;
  isCamOn: boolean;
  isConnecting: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onNext: () => void;
}

export function ChatControls({
  isMicOn,
  isCamOn,
  isConnecting,
  onToggleMic,
  onToggleCam,
  onNext,
}: ChatControlsProps) {
  const [showStopDialog, setShowStopDialog] = useState(false);
  const router = useRouter();

  const handleStop = () => {
    // This will handle leaving the chat entirely and returning home.
    // In the future, this is where account deletion would be triggered.
    console.log("Stopping chat session...");
    router.push("/");
  };


  return (
    <div className="flex items-center justify-center gap-2 md:gap-4 p-2 rounded-full bg-card/60 backdrop-blur-md border border-border shadow-lg">
      <Button
        variant={isMicOn ? "secondary" : "destructive"}
        size="icon"
        className="h-12 w-12 rounded-full"
        onClick={onToggleMic}
        aria-label={isMicOn ? "Mute microphone" : "Unmute microphone"}
      >
        {isMicOn ? <Mic /> : <MicOff />}
      </Button>
      <Button
        variant={isCamOn ? "secondary" : "destructive"}
        size="icon"
        className="h-12 w-12 rounded-full"
        onClick={onToggleCam}
        aria-label={isCamOn ? "Turn off camera" : "Turn on camera"}
      >
        {isCamOn ? <Video /> : <VideoOff />}
      </Button>

      <Button
        className={cn(
            "h-14 px-6 rounded-full font-bold text-lg border-2 transition-all w-40",
            isConnecting 
                ? "bg-destructive border-destructive text-destructive-foreground"
                : "bg-primary border-primary text-primary-foreground"
        )}
        onClick={onNext}
      >
        {isConnecting ? (
            <>
              <Loader2 className="mr-2 animate-spin" />
              Stop
            </>
        ) : (
            <>
              <SkipForward className="mr-2" />
              Skip
            </>
        )}
      </Button>
      
      <Button 
        variant="outline"
        className="h-12 w-12 rounded-full border-2"
        size="icon"
        onClick={() => setShowStopDialog(true)}
      >
          <PhoneOff className="h-6 w-6 text-red-500" />
          <span className="sr-only">Stop chat</span>
      </Button>

      <AlertDialog open={showStopDialog} onOpenChange={setShowStopDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End Chat Session?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to end this chat and return to the home screen? This will delete your account and all data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { handleStop(); setShowStopDialog(false); }} className="bg-destructive hover:bg-destructive/90">
              End Session & Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
