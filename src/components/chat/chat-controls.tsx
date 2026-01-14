"use client";

import { useState } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  SkipForward,
  StopCircle,
  Loader2,
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

interface ChatControlsProps {
  isMicOn: boolean;
  isCamOn: boolean;
  isConnecting: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onSkip: () => void;
  onStop: () => void;
}

export function ChatControls({
  isMicOn,
  isCamOn,
  isConnecting,
  onToggleMic,
  onToggleCam,
  onSkip,
  onStop,
}: ChatControlsProps) {
  const [showStopDialog, setShowStopDialog] = useState(false);

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
                ? "bg-muted border-muted text-muted-foreground cursor-not-allowed"
                : "bg-primary border-primary text-primary-foreground"
        )}
        onClick={onSkip}
        disabled={isConnecting}
      >
        {isConnecting ? (
            <Loader2 className="mr-2 animate-spin" />
        ) : (
            <SkipForward className="mr-2" />
        )}
        {isConnecting ? "Finding..." : "Skip"}
      </Button>
      
      <Button 
        variant="destructive"
        className="h-14 px-6 rounded-full font-bold text-lg border-2 transition-all"
        onClick={() => setShowStopDialog(true)}
      >
          <StopCircle className="mr-2" />
          Stop
      </Button>

      <AlertDialog open={showStopDialog} onOpenChange={setShowStopDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will end your current chat session and return you to the homepage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { onStop(); setShowStopDialog(false); }} className="bg-destructive hover:bg-destructive/90">
              Stop Chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
