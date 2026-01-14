import Image from "next/image";
import { cn } from "@/lib/utils";
import { MicOff, VideoOff, Loader2 } from "lucide-react";

interface VideoPlayerProps extends React.HTMLAttributes<HTMLDivElement> {
  src: string;
  name: string;
  isMuted?: boolean;
  isCamOff?: boolean;
  isConnecting?: boolean;
}

export function VideoPlayer({ src, name, isMuted, isCamOff, isConnecting, className, ...props }: VideoPlayerProps) {
  return (
    <div className={cn("relative aspect-video w-full overflow-hidden rounded-lg bg-black shadow-lg", className)} {...props}>
      {(isCamOff || isConnecting) ? (
        <div className="flex h-full w-full flex-col items-center justify-center bg-secondary">
          {isConnecting ? (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-accent" />
              <p className="mt-4 text-muted-foreground">Finding next match...</p>
            </>
          ) : (
            <VideoOff className="h-12 w-12 text-muted-foreground" />
          )}
        </div>
      ) : (
        src && <Image
          src={src}
          alt={`${name}'s video feed`}
          fill
          className="object-cover"
          priority
        />
      )}

      <div className="absolute bottom-0 left-0 flex items-center gap-2 p-2 bg-black/50 rounded-tr-lg">
        <span className="text-sm font-medium text-white">{name}</span>
        {isMuted && <MicOff className="h-4 w-4 text-red-500" />}
      </div>
    </div>
  );
}
