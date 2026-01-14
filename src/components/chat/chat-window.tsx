"use client";

import { useState, useRef, useEffect } from "react";
import { Send, ImagePlus, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type Message = {
  id: number;
  sender: "You" | "Stranger";
  text: string;
};

export function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, sender: "Stranger", text: "Hey there!" },
    { id: 2, sender: "You", text: "Hi! How are you?" },
    { id: 3, sender: "Stranger", text: "Doing great, thanks for asking! Nice to meet you." },
  ]);
  const [newMessage, setNewMessage] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (newMessage.trim() === "") return;

    const message: Message = {
      id: Date.now(),
      sender: "You",
      text: newMessage,
    };
    setMessages((prev) => [...prev, message]);
    setNewMessage("");

    // Simulate stranger's reply
    setTimeout(() => {
        const reply: Message = {
            id: Date.now() + 1,
            sender: "Stranger",
            text: "That's cool!"
        }
        setMessages(prev => [...prev, reply]);
    }, 1500)
  };

  useEffect(() => {
    if (scrollAreaRef.current) {
        const viewport = scrollAreaRef.current.querySelector('div[data-radix-scroll-area-viewport]');
        if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
        }
    }
  }, [messages])

  return (
    <div className="flex h-full flex-col">
      <header className="border-b p-4 flex-shrink-0">
        <h2 className="text-lg font-semibold">Chat</h2>
      </header>
      <ScrollArea className="flex-1" ref={scrollAreaRef}>
        <div className="space-y-4 p-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex items-end gap-3",
                msg.sender === "You" && "flex-row-reverse"
              )}
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback>
                  {msg.sender === "You" ? "Y" : "S"}
                </AvatarFallback>
              </Avatar>
              <div
                className={cn(
                  "max-w-xs rounded-lg p-3 text-sm shadow",
                  msg.sender === "You"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground"
                )}
              >
                <p>{msg.text}</p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <footer className="border-t p-4 flex-shrink-0">
        <form onSubmit={handleSendMessage} className="flex items-center gap-2">
          <Input
            type="text"
            placeholder="Type a message..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            className="flex-1"
            autoComplete="off"
          />
          <Button type="submit" size="icon" aria-label="Send message">
            <Send className="h-4 w-4" />
          </Button>
        </form>
        <div className="mt-2 flex items-center gap-1">
            <Button variant="ghost" size="icon" className="text-muted-foreground h-8 w-8" aria-label="Attach image">
                <ImagePlus className="h-5 w-5"/>
            </Button>
            <Button variant="ghost" size="icon" className="text-muted-foreground h-8 w-8" aria-label="Attach file">
                <Paperclip className="h-5 w-5"/>
            </Button>
        </div>
      </footer>
    </div>
  );
}
