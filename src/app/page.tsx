import { LiveUserCount } from "@/components/live-user-count";
import { StartChatDialog } from "@/components/start-chat-dialog";

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
      
      <div className="flex flex-col items-center gap-6 w-full mt-8">
        <StartChatDialog />
        <LiveUserCount />
      </div>

    </main>
  );
}
