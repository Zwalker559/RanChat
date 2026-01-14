import Image from "next/image";
import { LiveUserCount } from "@/components/live-user-count";
import { StartChatDialog } from "@/components/start-chat-dialog";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { Card, CardContent } from "@/components/ui/card";
import { Video, Mic, Send } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const ChatPreview = () => {
  const remoteVideo = PlaceHolderImages.find(p => p.id === 'remote-video-feed');
  const localVideo = PlaceHolderImages.find(p => p.id === 'local-video-feed');

  return (
    <Card className="overflow-hidden bg-card/50 backdrop-blur-sm border-border shadow-2xl shadow-accent/10 w-full max-w-4xl mx-auto">
      <CardContent className="p-4 md:p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Video Section */}
          <div className="md:col-span-2 relative aspect-video rounded-lg bg-black overflow-hidden">
            {remoteVideo && 
              <Image 
                src={remoteVideo.imageUrl}
                alt="Video chat preview"
                fill
                className="object-cover opacity-80"
                data-ai-hint={remoteVideo.imageHint}
              />
            }
            <div className="absolute top-2 right-2 w-1/4 max-w-[120px] aspect-video rounded-md bg-black/50 overflow-hidden border-2 border-border">
              {localVideo && 
                <Image 
                  src={localVideo.imageUrl}
                  alt="Local video preview"
                  fill
                  className="object-cover"
                  data-ai-hint={localVideo.imageHint}
                />
              }
            </div>
            <div className="absolute bottom-2 left-2 bg-black/50 text-white px-2 py-1 text-xs rounded-md">Stranger</div>
            <div className="absolute bottom-2 right-2 flex gap-2">
              <div className="p-2 rounded-full bg-secondary/50 backdrop-blur-sm"><Mic size={16} className="text-white" /></div>
              <div className="p-2 rounded-full bg-destructive/50 backdrop-blur-sm"><Video size={16} className="text-white" /></div>
            </div>
          </div>

          {/* Chat Section */}
          <div className="flex flex-col bg-secondary/30 rounded-lg p-3 h-full min-h-[200px] md:h-auto">
            <div className="flex-1 space-y-3 text-sm">
              <div className="flex items-start gap-2">
                <Avatar className="w-6 h-6"><AvatarFallback>S</AvatarFallback></Avatar>
                <div className="bg-secondary text-secondary-foreground p-2 rounded-lg rounded-tl-none">Hey there!</div>
              </div>
              <div className="flex items-start gap-2 justify-end">
                <div className="bg-primary text-primary-foreground p-2 rounded-lg rounded-br-none">Hi! How are you?</div>
                <Avatar className="w-6 h-6"><AvatarFallback>Y</AvatarFallback></Avatar>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-8 bg-input rounded-md" />
              <div className="p-2 rounded-md bg-primary"><Send size={16} className="text-primary-foreground" /></div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-8 text-center space-y-8 overflow-hidden">
       <div className="absolute inset-0 -z-10 h-full w-full bg-background bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-20"></div>
       <div className="absolute top-0 left-0 -z-10 h-1/3 w-1/3 bg-accent/20 rounded-full blur-3xl animate-pulse"></div>
       <div className="absolute bottom-0 right-0 -z-10 h-1/3 w-1/3 bg-primary/20 rounded-full blur-3xl animate-pulse animation-delay-4000"></div>
      
      <div className="space-y-4 max-w-2xl">
        <h1 className="text-5xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-accent to-blue-400 md:text-7xl">
          RanChat
        </h1>
        <p className="text-lg text-muted-foreground md:text-xl">
          Instantly connect with new people from around the world through random video chats.
        </p>
      </div>
      
      <div className="flex flex-col items-center gap-6 w-full">
        <StartChatDialog />
        <LiveUserCount />
      </div>

      <ChatPreview />

    </main>
  );
}
