"use client";

import { useState } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  SkipForward,
  StopCircle,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

interface ChatControlsProps {
  isMicOn: boolean;
  isCamOn: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onSkip: () => void;
  onStop: () => void;
}

export function ChatControls({
  isMicOn,
  isCamOn,
  onToggleMic,
  onToggleCam,
  onSkip,
  onStop,
}: ChatControlsProps) {
  const [isSkipDisabled, setIsSkipDisabled] = useState(false);
  const { toast } = useToast();

  const handleSkipClick = () => {
    if (isSkipDisabled) {
      toast({
        description: "Please wait before skipping again.",
        variant: "default", 
        style: {
          backgroundColor: 'hsl(var(--destructive))',
          color: 'hsl(var(--destructive-foreground))',
        }
      });
      return;
    }
    onSkip();
    setIsSkipDisabled(true);
    setTimeout(() => {
      setIsSkipDisabled(false);
    }, 3000); // 3-second cooldown
  };

  return (
    <div className="flex items-center justify-center gap-2 md:gap-4 p-2 rounded-lg bg-card/50 backdrop-blur-sm">
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
        variant="outline"
        className="h-14 px-6 rounded-full font-bold text-lg border-2"
        onClick={handleSkipClick}
        disabled={isSkipDisabled}
      >
        <SkipForward className="mr-2" /> Skip
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="destructive"
            className="h-14 px-6 rounded-full font-bold text-lg border-2 border-destructive"
          >
            <StopCircle className="mr-2" /> Stop
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will end your current chat session and you will be returned
              to the homepage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onStop} className="bg-destructive hover:bg-destructive/90">Stop Chat</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
