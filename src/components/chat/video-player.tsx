import { cn } from "@/lib/utils";
import { MicOff, VideoOff, Loader2, User } from "lucide-react";

interface VideoPlayerProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  name: string;
  isMuted?: boolean;
  isCamOff?: boolean;
  isConnecting?: boolean;
}

export function VideoPlayer({ src, name, isMuted, isCamOff, isConnecting, className, children, ...props }: React.PropsWithChildren<VideoPlayerProps>) {
  const showOverlay = isConnecting || isCamOff || (!children && !src);

  return (
    <div className={cn("relative aspect-video w-full overflow-hidden rounded-lg bg-secondary shadow-lg", className)} {...props}>
      {showOverlay ? (
        <div className="flex h-full w-full flex-col items-center justify-center bg-secondary text-muted-foreground">
          {isConnecting ? (
            <>
              <Loader2 className="h-8 w-8 md:h-12 md:w-12 animate-spin text-accent" />
              <p className="mt-2 md:mt-4 text-sm md:text-base">Finding next match...</p>
            </>
          ) : isCamOff ? (
            <VideoOff className="h-8 w-8 md:h-12 md:w-12" />
          ) : (
             <User className="h-8 w-8 md:h-12 md:w-12" />
          )}
        </div>
      ) : (
        children ?? (
          src && <img
            src={src}
            alt={`${name}'s video feed`}
            className="object-cover w-full h-full"
          />
        )
      )}

      <div className="absolute bottom-0 left-0 flex items-center gap-2 p-1 md:p-2 bg-black/50 rounded-tr-lg">
        <span className="text-xs md:text-sm font-medium text-white">{name}</span>
        {isMuted && <MicOff className="h-3 w-3 md:h-4 md:w-4 text-red-500" />}
      </div>
    </div>
  );
}
