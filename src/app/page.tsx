import { LiveUserCount } from "@/components/live-user-count";
import { StartChatDialog } from "@/components/start-chat-dialog";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-5xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-accent to-blue-400 md:text-6xl">
            RanChat
          </h1>
          <p className="text-lg text-muted-foreground">
            Connect with people from around the world.
          </p>
        </div>
        <LiveUserCount />
        <StartChatDialog />
      </div>
    </main>
  );
}
