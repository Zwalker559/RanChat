"use client";

import { useState, useRef, useEffect } from 'react';
import { Send, ImagePlus, Paperclip, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { listenForMessages, sendMessage } from '@/lib/firebase/firestore';
import { uploadImage } from '@/lib/firebase/storage';
import { Message } from '@/lib/types';
import Image from 'next/image';

interface ChatWindowProps {
  chatId: string;
  currentUserUid: string;
}

export function ChatWindow({ chatId, currentUserUid }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!chatId) return;
    const unsubscribe = listenForMessages(chatId, (newMessages) => {
      setMessages(newMessages as Message[]);
    });
    return () => unsubscribe();
  }, [chatId]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newMessage.trim() === '' || !chatId) return;

    await sendMessage(chatId, currentUserUid, newMessage);
    setNewMessage('');
  };
  
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !chatId) return;
    
    setUploading(true);
    try {
        const imagePath = `chats/${chatId}/${Date.now()}_${file.name}`;
        const imageUrl = await uploadImage(file, imagePath);
        await sendMessage(chatId, currentUserUid, '', imageUrl);
    } catch (error) {
        console.error("Error uploading image:", error);
    } finally {
        setUploading(false);
        if(fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector(
        'div[data-radix-scroll-area-viewport]'
      );
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [messages]);

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
                'flex items-end gap-3',
                msg.senderId === currentUserUid ? 'flex-row-reverse' : 'items-start'
              )}
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback>
                  {msg.senderId === currentUserUid ? 'Y' : 'S'}
                </AvatarFallback>
              </Avatar>
              <div
                className={cn(
                  'max-w-xs rounded-lg p-3 text-sm shadow',
                  msg.senderId === currentUserUid
                    ? 'bg-primary text-primary-foreground rounded-br-none'
                    : 'bg-secondary text-secondary-foreground rounded-bl-none'
                )}
              >
                {msg.text && <p>{msg.text}</p>}
                {msg.imageUrl && (
                    <a href={msg.imageUrl} target="_blank" rel="noopener noreferrer">
                      <Image src={msg.imageUrl} alt="chat image" width={200} height={200} className="rounded-md mt-2 max-w-full h-auto cursor-pointer" />
                    </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <footer className="border-t p-4 flex-shrink-0 bg-background/50">
        <form onSubmit={handleSendMessage} className="flex items-center gap-2">
          <Input
            type="text"
            placeholder="Type a message..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            className="flex-1"
            autoComplete="off"
            disabled={uploading}
          />
           <Button type="button" size="icon" aria-label="Attach image" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          </Button>
          <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleImageUpload} />

          <Button type="submit" size="icon" aria-label="Send message" disabled={uploading || newMessage.trim() === ''}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </footer>
    </div>
  );
}
