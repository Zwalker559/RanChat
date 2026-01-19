
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ChatControlsProps {
  isMicOn: boolean;
  isCamOn: boolean;
  hasMicPermission: boolean;
  hasCameraPermission: boolean;
  isConnecting: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onNext: () => void;
  onStop: () => void;
}

export function ChatControls({
  isMicOn,
  isCamOn,
  hasMicPermission,
  hasCameraPermission,
  isConnecting,
  onToggleMic,
  onToggleCam,
  onNext,
  onStop,
}: ChatControlsProps) {
  const [showStopDialog, setShowStopDialog] = useState(false);

  return (
    <TooltipProvider>
      <div className="flex items-center justify-center gap-2 md:gap-4 p-2 rounded-full bg-card/60 backdrop-blur-md border border-border shadow-lg">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isMicOn ? "secondary" : "destructive"}
              size="icon"
              className={cn(
                "h-12 w-12 rounded-full transition-all",
                isMicOn && "shadow-[0_0_15px_hsl(var(--accent))] ring-1 ring-accent"
              )}
              onClick={onToggleMic}
              aria-label={isMicOn ? "Mute microphone" : "Unmute microphone"}
              disabled={isConnecting || !hasMicPermission}
            >
              {isMicOn ? <Mic /> : <MicOff />}
            </Button>
          </TooltipTrigger>
          {!hasMicPermission && (
            <TooltipContent>
              <p>Microphone access denied. Please enable it in browser settings.</p>
            </TooltipContent>
          )}
        </Tooltip>
        
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isCamOn ? "secondary" : "destructive"}
              size="icon"
              className="h-12 w-12 rounded-full"
              onClick={onToggleCam}
              aria-label={isCamOn ? "Turn off camera" : "Turn on camera"}
              disabled={isConnecting || !hasCameraPermission}
            >
              {isCamOn ? <Video /> : <VideoOff />}
            </Button>
          </TooltipTrigger>
          {!hasCameraPermission && (
            <TooltipContent>
              <p>Camera access denied. Please enable it in browser settings.</p>
            </TooltipContent>
          )}
        </Tooltip>

        <Button
          className="h-14 px-6 rounded-full font-bold text-lg border-2 transition-all w-40 bg-primary border-primary text-primary-foreground"
          onClick={onNext}
          disabled={isConnecting}
        >
          {isConnecting ? (
              <>
                <Loader2 className="mr-2 animate-spin" />
                Finding...
              </>
          ) : (
              <>
                <SkipForward className="mr-2" />
                Next
              </>
          )}
        </Button>
        
        <Button 
          variant="destructive"
          className="h-12 w-12 rounded-full border-2 border-destructive"
          size="icon"
          onClick={() => setShowStopDialog(true)}
          disabled={isConnecting}
        >
            <PhoneOff className="h-6 w-6" />
            <span className="sr-only">End Session</span>
        </Button>

        <AlertDialog open={showStopDialog} onOpenChange={setShowStopDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>End Chat Session?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to end this chat and return to the home screen? Your anonymous account will be deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onStop} className="bg-destructive hover:bg-destructive/90">
                End Session
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}

    