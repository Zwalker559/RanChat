import { cn } from "@/lib/utils";
import { MicOff, VideoOff, Loader2, User } from "lucide-react";

interface VideoPlayerProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  isMuted?: boolean;
  isCamOff?: boolean;
  isConnecting?: boolean;
}

export function VideoPlayer({ name, isMuted, isCamOff, isConnecting, className, children, ...props }: React.PropsWithChildren<VideoPlayerProps>) {
  const showOverlay = isConnecting || isCamOff;

  return (
    <div className={cn("relative aspect-video w-full overflow-hidden rounded-lg bg-secondary shadow-lg", className)} {...props}>
      <div className={cn("w-full h-full", showOverlay && "invisible")}>
        {children}
      </div>

      {showOverlay && (
        <div className="absolute inset-0 flex h-full w-full flex-col items-center justify-center bg-secondary text-muted-foreground p-4">
          {isConnecting ? (
            <>
              <Loader2 className="h-8 w-8 md:h-12 md:w-12 animate-spin text-accent" />
              <p className="mt-2 md:mt-4 text-sm md:text-base text-center">Connecting...</p>
            </>
          ) : isCamOff ? (
            <VideoOff className="h-8 w-8 md:h-12 md:w-12" />
          ) : (
             <User className="h-8 w-8 md:h-12 md:w-12" />
          )}
        </div>
      )}

      <div className="absolute bottom-0 left-0 flex items-center gap-2 p-1 md:p-2 bg-black/50 rounded-tr-lg">
        <span className="text-xs md:text-sm font-medium text-white">{name}</span>
        {isMuted && <MicOff className="h-3 w-3 md:h-4 md:w-4 text-red-500" />}
      </div>
    </div>
  );
}
